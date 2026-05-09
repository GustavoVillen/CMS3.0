#!/usr/bin/env python3
"""
Normalize the raw JSON dumps into a unified structure:

{
  "vessels": [{ "code": "LATERE", "name": "..." }],
  "systems": [{ "vesselCode", "code", "name" }],
  "equipment": [{ "vesselCode", "systemCode", "code", "name", "manufacturer", "model" }],
  "plans": [{
      "vesselCode", "systemCode", "title", "description",
      "trigger": "HOURS"|"MONTHS",
      "frequencyHours": int|null,
      "frequencyMonths": int|null,
      "isInspection": bool,
      "items": [{ "equipment": "...", "task": "..." }]
  }],
  "spares": [{ "motor": "CAT", "name": "...", "partNumber": "...", "minQty": int, "criticality": "ALTA"|"MEDIA"|"BAJA", "vessels": ["MGT 10",...] }],
  "certificates": [{ "vessel", "name", "issuer", "manager", "issueDate", "expiryDate", "validity", "notes" }]
}
"""
import json
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

DATA = Path(r"c:\NPMS\GPMS\scripts\mercurio-import\data")
OUT = Path(r"c:\NPMS\GPMS\scripts\mercurio-import\normalized")
OUT.mkdir(parents=True, exist_ok=True)


def load(name):
    with open(DATA / name, encoding="utf-8") as f:
        return json.load(f)


# ─────────────────────────────────────────────────────────────────────────────
# FRECUENCIA: parser
# ─────────────────────────────────────────────────────────────────────────────
TEXT_FREQ_MONTHS = {
    "diaria": 0,            # ignorada para meses; se trata como semanal/mensual
    "semanal": 0,           # 0 = no se carga como meses, se ignora
    "quincenal": 0,
    "mensual": 1,
    "bimestral": 2,
    "trimestral": 3,
    "cuatrimestral": 4,
    "semestral": 6,
    "anual": 12,
    "bi anual": 24,
    "bianual": 24,
    "bienal": 24,
    "5 años": 60,
    "5 anios": 60,
    "5 años / dique seco": 60,
    "6 años": 72,
    "6 años / dique seco": 72,
    "12 meses": 12,
    "18 meses": 18,
    "24 meses": 24,
    "anualmente": 12,
}


def parse_frequency(raw):
    """Return (trigger, hours, months, friendly_label)"""
    if raw is None:
        return None, None, None, None
    if isinstance(raw, (int, float)):
        h = int(raw)
        if h <= 0:
            return None, None, None, None
        return "HOURS", h, None, f"{h}h"
    s = str(raw).strip().lower()
    if not s:
        return None, None, None, None
    s_clean = s.replace("í", "i").replace("é", "e").replace("ó", "o").replace("ú", "u").replace("ñ", "n")
    # Hours pattern: "300 hs", "500 horas", "1000 h", just digits
    m = re.match(r"^\s*(\d+)\s*(hs|h|horas|hour)?\s*$", s_clean)
    if m and (m.group(2) is None or "h" in m.group(2)):
        h = int(m.group(1))
        if h > 0:
            return "HOURS", h, None, f"{h}h"
    # Pure digits?
    m = re.match(r"^\s*(\d+)\s*$", s_clean)
    if m:
        h = int(m.group(1))
        if h > 0:
            return "HOURS", h, None, f"{h}h"
    # Map text frequencies — check longest keys first so "bi anual" matches before "anual"
    for key in sorted(TEXT_FREQ_MONTHS.keys(), key=len, reverse=True):
        if key in s_clean:
            mo = TEXT_FREQ_MONTHS[key]
            if mo > 0:
                return "MONTHS", None, mo, key
            return "MONTHS", None, 1, key
    # Pattern "N MESES" / "N AÑOS" / "N años"
    m = re.match(r"^\s*(\d+)\s*(meses|mes|months|m)\b", s_clean)
    if m:
        return "MONTHS", None, int(m.group(1)), s
    m = re.match(r"^\s*(\d+)\s*(an[io]s?|años?|years?)\b", s_clean)
    if m:
        return "MONTHS", None, int(m.group(1)) * 12, s
    return None, None, None, str(raw)


