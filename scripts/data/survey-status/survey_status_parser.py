# -*- coding: utf-8 -*-
import glob, os, re, json, datetime
import pdfplumber

FOLDER = r"C:\CMS3.0\MisDocs\Survey Status"

MON = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def d_rina(s):
    m = re.fullmatch(r"(\d{2})(\w{3})(\d{4})", s.strip())
    if not m or m.group(2) not in MON:
        return None
    return datetime.date(int(m.group(3)), MON[m.group(2)], int(m.group(1)))


def d_nk(s):
    m = re.fullmatch(r"(\d{1,2})\s+(\w{3})\s+(\d{4})", s.strip())
    if not m or m.group(2) not in MON:
        return None
    return datetime.date(int(m.group(3)), MON[m.group(2)], int(m.group(1)))


def rows_of(page):
    rows = {}
    for w in page.extract_words():
        rows.setdefault(round(w["top"], 1), []).append(w)
    return rows


def parse_rina(path):
    v = {"soc": "RINA", "name": None, "type": None, "flag": None,
         "class_expires": None, "class_next_due": None, "surveys": []}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if v["name"] is None:
                m = re.search(r"Ship.s Name\s+(.+)", text)
                if m:
                    v["name"] = m.group(1).strip()
            m = re.search(r"Service Notation\s+(.+)", text)
            if m and not v["type"]:
                v["type"] = m.group(1).strip()
            m = re.search(r"Flag\s+(.+)", text)
            if m and not v["flag"]:
                v["flag"] = m.group(1).strip()
            m = re.search(r"CLASS\s+FULL\s+(\d{2}\w{3}\d{4})\s+(\d{2}\w{3}\d{4})", text)
            if m and not v["class_expires"]:
                v["class_expires"] = m.group(2)
            m = re.search(r"Class Next Due Date\s+(\d{2}\w{3}\d{4})", text)
            if m and not v["class_next_due"]:
                v["class_next_due"] = m.group(1)

            if "SURVEYS TYPE" not in text.replace("\n", " "):
                continue
            rws = rows_of(page)
            tops = sorted(rws)
            hdr_tops = []
            for t in tops:
                s = " ".join(w["text"] for w in sorted(rws[t], key=lambda a: a["x0"]))
                if s.startswith("SURVEYS TYPE") and "LAST" in s:
                    hdr_tops.append(t)
            if not hdr_tops:
                continue
            hdr = sorted(rws[hdr_tops[0]], key=lambda a: a["x0"])
            X = {w["text"]: w["x0"] for w in hdr}
            x_type = hdr[1]["x0"]
            x_rem, x_last = X["REMARKS"], X["LAST"]
            x_due, x_range, x_status = X["DUE"], X["RANGE"], X["STATUS"]
            sec_tops = []
            for t in tops:
                s = " ".join(w["text"] for w in sorted(rws[t], key=lambda a: a["x0"])).strip()
                if s in ("CLASS SURVEYS", "STATUTORY SURVEYS"):
                    sec_tops.append((t, s))

            def sec(t):
                cur = None
                for st, n in sec_tops:
                    if st <= t:
                        cur = n
                return cur

            prev = None
            for t in tops:
                if t <= hdr_tops[0]:
                    continue
                ws = sorted(rws[t], key=lambda a: a["x0"])
                s = " ".join(w["text"] for w in ws)
                if s.startswith("SURVEYS TYPE") or s.strip() in ("CLASS SURVEYS", "STATUTORY SURVEYS"):
                    prev = None
                    continue
                if re.match(r"^(Page \d+ of|For any enquiries|Telephone|E-mail|Direct fax|www\.rina|SHIP STATUS|Ship.s Name|Downloaded on|\(\d\) An underwater)", s):
                    continue
                c = {"type": "", "remarks": "", "last": "", "due": "", "range": "", "status": ""}
                for w in ws:
                    x, tx = w["x0"], w["text"]
                    if x < x_type - 5:
                        continue
                    elif x < x_rem - 5:
                        c["type"] += tx + " "
                    elif x < x_last - 5:
                        c["remarks"] += tx + " "
                    elif x < x_due - 5:
                        c["last"] += tx + " "
                    elif x < x_range - 5:
                        c["due"] += tx + " "
                    elif x < x_status - 5:
                        c["range"] += tx + " "
                    else:
                        c["status"] += tx + " "
                for k in c:
                    c[k] = c[k].strip()
                c["status"] = re.sub(r"[^A-Za-z0-9/ ]", "", c["status"]).strip()
                if not any(c.values()):
                    continue
                if prev is not None and c["type"] and not c["last"] and not c["due"] and not c["range"]:
                    prev["type"] += " " + c["type"]
                    continue
                if prev is not None and not c["type"] and c["status"]:
                    prev["status"] += " " + c["status"]
                    continue
                if not c["type"]:
                    continue
                c["section"] = sec(t)
                v["surveys"].append(c)
                prev = c
    return v


