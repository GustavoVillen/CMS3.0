# -*- coding: utf-8 -*-
"""
Matchea el historial del Excel (MisDocs/don chicueto.xlsx) contra los planes
reales de DCH (MisDocs/_dch_plans.json). NO escribe en la DB: reporte + mapping.

Modelo: los planes de DCH están AGRUPADOS POR FRECUENCIA ("Mantenimiento CADA X")
y su `description` lista las tareas individuales del bucket. El Excel es
tarea-por-tarea. Por eso se matchea cada LÍNEA de la descripción contra el Excel,
dentro del mismo activo, y se agrega la última ejecución del bucket:
  - bucket por horas  -> lastExecutionHours = max(horas de las tareas matcheadas)
  - bucket por fecha  -> lastExecutionDate  = max(fechas de las tareas matcheadas)
(el "máximo" = la ejecución más reciente del bucket).

Salida: MisDocs/_dch_history_map.json  { taskCode: {"date":"YYYY-MM-DD"|"hours":n, "cov":"k/n"} }
"""
import json, re, unicodedata, datetime
from difflib import SequenceMatcher
from collections import defaultdict
import openpyxl

XLSX = "MisDocs/don chicueto.xlsx"
PLANS = "MisDocs/_dch_plans.json"
OUT = "MisDocs/_dch_history_map.json"
LINE_TH = 0.55      # umbral de match por línea de tarea
ASSET_TH = 0.50     # umbral de resolución de activo

STOP = {"de","la","el","los","las","y","del","a","en","con","por","para","un","una","o"}
def norm(s):
    if s is None: return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii","ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()
def toks(s): return {t for t in norm(s).split() if t not in STOP and len(t) > 1}
def sim(a, b):
    na, nb = norm(a), norm(b)
    if not na or not nb: return 0.0
    ta, tb = toks(a), toks(b)
    jac = len(ta & tb)/len(ta | tb) if (ta | tb) else 0.0
    return 0.6*jac + 0.4*SequenceMatcher(None, na, nb).ratio()