# ─────────────────────────────────────────────────────────────────────────────
# INSPECTION classifier
# ─────────────────────────────────────────────────────────────────────────────
INSPECTION_KEYWORDS = re.compile(
    r"\b(inspecci(o|ó)n|verificar|verificacion|control|controlar|tomar aislacion|tomar aislación|prueba|testeo|chequeo|recorrido(?!\s+general)|inspeccion visual)\b",
    re.IGNORECASE,
)
WORK_KEYWORDS = re.compile(
    r"\b(cambio|cambiar|reemplaz|engrase|engrasar|ajuste|ajustar|limpieza|limpiar|apriete|recorrido general|reparar|reemplaz|calibracion|calibración|recambio|cargar|rellenar|purgar)\b",
    re.IGNORECASE,
)


def is_inspection_only(task_text):
    if not task_text:
        return False
    t = str(task_text).lower()
    if WORK_KEYWORDS.search(t):
        return False
    if INSPECTION_KEYWORDS.search(t):
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM CODE mapping
# ─────────────────────────────────────────────────────────────────────────────
def normalize_text(s):
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).strip())


SYSTEM_MAP_DONCHI_LATERE = {
    # sheet name → (systemCode, systemName)
    "MM.PP Eb.":          ("PROP-EB", "Motor Principal Estribor"),
    "MM.PP Bb.":          ("PROP-BB", "Motor Principal Babor"),
    "MM.PP Bb. Centro":   ("PROP-BBC","Motor Principal Babor Centro"),
    "MM.PP Eb. Centro":   ("PROP-EBC","Motor Principal Estribor Centro"),
    "MM.AA. N°1 Bb": ("AUX-01", "Motor Auxiliar N°1 Babor"),
    "MM.AA. N°2 Eb.":("AUX-02", "Motor Auxiliar N°2 Estribor"),
    "MM.AA. N°3 Puerto":("AUX-03","Motor Auxiliar N°3 Puerto"),
    "CAJAS":              ("CAJ",    "Cajas Reductoras"),
    "ALTERNADORES":       ("ALT",    "Alternadores"),
    "BOMBAS":             ("BBA",    "Bombas"),
    "COMPRESORES Y BOTELLONES": ("AIR", "Compresores y Botellones de Aire"),
    "SIST DE GOBIERNO ":  ("GOB",    "Sistema de Gobierno"),
    "LINEA DE EJE Y HELICE": ("EJE", "Línea de Eje y Hélice"),
    "CABRESTANTE":        ("CAB",    "Cabrestante"),
    "MOTOR LANCHA DE TRABAJO":   ("LAN-01","Motor Lancha de Trabajo"),
    "MOTOR LANCHA DE TRABAJO 1": ("LAN-01","Motor Lancha de Trabajo 1"),
    "MOTOR LANCHA DE TRABAJO 2": ("LAN-02","Motor Lancha de Trabajo 2"),
    "SEPARADOR":          ("SEP",    "Separador de Sentina"),
    "PURIFICADORA":       ("PUR",    "Purificadora"),
    " CTRAL HIDRAULICA guinche-pluma": ("HID","Central Hidráulica"),
    "CTRAL HIDRAULICA guinche-pluma":  ("HID","Central Hidráulica"),
    "ENGRASE":            ("ENG",    "Engrase"),
    "EQUIPOS CRITICOS":   ("EQC",    "Equipos Críticos"),
    "SEWAGE":             ("SEW",    "Sewage / Tratamiento Efluentes"),
    "TOMAS DE MAR":       ("TOM",    "Tomas de Mar"),
    "TERMOTANQUES":       ("TER",    "Termotanques"),
    "COCINA TERMOTANQUES":("TER",    "Cocina y Termotanques"),
    "AIRE ACOND. CENTRAL":("CLI",    "Aire Acondicionado Central"),
}