def parse_nk(path):
    v = {"soc": "ClassNK", "name": None, "type": None, "flag": None,
         "class_expires": None, "class_next_due": None, "surveys": []}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if v["name"] is None:
                m = re.search(r"Name of Ship:\s*(.+?)\s+Class No", text)
                if m:
                    v["name"] = m.group(1).strip()
            rws = rows_of(page)
            tops = sorted(rws)
            hdr = None
            for t in tops:
                s = "".join(w["text"] for w in sorted(rws[t], key=lambda a: a["x0"]))
                if "KKiinndd" in s and "SSuurrvveeyy" in s:
                    hdr = t
                    break
            if hdr is None:
                continue
            cur_group = ""
            for t in tops:
                if t <= hdr:
                    continue
                ws = sorted(rws[t], key=lambda a: a["x0"])
                s = " ".join(w["text"] for w in ws)
                if re.search(r"CCoonnddiittiioonn|NNoottee|EEnndd|NK-SHIPS|NIPPON|Page |ttoo bbee", s):
                    break
                c = {"kind": "", "status": "", "due": "", "range": "", "postp": "", "last": ""}
                for w in ws:
                    x, tx = w["x0"], w["text"]
                    if x < 180:
                        c["kind"] += tx + " "
                    elif x < 230:
                        c["status"] += tx + " "
                    elif x < 292:
                        c["due"] += tx + " "
                    elif x < 430:
                        c["range"] += tx + " "
                    elif x < 495:
                        c["postp"] += tx + " "
                    else:
                        c["last"] += tx + " "
                for k in c:
                    c[k] = c[k].strip()
                if c["kind"] and not (c["due"] or c["last"] or c["range"] or c["status"]):
                    cur_group = c["kind"]
                    continue
                if not any(c.values()):
                    continue
                c["group"] = cur_group
                v["surveys"].append(c)
    return v


RANGE_END = re.compile(r"(\d{2}\w{3}\d{4})\s*$")


def range_end_rina(txt):
    m = RANGE_END.search((txt or "").strip())
    return d_rina(m.group(1)) if m else None


def range_end_nk(txt):
    t = (txt or "").replace("--", "").strip()
    m = re.search(r"(\d{1,2}\s+\w{3}\s+\d{4})\s*$", t)
    return d_nk(m.group(1)) if m else None


def fmt(d):
    return d.strftime("%d/%m/%Y") if d else ""


