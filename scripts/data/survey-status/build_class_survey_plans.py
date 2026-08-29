# -*- coding: utf-8 -*-
"""Arma el dataset de planes de inspeccion de clase a partir de los Ship Status.

Reglas (ver cabecera del loader TS):
  nextDueDate  = Due Date del certificado; si no hay, cierre de la ventana; si no, vacio.
  lastExecutionDate = Last Date del certificado; vacio si no figura.
  frequencyMonths = del ESQUEMA de clase del buque, no de la resta de fechas
                    (las fechas cruzan ciclos y darian numeros falsos).
"""
import glob, os, re, json, datetime
import pdfplumber
import survey_status_parser as B

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "class-survey-plans.json")

# codigo del PDF -> codigo del buque en la base
CODE_FIX = {"DHC": "DCH"}

# ciclo de clase en meses. RINA lo dice en el certificado; ClassNK se deduce.
CICLO_NK = {"LTE": 72, "MGT10": 96, "MGT11": 96, "MGT12": 96, "MGT13": 96, "MGT14": 96, "MGT15": 96}


def iso(d):
    return d.isoformat() if d else None


def add_months(d, months):
    """Suma meses conservando el dia; si el dia no existe, cae al ultimo del mes."""
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    last = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return datetime.date(y, m, min(d.day, last))


def range_end(txt, soc):
    return B.range_end_rina(txt) if soc == "RINA" else B.range_end_nk(txt)