# ─────────────────────────────────────────────────────────────────────────────
# Parser PMP-style sheets (LATERE/DONCHI)
# ─────────────────────────────────────────────────────────────────────────────
def find_header_columns(rows, max_scan=5):
    """Locate header row and return mapping: column_index -> column_role.
    Roles: equipo, trabajo, ultimo, proximo, frecuencia, horas_restantes, dias_restantes
    """
    role_aliases = {
        "trabajo a relizar": "trabajo",
        "trabajo a realizar": "trabajo",
        "trabajo":            "trabajo",
        "ultimo trabajo":     "ultimo",
        "proximo trabajo":    "proximo",
        "frecuencia":         "frecuencia",
        "horas restantes":    "horas_restantes",
        "dias restantes":     "dias_restantes",
        "días restantes":     "dias_restantes",
    }
    for r_idx, row in enumerate(rows[:max_scan]):
        roles = {}
        equipo_col = None
        for c_idx, cell in enumerate(row):
            if cell is None: continue
            s = normalize_text(cell).lower()
            s2 = s.replace("í","i").replace("é","e").replace("ó","o").replace("ú","u")
            mapped = role_aliases.get(s2)
            if mapped:
                roles[mapped] = c_idx
            elif equipo_col is None and s2 and "trabajo" not in s2 and "actualizaci" not in s2 and "frecuencia" not in s2:
                # First column with text that isn't a known role label = "equipo" col
                equipo_col = c_idx
        if "trabajo" in roles and "frecuencia" in roles:
            roles["equipo"] = equipo_col
            roles["_header_row"] = r_idx
            return roles
    return None


def parse_pmp_sheet(rows, sheet_name, vessel_code):
    """Return list of {equipment, task, frequency_raw, trigger, hours, months, is_inspection}."""
    if sheet_name not in SYSTEM_MAP_DONCHI_LATERE:
        return None
    sys_code, sys_name = SYSTEM_MAP_DONCHI_LATERE[sheet_name]
    cols = find_header_columns(rows)
    if not cols:
        return None
    out_tasks = []
    eq_col   = cols.get("equipo")
    task_col = cols["trabajo"]
    freq_col = cols["frecuencia"]
    header_row = cols["_header_row"]
    for row in rows[header_row + 1:]:
        # Pad row
        max_col = max(eq_col or 0, task_col, freq_col) + 1
        if len(row) < max_col:
            row = list(row) + [None] * (max_col - len(row))
        equipment = normalize_text(row[eq_col]) if eq_col is not None else ""
        task      = normalize_text(row[task_col])
        freq_raw  = row[freq_col]
        if not task:
            continue
        # Skip rows without equipment label, but allow rows with merged equipment if task is meaningful
        if not equipment:
            equipment = "—"
        # Skip header repeats
        if "trabajo a re" in task.lower() or task.lower().startswith("trabajo"):
            continue
        trigger, hours, months, label = parse_frequency(freq_raw)
        if trigger is None:
            continue
        out_tasks.append({
            "vesselCode":   vessel_code,
            "systemCode":   sys_code,
            "systemName":   sys_name,
            "equipment":    equipment,
            "task":         task,
            "frequencyRaw": freq_raw if isinstance(freq_raw, (int, float, str)) else str(freq_raw),
            "trigger":      trigger,
            "hours":        hours,
            "months":       months,
            "label":        label,
            "isInspection": is_inspection_only(task),
        })
    return out_tasks


# ─────────────────────────────────────────────────────────────────────────────
# Parser plan-barcazas-2025: ITEM | EQUIPO | FRECUENCIA | DESCRIPCION
# ─────────────────────────────────────────────────────────────────────────────
SHEET_TO_GROUP = {
    "Plan de Mant. JOHN - MGT 01-09":    ("JOHN-DEERE", ["MGT 01","MGT 02","MGT 03","MGT 04","MGT 05","MGT 06","MGT 07","MGT 08","MGT 09"]),
    "Plan de Mant. CAT - MGT 10-15 ":    ("CAT-C7",     ["MGT 10","MGT 11","MGT 12","MGT 13","MGT 14","MGT 15"]),
    "Plan de Mant. MWM GLT 007-008":     ("MWM-6.10",   ["GLT 007","GLT 008"]),
    "Plan de Mant. CAT - GLT001":        ("CAT-C7",     ["GLT 001"]),
    "Plan de Mant. JOHN - MGT 16-27":    ("JOHN-DEERE", ["MGT 16","MGT 17","MGT 18","MGT 19","MGT 20","MGT 21","MGT 22","MGT 23","MGT 24","MGT 25","MGT 26","MGT 27"]),
    "Plan de Mant. YT":                  ("DETROIT",    ["YT 005","YT 010","YT 012","YT 013","YT 015","YT 022"]),
}


