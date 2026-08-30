# -*- coding: utf-8 -*-
"""Audita la carga del plan del DON CHICUETO: planilla en papel vs sistema.

Compara los 20 lotes generados desde
`MisDocs/DCH/Mantenimiento/07- PMP DON CHICUETO - JULIO.xlsm`
contra el estado real de la base (`out/dch-estado.json`, dump read-only del VPS).

Emparejamiento en dos pasadas, independiente del orden de los lotes:
  1) activo + titulo normalizado   (identidad semantica de la tarea)
  2) activo + sufijo del taskCode  (el criterio que uso el cargador)

No escribe nada en la base.
"""
import json
import glob
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")

CARGA = "2026-08-18"          # la carga de las 20 hojas fue el 17-ago
PAPEL = "2026-06-28"          # ultima actualizacion declarada en la planilla

EST = json.load(open("scripts/vessel-plan-tools/out/dch-estado.json", encoding="utf-8"))
ASSETS = {a["id"]: a for a in EST["assets"]}
PLANS = EST["plans"]
WOS = {w["maintenancePlanId"]: w["_count"]["_all"] for w in EST["wos"]}
VIVOS = [p for p in PLANS if not p["deletedAt"]]
BORRADOS = [p for p in PLANS if p["deletedAt"]]


def suf(task_code):
    m = re.search(r"-(\d+)$", task_code or "")
    return m.group(1) if m else task_code


def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def fecha(v):
    return v[:10] if v else None


def num(v):
    return None if v is None else round(float(v), 3)


# ---- lo que dice el papel -------------------------------------------------
specs = []
for f in sorted(glob.glob("scripts/vessel-plan-tools/out/dch-*-plans.json")):
    lote = json.load(open(f, encoding="utf-8"))
    for p in lote["planes"]:
        p["_lote"] = lote["titulo"]
        p["_hoja"] = re.sub(r"^scripts.vessel-plan-tools.out.dch-|-plans\.json$", "", f)
        specs.append(p)

# Colisiones del generador: dos filas del papel (de hojas distintas) que caen en
# el mismo activo con el mismo sufijo de codigo. El cargador pisa una con la otra.
colisiones = {}
for i, s in enumerate(specs):
    colisiones.setdefault((s["asset"], s["code"]), []).append(i)
colisiones = {k: v for k, v in colisiones.items() if len(v) > 1}

# ---- indices del sistema --------------------------------------------------
for p in VIVOS:
    a = ASSETS.get(p["assetId"], {})
    p["_asset"] = a.get("assetCode", "?")
    p["_activo"] = a.get("name", "?")

por_titulo, por_clave = {}, {}
for p in VIVOS:
    por_titulo.setdefault((p["_asset"], norm(p["title"])), []).append(p)
    por_clave.setdefault((p["_asset"], suf(p["taskCode"])), []).append(p)

CAMPOS = [
    ("titulo", lambda s: s["title"], lambda p: p["title"], norm),
    ("disparo", lambda s: s["triggerType"], lambda p: p["triggerType"], lambda x: x),
    ("frec.horas", lambda s: s["frequencyHours"], lambda p: p["frequencyHours"], num),
    ("frec.meses", lambda s: s["frequencyMonths"], lambda p: p["frequencyMonths"], num),
    ("ult.ejec (fecha)", lambda s: s["lastExecutionDate"], lambda p: fecha(p["lastExecutionDate"]), lambda x: x),
    ("ult.ejec (horas)", lambda s: s["lastExecutionHours"], lambda p: p["lastExecutionHours"], num),
    ("vence (fecha)", lambda s: s["nextDueDate"], lambda p: fecha(p["nextDueDate"]), lambda x: x),
    ("vence (horas)", lambda s: s["nextDueHours"], lambda p: p["nextDueHours"], num),
    ("tipo", lambda s: s["taskType"], lambda p: p["taskType"], lambda x: x),
]

par_de_plan, par_de_spec = {}, {}
for i, s in enumerate(specs):                       # pasada 1: por titulo
    for p in por_titulo.get((s["asset"], norm(s["title"])), []):
        if p["id"] not in par_de_plan:
            par_de_plan[p["id"]] = i
            par_de_spec[i] = (p, "titulo")
            break
for i, s in enumerate(specs):                       # pasada 2: por codigo
    if i in par_de_spec:
        continue
    for p in por_clave.get((s["asset"], s["code"]), []):
        if p["id"] not in par_de_plan:
            par_de_plan[p["id"]] = i
            par_de_spec[i] = (p, "codigo")
            break

diffs, ejecutados = [], []
for i, s in enumerate(specs):
    if i not in par_de_spec:
        continue
    plan, via = par_de_spec[i]
    # El sistema puede estar ADELANTADO: la tarea se ejecuto despues del corte de
    # la planilla (28-jun) y la OT movio la ultima ejecucion. No es un error.
    ult_p, ult_s = s["lastExecutionDate"], fecha(plan["lastExecutionDate"])
    adelantado = bool(ult_p and ult_s and ult_s > ult_p and ult_s > PAPEL)
    hp, hs = num(s["lastExecutionHours"]), num(plan["lastExecutionHours"])
    if hp is not None and hs is not None and hs > hp:
        adelantado = True
    campos = []
    for campo, gs, gp, cmp_ in CAMPOS:
        a, b = gs(s), gp(plan)
        if cmp_(a) != cmp_(b):
            campos.append(dict(campo=campo, papel=a, sistema=b))
    if not campos:
        continue
    reg = dict(asset=s["asset"], taskCode=plan["taskCode"], title=s["title"],
               sistemaTitle=plan["title"], hoja=s["_hoja"], via=via, campos=campos,
               ots=WOS.get(plan["id"], 0), updatedAt=plan["updatedAt"][:10])
    (ejecutados if adelantado else diffs).append(reg)