def main():
    files = sorted(glob.glob(os.path.join(B.FOLDER, "*hip *tatus*.pdf")))
    seen = set()
    out = []
    for f in files:
        base = os.path.basename(f)
        code = base.split("-")[0].upper()
        code = CODE_FIX.get(code, code)
        if code in seen:
            continue
        with pdfplumber.open(f) as pdf:
            head = pdf.pages[0].extract_text() or ""
            full = "\n".join((p.extract_text() or "") for p in pdf.pages)
        v = B.parse_nk(f) if "NIPPON KAIJI" in head else B.parse_rina(f)
        seen.add(code)
        soc = v["soc"]

        # ciclo de clase
        m = re.search(r"Class period \(years : months : days\)\s*(\d+) : (\d+) : (\d+)", full)
        ciclo = int(m.group(1)) * 12 + int(m.group(2)) if m else CICLO_NK.get(code)
        if not ciclo:
            raise SystemExit("sin ciclo de clase para " + code)

        def rina_row(pat):
            for r in v["surveys"]:
                if r.get("section") == "CLASS SURVEYS" and re.search(pat, r["type"], re.I):
                    yield r

        def nk_rows(kind_pat, group_pat=None):
            for r in v["surveys"]:
                k = r["kind"]
                g = r.get("group", "")
                if group_pat and not re.search(group_pat, g, re.I):
                    continue
                if re.search(kind_pat, k, re.I):
                    yield r

        def cell(r, key):
            if soc == "RINA":
                return B.d_rina(r[key]) if r[key] else None
            val = r[key].replace("--", "").strip()
            return B.d_nk(val) if val else None

        def pick(rina_pat, nk_pat, nk_group=None):
            rows = list(rina_row(rina_pat)) if soc == "RINA" else list(nk_rows(nk_pat, nk_group))
            if not rows:
                return None
            r = rows[0]
            last = cell(r, "last")
            due = cell(r, "due")
            win = range_end(r["range"], soc)
            return {"last": last, "due": due or win, "win": win, "from_window": due is None and win is not None,
                    "n": len(rows), "rows": rows}

        renov = pick(r"^Hull Renewal", r"^Special Survey")
        if soc == "ClassNK":
            # excluir "Planned Machinery Survey / Special Survey"
            rr = [r for r in v["surveys"] if re.search(r"^Special Survey", r["kind"], re.I)
                  and not r.get("group", "").startswith("Planned")]
            if rr:
                r = rr[0]
                renov = {"last": cell(r, "last"), "due": cell(r, "due") or range_end(r["range"], soc),
                         "win": range_end(r["range"], soc), "from_window": cell(r, "due") is None,
                         "n": 1, "rows": [r]}
        # RINA: si Hull Renewal no trae ultima, usar el Class Issue Survey (alta en clase)
        if soc == "RINA" and renov and not renov["last"]:
            cis = list(rina_row(r"Class Issue Survey"))
            if cis and cis[0]["last"]:
                renov["last"] = B.d_rina(cis[0]["last"])
                renov["last_note"] = "alta en clase (Class Issue Survey)"

        interm = pick(r"^Hull Intermediate", r"^Intermediate Survey")
        period = pick(r"^Hull Ordinary", r"^Annual Survey")
        seco = pick(r"Bottom Dry Condition", r"^Docking Survey")

        # eje portahelice
        eje = None
        if soc == "RINA":
            rows = list(rina_row(r"Tailshaft|Propeller shaft"))
        else:
            rows = [r for r in v["surveys"] if re.search(r"Prop\. Shaft", r.get("group", ""), re.I)
                    and re.search(r"^Ordinary Svy", r["kind"], re.I)]
        if rows:
            det = []
            best = None
            for r in rows:
                l, d = cell(r, "last"), cell(r, "due")
                w = range_end(r["range"], soc)
                if soc == "RINA":
                    low = r["type"].lower()
                    name = "Babor" if "port" in low else ("Estribor" if "stbd" in low else r["type"])
                else:
                    name = r.get("group", "Eje")
                det.append({"eje": name, "last": iso(l), "due": iso(d or w)})
                dd = d or w
                if dd and (best is None or dd < best["due"]):
                    best = {"last": l, "due": dd}
            eje = {"last": best["last"] if best else None, "due": best["due"] if best else None,
                   "win": None, "from_window": False, "n": len(rows), "detalle": det}

        # frecuencias segun esquema de clase
        freq_eje = None
        if eje and eje["last"] and eje["due"]:
            months = round((eje["due"] - eje["last"]).days / 30.4375)
            freq_eje = min([12, 24, 36, 48, 60, 72, 96, 120, 144, 180, 216], key=lambda x: abs(x - months))
        elif eje:
            freq_eje = 72

        items = {
            "renovacion": {"freq": ciclo, **(renov or {})},
            # Periodica: el intervalo real lo demuestra el certificado en las barcazas
            # RINA (ciclo/4 = 24 meses). Donde el certificado no la registra no hay
            # evidencia de intervalo: se usa 12 meses, que es la inspeccion anual.
            "periodica": {"freq": (ciclo // 4 if (period and (period["last"] or period["due"])) else 12),
                          **(period or {})},
            "intermedia": {"freq": ciclo // 2, **(interm or {})},
            "seco": {"freq": ciclo, **(seco or {})},
            "eje": ({"freq": freq_eje, **eje} if eje else None),
        }
        # Vencimiento proyectado: cuando el certificado no lo trae, el proximo cae en
        # el ciclo de clase siguiente, que arranca en la fecha de vencimiento de la
        # renovacion. Verificado contra los buques que si traen el dato (MGT01/MGT17:
        # periodica = inicio de ciclo + 24m, intermedia = inicio de ciclo + 48m).
        ciclo_next = (renov or {}).get("due")
        for k in ("periodica", "intermedia", "seco", "eje"):
            it = items.get(k)
            if not it or it.get("due") or not ciclo_next:
                continue
            if k == "periodica" and not it.get("last"):
                continue  # sin evidencia de que la inspeccion exista para ese buque
            it["due"] = add_months(ciclo_next, it["freq"])
            it["projected"] = True

        for k, it in items.items():
            if it is None:
                continue
            it.pop("rows", None)
            for f in ("last", "due", "win"):
                if f in it:
                    it[f] = iso(it[f])

        name = v["name"] or code
        if soc == "ClassNK":
            name = re.sub("(\\S)\\1", lambda m: m.group(1), name).strip()
        out.append({"code": code, "name": name, "soc": soc, "ciclo": ciclo,
                    "tipo": "REMOLCADOR" if code in ("DCH", "LTE", "M01", "M02") else "BARCAZA",
                    "items": items})

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)

    print("buques:", len(out), "->", OUT)
    print()
    hdr = "%-7s %-4s %-5s | %-22s | %-22s | %-22s | %-22s | %s" % (
        "COD", "SOC", "CICLO", "RENOVACION", "PERIODICA", "INTERMEDIA", "SECO", "EJE")
    print(hdr)
    print("-" * len(hdr))
    for v in out:
        def s(k):
            it = v["items"].get(k)
            if not it:
                return "-"
            fr = it.get("freq")
            l = it.get("last") or "?"
            d = it.get("due") or "?"
            mark = "*" if it.get("from_window") else " "
            return "%3sm %s>%s%s" % (fr, l, d, mark)
        print("%-7s %-4s %-5s | %-22s | %-22s | %-22s | %-22s | %s" % (
            v["code"], "RINA" if v["soc"] == "RINA" else "NK", v["ciclo"],
            s("renovacion"), s("periodica"), s("intermedia"), s("seco"), s("eje")))
    print("\n* = el vencimiento sale del cierre de ventana porque el certificado no trae Due Date")


if __name__ == "__main__":
    main()