# Equipment keyword to system mapping for barcazas (since Plan Barcazas is system-driven by row content)
EQUIP_TO_SYSTEM = [
    (re.compile(r"v[aá]lvulas? de p/v",    re.I),  ("TNQ",   "Tanques de Carga")),
    (re.compile(r"l[ií]neas? de incendio", re.I),  ("CIN",   "Lucha Contraincendio")),
    (re.compile(r"mangueras lci",               re.I),  ("CIN",   "Lucha Contraincendio")),
    (re.compile(r"extintores",                   re.I),  ("CIN",   "Lucha Contraincendio")),
    (re.compile(r"sistema de cargamento",        re.I),  ("CRG",   "Sistema de Cargamento")),
    (re.compile(r"paradas de emergencia",        re.I),  ("EMG",   "Paradas de Emergencia")),
    (re.compile(r"v[aá]lvulas sobre cubierta", re.I), ("CUB", "Válvulas sobre Cubierta")),
    (re.compile(r"porta\s*precintos",            re.I),  ("CUB",   "Válvulas sobre Cubierta")),
    (re.compile(r"cartelerias|cartelerias|cartelas|cartel", re.I), ("CUB", "Válvulas sobre Cubierta")),
    (re.compile(r"alarmas? de nivel",            re.I),  ("ALR",   "Alarmas")),
    (re.compile(r"casco",                        re.I),  ("CSC",   "Casco")),
    (re.compile(r"man[oó]metros",           re.I),  ("INS",   "Instrumentación")),
    (re.compile(r"compresor",                    re.I),  ("AIR",   "Compresores")),
    (re.compile(r"bomba",                        re.I),  ("BBA",   "Bombas")),
    (re.compile(r"motor.+(john deere|caterpillar|cat|cummins|mwm|detroit)", re.I), ("PROP", "Motor Principal")),
    (re.compile(r"motor",                        re.I),  ("PROP",  "Motor Principal")),
    (re.compile(r"luces de navegaci",            re.I),  ("NAV",   "Navegación")),
    (re.compile(r"instalaci[oó]n el[eé]ctrica", re.I), ("ELE", "Sistema Eléctrico")),
    (re.compile(r"acople flexible",              re.I),  ("PROP",  "Motor Principal")),
    (re.compile(r"paso de hombre|registro|piques", re.I), ("CSC",  "Casco")),
]


def equip_to_system(equip_name):
    if not equip_name:
        return ("OTROS", "Otros")
    for rgx, mapping in EQUIP_TO_SYSTEM:
        if rgx.search(equip_name):
            return mapping
    return ("OTROS", "Otros")


def parse_barcazas_sheet(rows, sheet_name):
    """Returns tasks dict keyed by vessel."""
    if sheet_name not in SHEET_TO_GROUP:
        return None
    motor, vessel_codes = SHEET_TO_GROUP[sheet_name]
    out = []
    last_equipment = None
    # Detect column offset: some sheets have leading empty column (col 0 = None always)
    offset = 0
    if rows and len(rows) >= 3:
        sample_row = rows[2]
        if len(sample_row) >= 5 and sample_row[0] is None and sample_row[1] is not None:
            offset = 1
    for row in rows[2:]:
        if len(row) < 4 + offset:
            row = list(row) + [None] * (4 + offset - len(row))
        item   = normalize_text(row[0 + offset])
        equip  = normalize_text(row[1 + offset])
        freq   = row[2 + offset]
        desc   = normalize_text(row[3 + offset])
        if not equip and not desc:
            continue
        if not equip and last_equipment:
            equip = last_equipment
        if equip:
            last_equipment = equip
        if not freq or not desc:
            continue
        trigger, hours, months, label = parse_frequency(freq)
        if trigger is None:
            continue
        sys_code, sys_name = equip_to_system(equip)
        for vc in vessel_codes:
            vc_clean = vc.replace(" ", "")
            out.append({
                "vesselCode":   vc_clean,
                "vesselDisplay":vc,
                "motor":        motor,
                "systemCode":   sys_code,
                "systemName":   sys_name,
                "equipment":    equip,
                "task":         desc,
                "frequencyRaw": freq if isinstance(freq, (int, float, str)) else str(freq),
                "trigger":      trigger,
                "hours":        hours,
                "months":       months,
                "label":        label,
                "isInspection": is_inspection_only(desc),
            })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Spares parser