def expand_abbr(s):
    """Expande abreviaturas de la sección REGISTRO: M.P.Ebr -> Motor Principal Estribor."""
    # Solo las formas REALES con puntos (M.P.Ebr / M.A.Bbr), no substrings
    # como "ma" en "Alarma" o "Sistema".
    s = " " + str(s) + " "
    s = re.sub(r"\bM\.\s*P\.?", " Motor Principal ", s, flags=re.I)
    s = re.sub(r"\bM\.\s*A\.?", " Motor Auxiliar ", s, flags=re.I)
    s = re.sub(r"\bEbr\b", " Estribor ", s, flags=re.I)
    s = re.sub(r"\bBbr\b", " Babor ", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()

def classify_g(g):
    if g is None: return None
    if isinstance(g, datetime.datetime): return ("date", g.date())
    if isinstance(g, datetime.date): return ("date", g)
    if isinstance(g, (int, float)):
        return ("hours", float(g)) if float(g) > 0 else None
    s = str(g).strip()
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$", s)
    if m:
        d, mo, y = map(int, m.groups()); y += 2000 if y < 100 else 0
        try: return ("date", datetime.date(y, mo, d))
        except ValueError: return None
    if re.match(r"^\d+(\.\d+)?$", s):
        return ("hours", float(s)) if float(s) > 0 else None
    return None

def parse_freq(f):
    """Frecuencia del Excel -> (kind, value). months/day/week/hours."""
    if f is None: return None
    if isinstance(f, (int, float)):
        return ("hours", float(f)) if f > 0 else None
    s = norm(f)
    m = re.match(r"(\d+)", s)
    if not m: return None
    n = int(m.group(1))
    if "mes" in s: return ("months", n)
    if "ano" in s or "year" in s: return ("months", n * 12)
    if "seman" in s: return ("week", n)
    if "dia" in s: return ("day", n)
    if re.fullmatch(r"\d+", s): return ("hours", n)
    return None

def bucket_freq(p):
    """Frecuencia del bucket DCH -> (kind, value), mismo espacio que parse_freq."""
    tt = p["triggerType"]
    if tt in ("HOURS", "RUNNING_HOURS"): return ("hours", float(p["fh"])) if p["fh"] else None
    if tt in ("MONTHS", "CALENDAR"): return ("months", int(p["fm"])) if p["fm"] else None
    if tt == "DAY": return ("day", int(p["fm"])) if p["fm"] else None
    if tt == "WEEK": return ("week", int(p["fm"])) if p["fm"] else None
    return None

# Activos cuya descripción RCM no matchea por texto pero sí recuperables por
# FRECUENCIA dentro de los activos-excel listados (regex). Opt-in: no afecta al resto.
ALIAS = {
    # baterías/tablero EGA reales (excluye "Mbba de Incendio EGA portátil")
    "DCH-BAT-EGA": [r"bateria.*ega", r"iluminacion de emergencia", r"tablero de luces"],
}

# ── parsear Excel ─────────────────────────────────────────────────────────────
ws = openpyxl.load_workbook(XLSX, data_only=True)["Maquinas"]
def cell(r, c): return ws.cell(r, c).value
def is_note(b):
    n = norm(b); return n.startswith("ultimo recorrido") or n.startswith("trabajos no")

excel = defaultdict(list)  # assetName -> [(title, kind, value)]

# REGISTRO DE PRUEBAS (8-45): última = max de las fechas semanales G..J
for r in range(8, 46):
    b, e = cell(r,2), cell(r,5)
    if not e or not b: continue
    dates = []
    for c in (7,8,9,10):
        cg = classify_g(cell(r,c))
        if cg and cg[0]=="date": dates.append(cg[1])
    jt = cell(r,10)
    if isinstance(jt, str):
        for mm in re.findall(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", jt):
            cg = classify_g(mm)
            if cg and cg[0]=="date": dates.append(cg[1])
    if dates:
        # nombre de activo expandido; si es un motor, usar el nombre BASE
        # ("Motor Principal Estribor Seguridades" -> "Motor Principal Estribor")
        # para que resuelva dentro de la banda (la tarea va en el título E).
        exp = expand_abbr(b)
        mbase = re.match(r"(Motor (?:Principal|Auxiliar) (?:Estribor|Babor))", exp, re.I)
        key = mbase.group(1) if mbase else exp
        excel[key].append((str(e).strip(), "date", max(dates), parse_freq(cell(r, 6))))

# MANTENIMIENTO (57-319)
cur = None
for r in range(57, 320):
    b, e, g = cell(r,2), cell(r,5), cell(r,7)
    if b and not is_note(b): cur = str(b).strip()
    if not e or not cur: continue
    if norm(e).startswith("trabajos no"): continue
    cg = classify_g(g)
    if cg is None: continue
    excel[cur].append((str(e).strip(), cg[0], cg[1], parse_freq(cell(r, 6))))

# ── planes DCH ────────────────────────────────────────────────────────────────
plans = json.load(open(PLANS, encoding="utf-8"))

def plan_lines(p):
    """tareas del bucket: el título + líneas de description (sin marcadores).
    El título importa para planes tarea-única cuya description es solo una nota
    (ej. Alternador: title='Control aislación', desc='Transformador 380/220')."""
    out = [p["title"]]
    d = p.get("description")
    if d and str(d).strip():
        for ln in str(d).splitlines():
            ln = re.sub(r"^\s*\d+[\.\)]\s*", "", ln)         # "1. "
            ln = re.sub(r"^\s*\[\s*[xX ]?\s*\]\s*", "", ln)   # "[ ] "
            ln = ln.strip(" -•\t")
            if ln: out.append(ln)
    # dedup preservando orden
    seen, res = set(), []
    for x in out:
        k = norm(x)
        if k and k not in seen: seen.add(k); res.append(x)
    return res

def cand_entries(asset_name):
    # resolver al MEJOR activo del Excel + banda estrecha (evita mezclar
    # Motor Principal con Motor Auxiliar, N°1 con N°2, etc.)
    scored = [(a, sim(asset_name, a)) for a in excel]
    best = max((s for _, s in scored), default=0.0)
    if best < ASSET_TH: return [], best
    floor = max(ASSET_TH, best - 0.10)
    out = []
    for a, asc in scored:
        if asc >= floor:
            for (t, k, v, fr) in excel[a]: out.append((t, k, v, fr, asc))
    return out, best

def alias_entries(acode):
    """Entradas de los activos-excel que matchean las regex del ALIAS (bypass floor)."""
    pats = ALIAS.get(acode)
    if not pats: return []
    out = []
    for a, items in excel.items():
        na = norm(a)
        if any(re.search(p, na) for p in pats):
            for (t, k, v, fr) in items: out.append((t, k, v, fr, 1.0))
    return out

mapping = {}
report = {}
stats = {"full":0, "partial":0, "none":0, "hours":0, "date":0}
by_asset = defaultdict(list)
for p in plans: by_asset[(p["assetCode"], p["assetName"])].append(p)

for (acode, aname), ps in sorted(by_asset.items()):
    cands, abest = cand_entries(aname)
    acands = alias_entries(acode)
    lines_out = []
    for p in ps:
        want = "hours" if p["triggerType"] in ("HOURS","RUNNING_HOURS") else "date"
        tlines = plan_lines(p)
        matched = []   # (line, excelTitle, value)
        for ln in tlines:
            best, bs = None, 0.0
            for (t, k, v, fr, asc) in cands:
                if k != want: continue
                sc = sim(ln, t)
                if sc > bs: bs, best = sc, (t, k, v)
            if best and bs >= LINE_TH:
                matched.append((ln, best[0], best[2]))
        cov = f"{len(matched)}/{len(tlines)}"
        note = ""
        if matched:
            agg = max(m[2] for m in matched)
            stats["full" if len(matched)==len(tlines) else "partial"] += 1
        elif acands:
            # fallback por FRECUENCIA (solo activos en ALIAS)
            bf = bucket_freq(p)
            fv = [v for (t, k, v, fr, asc) in acands if k == want and fr and bf and fr == bf]
            if fv:
                agg = max(fv); cov = "freq"; note = " (freq)"
                stats["partial"] += 1
            else:
                stats["none"] += 1
                lines_out.append(f"   --  {cov:>5}  {p['title'][:34]:34} (sin match)")
                continue
        else:
            stats["none"] += 1
            lines_out.append(f"   --  {cov:>5}  {p['title'][:34]:34} (sin match)")
            continue
        if want == "hours":
            mapping[p["taskCode"]] = {"hours": agg, "cov": cov}
            vshow = f"{agg:g} h"; stats["hours"] += 1
        else:
            mapping[p["taskCode"]] = {"date": agg.isoformat(), "cov": cov}
            vshow = agg.isoformat(); stats["date"] += 1
        lines_out.append(f"   OK  {cov:>5}  {p['title'][:34]:34} -> {vshow}{note}")
    report[(acode, aname)] = lines_out

for (acode, aname), lns in sorted(report.items()):
    print(f"\n== {acode}  {aname} ==")
    for ln in lns: print(ln)

tot = len(plans)
print("\n" + "="*70)
print(f"PLANES {tot} | match {stats['full']+stats['partial']} (full {stats['full']}, parcial {stats['partial']}) "
      f"| sin match {stats['none']} | tipo: horas {stats['hours']}, fecha {stats['date']}")
json.dump(mapping, open(OUT,"w",encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"mapping -> {OUT}")