sin_plan = [(i, specs[i]) for i in range(len(specs)) if i not in par_de_spec]
sobrantes = [p for p in VIVOS if p["id"] not in par_de_plan]
perdidos = {i for i, _ in sin_plan}

# ---- salida ---------------------------------------------------------------
L = "=" * 104
print(L)
print("AUDITORIA DON CHICUETO - planilla '07- PMP DON CHICUETO - JULIO.xlsm' vs sistema")
print(f"dump del VPS: {EST['generado'][:19]}   ·   corte de la planilla: {PAPEL}   ·   carga: 2026-08-17")
print(L)
print(f"  Filas de la planilla (20 hojas) : {len(specs)}")
print(f"  Planes vivos en el sistema      : {len(VIVOS)}    ({len(BORRADOS)} dados de baja)")
print(f"  Emparejados                     : {len(par_de_spec)}"
      f"  (por titulo {sum(1 for _, v in par_de_spec.values() if v == 'titulo')},"
      f" por codigo {sum(1 for _, v in par_de_spec.values() if v == 'codigo')})")
print()
print(f"  A) Filas del papel SIN plan en el sistema   : {len(sin_plan)}")
print(f"  B) Colisiones de codigo en el generador     : {len(colisiones)}")
print(f"  C) Diferencias reales (no explicadas)       : {len(diffs)}")
print(f"  D) Sistema adelantado (ejecutado despues)   : {len(ejecutados)}")
print(f"  E) Planes del sistema fuera de la planilla  : {len(sobrantes)}")

print("\n" + "-" * 104)
print(f"A) FILAS DE LA PLANILLA QUE NO QUEDARON EN EL SISTEMA - {len(sin_plan)}")
print("-" * 104)
for _, s in sorted(sin_plan, key=lambda x: (x[1]["asset"], x[1]["code"])):
    f = f"{s['frequencyHours']:.0f} h" if s["frequencyHours"] else f"{s['frequencyMonths']} m"
    print(f"  {s['asset']:<16} cod {s['code']:>3} {f:>8}   {s['title'][:60]:<62} [{s['_hoja']}]")

print("\n" + "-" * 104)
print(f"B) COLISIONES DE CODIGO - dos filas del papel con el mismo activo+codigo - {len(colisiones)}")
print("-" * 104)
for (asset, code), idxs in sorted(colisiones.items()):
    print(f"\n  {asset}-{code}")
    for i in idxs:
        s = specs[i]
        est = "PERDIDA" if i in perdidos else "quedo"
        print(f"    [{est:>7}] {s['title'][:74]:<76} [{s['_hoja']}]")

print("\n" + "-" * 104)
print(f"C) DIFERENCIAS PLANILLA vs SISTEMA (no explicadas por una ejecucion posterior) - {len(diffs)}")
print("-" * 104)
for d in sorted(diffs, key=lambda x: x["taskCode"]):
    print(f"\n  {d['taskCode']:<20} {d['title'][:70]}   [{d['hoja']}]  ({d['ots']} OT, edit {d['updatedAt']})")
    for c in d["campos"]:
        print(f"      {c['campo']:<18} papel: {str(c['papel'])[:40]:<42} sistema: {str(c['sistema'])[:40]}")

print("\n" + "-" * 104)
print(f"D) SISTEMA ADELANTADO - la tarea se ejecuto despues del corte de la planilla - {len(ejecutados)}")
print("-" * 104)
for d in sorted(ejecutados, key=lambda x: x["taskCode"]):
    campos = " · ".join(f"{c['campo']}: {c['papel']} -> {c['sistema']}" for c in d["campos"])
    print(f"  {d['taskCode']:<20} {d['title'][:44]:<46} {campos[:118]}")

print("\n" + "-" * 104)
print(f"E) EN EL SISTEMA PERO NO EN LA PLANILLA - {len(sobrantes)}")
print("-" * 104)
porasset = {}
for p in sobrantes:
    porasset.setdefault((p["_asset"], p["_activo"]), []).append(p)
for (code, nombre), ps in sorted(porasset.items()):
    print(f"\n  {code}  ({nombre})")
    for p in sorted(ps, key=lambda x: x["taskCode"]):
        f = (f"{p['frequencyHours']:.0f} h" if p["triggerType"] == "HOURS" and p["frequencyHours"]
             else (f"{p['frequencyMonths']} m" if p["frequencyMonths"] else p["triggerType"]))
        ot = f"  [{WOS[p['id']]} OT]" if p["id"] in WOS else ""
        print(f"    {p['taskCode']:<20} {f:>8}  {p['title'][:66]}{ot}")

json.dump({"sinPlan": [s for _, s in sin_plan],
           "colisiones": {f"{k[0]}-{k[1]}": [specs[i] for i in v] for k, v in colisiones.items()},
           "diffs": diffs, "ejecutados": ejecutados,
           "sobrantes": [{k: v for k, v in p.items() if k != "description"} for p in sobrantes]},
          open("scripts/vessel-plan-tools/out/dch-auditoria.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1, default=str)