# ─────────────────────────────────────────────────────────────────────────────
SPARES_VESSEL_PATTERNS = re.compile(r"(MGT \d+|GLT \d+|YT \d+|LATERE|DON CHICUETO|MAO \d+)", re.IGNORECASE)


def parse_spares_motores(rows):
    """Sheet 'MOTORES' — multi-section table."""
    out = []
    current_motor = None
    current_vessels = []
    for row in rows:
        if len(row) < 9:
            row = list(row) + [None] * (9 - len(row))
        c_motor   = normalize_text(row[2])
        c_part    = normalize_text(row[3])
        c_model   = normalize_text(row[4])
        c_qty     = row[5]
        c_crit    = normalize_text(row[6])
        c_vessels = normalize_text(row[7])
        if c_motor and c_motor.upper() not in ("MOTORES", "REPUESTOS"):
            current_motor = c_motor.upper()
        if c_vessels:
            vessels_found = SPARES_VESSEL_PATTERNS.findall(c_vessels)
            if vessels_found:
                current_vessels = [v.replace(" ", "") for v in vessels_found]
        if c_part and c_model and current_motor:
            try:
                qty = int(c_qty) if c_qty is not None else None
            except (ValueError, TypeError):
                qty = None
            crit_norm = "B"
            if c_crit:
                if "alta" in c_crit.lower():    crit_norm = "A"
                elif "media" in c_crit.lower(): crit_norm = "B"
                elif "baja" in c_crit.lower():  crit_norm = "C"
            out.append({
                "motor":      current_motor,
                "name":       c_part,
                "partNumber": c_model,
                "minQty":     qty,
                "criticality":crit_norm,
                "vessels":    list(current_vessels),
            })
    return out


def parse_spares_engine_sheet(rows, motor_label):
    """Sheets 'John Deere', 'MWM', 'DETROIT' — simple Component | PartNumber | Qty."""
    out = []
    for row in rows[2:]:
        if len(row) < 4:
            row = list(row) + [None] * (4 - len(row))
        comp = normalize_text(row[1])
        part = normalize_text(row[2])
        qty  = row[3]
        if not comp or not part:
            continue
        try:
            q = int(qty) if qty is not None else None
        except (ValueError, TypeError):
            q = None
        out.append({
            "motor":      motor_label,
            "name":       comp,
            "partNumber": part,
            "minQty":     q,
            "criticality":"B",
            "vessels":    [],
        })
    return out