def build_row(code, v):
    out = {"code": code, "name": v["name"], "soc": v["soc"], "type": v.get("type") or "",
           "flag": v.get("flag") or "", "class_expires": v.get("class_expires") or "",
           "ss_last": None, "ss_due": None, "im_last": None, "im_due": None,
           "dd_last": None, "dd_due": None, "ts_last": None, "ts_due": None,
           "ss_lim": None, "im_lim": None, "an_lim": None, "dd_lim": None, "ts_lim": None,
           "notes": []}
    if v["soc"] == "RINA":
        S = [r for r in v["surveys"] if r.get("section") == "CLASS SURVEYS"]

        def find(pat):
            return [r for r in S if re.search(pat, r["type"], re.I)]

        hull_ren = find(r"^Hull Renewal")
        mach_ren = find(r"^Mach\. Renewal")
        if hull_ren:
            r = hull_ren[0]
            out["ss_last"] = d_rina(r["last"]) if r["last"] else None
            out["ss_due"] = d_rina(r["due"]) if r["due"] else None
            out["ss_lim"] = range_end_rina(r["range"]) or out["ss_due"]
            if r["status"]:
                out["notes"].append("Renovacion casco marcada: " + r["status"])
        if mach_ren:
            r = mach_ren[0]
            ml = d_rina(r["last"]) if r["last"] else None
            md = d_rina(r["due"]) if r["due"] else None
            if md != out["ss_due"] or ml != out["ss_last"]:
                out["notes"].append("Renovacion de maquinas: ultima %s / vence %s" %
                                    (fmt(ml) or "-", fmt(md) or "-"))
        cis = find(r"Class Issue Survey")
        if cis and not out["ss_last"]:
            out["ss_last"] = d_rina(cis[0]["last"]) if cis[0]["last"] else None
            out["notes"].append("La ultima renovacion es el alta en clase (Class Issue Survey)")
        hi = find(r"^Hull Intermediate")
        if hi:
            r = hi[0]
            out["im_last"] = d_rina(r["last"]) if r["last"] else None
            out["im_due"] = d_rina(r["due"]) if r["due"] else None
            out["im_lim"] = range_end_rina(r["range"]) or out["im_due"]
            if r["range"] and r["range"].strip() != "-":
                out["notes"].append("Ventana intermedia: " + r["range"])
            if not out["im_due"]:
                out["notes"].append("La proxima intermedia se fija al renovar la clase")
        bd = find(r"Bottom Dry Condition")
        if bd:
            r = bd[0]
            out["dd_last"] = d_rina(r["last"]) if r["last"] else None
            out["dd_due"] = d_rina(r["due"]) if r["due"] else None
            out["dd_lim"] = range_end_rina(r["range"]) or out["dd_due"]
            if r["status"]:
                out["notes"].append("Seco marcado: " + r["status"])
            if "(1)" in r["remarks"]:
                out["notes"].append("Admite inspeccion subacuatica en lugar de varada")
        ts = find(r"Tailshaft|Propeller shaft")
        if ts:
            det = []
            best = None
            lims = []
            for r in ts:
                l = d_rina(r["last"]) if r["last"] else None
                dd = d_rina(r["due"]) if r["due"] else None
                low = r["type"].lower()
                side = "Babor" if "port" in low else ("Estribor" if "stbd" in low else r["type"][:14])
                det.append("%s ultima %s / vence %s" % (side, fmt(l) or "-", fmt(dd) or "-"))
                if dd and (best is None or dd < best[1]):
                    best = (l, dd)
                re_ = range_end_rina(r["range"])
                if re_:
                    lims.append(re_)
            if best:
                out["ts_last"], out["ts_due"] = best
            out["ts_lim"] = min(lims) if lims else out["ts_due"]
            if len(ts) > 1:
                out["notes"].append("Ejes: " + "; ".join(det))
    else:
        S = v["surveys"]

        def pick(r, key):
            val = r[key].replace("--", "").strip()
            return d_nk(val) if val else None

        sp = [r for r in S if re.search(r"^Special Survey", r["kind"], re.I)
              and not r.get("group", "").startswith("Planned")]
        if sp:
            out["ss_last"] = pick(sp[0], "last")
            out["ss_due"] = pick(sp[0], "due")
            out["ss_lim"] = range_end_nk(sp[0]["range"]) or out["ss_due"]
        im = [r for r in S if re.search(r"^Intermediate Survey", r["kind"], re.I)]
        if im:
            out["im_last"] = pick(im[0], "last")
            out["im_due"] = pick(im[0], "due")
            out["im_lim"] = range_end_nk(im[0]["range"]) or out["im_due"]
            rg = im[0]["range"].replace("--", "").strip()
            if rg:
                out["notes"].append("Ventana intermedia: " + rg)
        dk = [r for r in S if re.search(r"^Docking Survey", r["kind"], re.I)]
        if dk:
            out["dd_last"] = pick(dk[0], "last")
            out["dd_due"] = pick(dk[0], "due")
            out["dd_lim"] = range_end_nk(dk[0]["range"]) or out["dd_due"]
        ps = [r for r in S if re.search(r"Prop\. Shaft", r.get("group", ""), re.I)
              and re.search(r"^Ordinary Svy", r["kind"], re.I)]
        if ps:
            lasts = [x for x in (pick(r, "last") for r in ps) if x]
            dues = [x for x in (pick(r, "due") for r in ps) if x]
            out["ts_last"] = min(lasts) if lasts else None
            out["ts_due"] = min(dues) if dues else None
            out["ts_lim"] = out["ts_due"]
            out["notes"].append("%d ejes portahelice, todos con las mismas fechas" % len(ps))
            part = [r for r in S if re.search(r"Prop\. Shaft", r.get("group", ""), re.I)
                    and re.search(r"18 years", r["kind"], re.I)]
            if part:
                out["notes"].append("Inspeccion de eje cada 18 anos: vence %s" %
                                    (fmt(pick(part[0], "due")) or "-"))
    return out


def main():
    files = sorted(glob.glob(os.path.join(FOLDER, "*hip *tatus*.pdf")))
    seen = set()
    results = []
    for f in files:
        base = os.path.basename(f)
        code = base.split("-")[0].upper()
        if code in seen:
            continue
        with pdfplumber.open(f) as pdf:
            head = pdf.pages[0].extract_text() or ""
        v = parse_nk(f) if "NIPPON KAIJI" in head else parse_rina(f)
        if v["soc"] == "ClassNK" and v["name"]:
            v["name"] = re.sub(r"(\S)\1", lambda m: m.group(1), v["name"]).strip()
        if not v["name"]:
            v["name"] = code
        seen.add(code)
        row = build_row(code, v)
        row["_file"] = base
        if "renovacion" in base.lower():
            row["notes"].insert(0, "Certificado de clase VENCIDO - en renovacion de clase a seco")
        results.append(row)

    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "rows.json"), "w", encoding="utf-8") as fh:
        json.dump([{k: (fmt(x) if isinstance(x, datetime.date) else x) for k, x in r.items()}
                   for r in results], fh, ensure_ascii=False, indent=1)
    for r in results:
        print(r["code"], "|", r["name"], "|", r["soc"], "|", r["type"],
              "| SS", fmt(r["ss_last"]), "->", fmt(r["ss_due"]),
              "| INT", fmt(r["im_last"]), "->", fmt(r["im_due"]),
              "| DD", fmt(r["dd_last"]), "->", fmt(r["dd_due"]),
              "| TS", fmt(r["ts_last"]), "->", fmt(r["ts_due"]))
    print("TOTAL", len(results))


if __name__ == "__main__":
    main()