def parse_spares_cat_sheet(rows):
    """Sheet 'CAT' — three side-by-side tables (MWM, Detroit, CAT C7)."""
    out = []
    for row in rows[3:]:
        if len(row) < 11:
            row = list(row) + [None] * (11 - len(row))
        # MWM (cols 0-2)
        if normalize_text(row[0]) and normalize_text(row[1]):
            try: q = int(row[2]) if row[2] is not None else None
            except: q = None
            out.append({"motor":"MWM-EXT", "name": row[0], "partNumber": row[1], "minQty": q, "criticality":"B", "vessels":[]})
        # Detroit (cols 4-6)
        if normalize_text(row[4]) and normalize_text(row[5]):
            try: q = int(row[6]) if row[6] is not None else None
            except: q = None
            out.append({"motor":"DETROIT-EXT", "name": row[4], "partNumber": row[5], "minQty": q, "criticality":"B", "vessels":[]})
        # CAT C7 (col 10+) — descriptive only, no part number in this section
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Certificates parser
# ─────────────────────────────────────────────────────────────────────────────
def parse_certificates(rows):
    out = []
    # Header at row 3 (index 2): Embarcacion | Certificado | Gestiona | Vto. | Faltan Dias | Estado | Expedido | Fecha de Exp. | Validez | Observacion
    headers = rows[2] if len(rows) > 2 else []
    for row in rows[3:]:
        if len(row) < 10:
            row = list(row) + [None] * (10 - len(row))
        vessel = normalize_text(row[0])
        name   = normalize_text(row[1])
        manager= normalize_text(row[2])
        expiry = row[3]
        issuer = normalize_text(row[6])
        issued = row[7]
        validity = normalize_text(row[8])
        notes  = normalize_text(row[9])
        if not vessel or not name:
            continue
        out.append({
            "vessel":  vessel,
            "name":    name,
            "manager": manager,
            "issuer":  issuer,
            "issueDate":  issued if issued else None,
            "expiryDate": expiry if expiry else None,
            "validity":validity,
            "notes":   notes,
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    out = {
        "vessels": [],
        "tasks":   [],         # raw normalized tasks from PMPs
        "barcazasTasks": [],   # raw normalized tasks from plan-barcazas
        "spares":  [],
        "certificates": [],
    }

    # === LATERE ===
    latere = load("pmp-latere.json")
    for sn, sd in latere["sheets"].items():
        parsed = parse_pmp_sheet(sd["rows"], sn, "LATERE")
        if parsed:
            out["tasks"].extend(parsed)

    # === DONCHI ===
    donchi = load("pmp-donchi.json")
    for sn, sd in donchi["sheets"].items():
        parsed = parse_pmp_sheet(sd["rows"], sn, "DONCHI")
        if parsed:
            out["tasks"].extend(parsed)

    # === BARCAZAS ===
    barc = load("plan-barcazas-2025.json")
    for sn, sd in barc["sheets"].items():
        parsed = parse_barcazas_sheet(sd["rows"], sn)
        if parsed:
            out["barcazasTasks"].extend(parsed)

    # === SPARES ===
    rep = load("repuestos-criticos.json")
    out["spares"].extend(parse_spares_motores(rep["sheets"]["MOTORES"]["rows"]))
    out["spares"].extend(parse_spares_engine_sheet(rep["sheets"]["John Deere"]["rows"], "JOHN-DEERE-FULL"))
    out["spares"].extend(parse_spares_engine_sheet(rep["sheets"]["MWM"]["rows"], "MWM-FULL"))
    out["spares"].extend(parse_spares_engine_sheet(rep["sheets"]["DETROIT"]["rows"], "DETROIT-FULL"))

    # === FLOTA: vessels list ===
    flota_rows = rep["sheets"]["FLOTA"]["rows"]
    for row in flota_rows[1:]:
        if len(row) < 2 or not row[0]:
            continue
        name = normalize_text(row[0])
        matricula = normalize_text(row[1])
        tipo = normalize_text(row[2]) if len(row) > 2 else None
        out["vessels"].append({
            "name": name,
            "code": name.replace(" ", ""),
            "matricula": matricula,
            "tipo": tipo,
        })

    # === CERTIFICATES ===
    cert = load("certificados.json")
    out["certificates"] = parse_certificates(cert["sheets"]["BaseCertificados"]["rows"])

    # ── Stats
    stats = {
        "vessels":            len(out["vessels"]),
        "tasksLATERE":        sum(1 for t in out["tasks"] if t["vesselCode"] == "LATERE"),
        "tasksDONCHI":        sum(1 for t in out["tasks"] if t["vesselCode"] == "DONCHI"),
        "barcazasTasks":      len(out["barcazasTasks"]),
        "spares":             len(out["spares"]),
        "certificates":       len(out["certificates"]),
    }
    print("Stats:", json.dumps(stats, indent=2))

    out_path = OUT / "all.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, default=str, indent=1)
    print(f"\n-> {out_path} ({out_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
