# -*- coding: utf-8 -*-
"""Cruza el plan en papel de cada buque contra los planes cargados en el CMS3.

Es la version para toda la flota de analyze-don-chicueto-audit.py, que hacia lo
mismo para un solo buque. Clasifica cada tarea en cuatro:

  EN AMBOS           la tarea del papel tiene su plan en el sistema
  SOLO EXCEL         esta en la planilla y no quedo cargada
  SOLO CMS3          hay un plan vivo que la planilla no pide
  RUTINA DE GUARDIA  tarea diaria/semanal/quincenal de la ronda, que por diseno
                     no genera plan propio sino que va al plan consolidado

No escribe nada en la base: lee el dump read-only del VPS (out/flota-estado.json)
y los lotes que generan los parsers de cada planilla.

EMPAREJAMIENTO, en seis pasadas de mas exacta a mas laxa. Cada plan del sistema
se usa una sola vez; una pasada nunca le roba el par a una anterior:

  1. activo + titulo normalizado       identidad exacta de la tarea
  2. activo + sufijo del taskCode      el criterio con el que cargo el cargador
  3. activo + titulo parecido          la misma tarea escrita con otras palabras
  4. buque  + titulo normalizado       para las filas cuyo equipo no se pudo
  5. buque  + titulo parecido          resolver contra un activo
  6. agrupada en un plan ya emparejado cuando el sistema junta en un plan varias
                                       filas del papel

Las pasadas 4 y 5 existen porque el papel nombra equipos que no estan en el
sistema con ese nombre (las dos radios VHF son el mismo modelo, "IC-M412"): sin
ellas la misma tarea saldria contada dos veces, una en cada columna.

Los umbrales de parecido estan mas abajo, cada uno con el caso que lo justifica.

Uso: python scripts/vessel-plan-tools/audit-fleet-plans.py
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, "scripts/vessel-plan-tools")
from paper_assets import _palabras, normalizar  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

OUT = "scripts/vessel-plan-tools/out"
ESTADO = os.path.join(OUT, "flota-estado.json")
SALIDA = os.path.join(OUT, "auditoria-flota.json")

UMBRAL_ASSET = 0.58      # titulo parecido dentro del mismo activo
# Buscar en todo el buque es mas riesgoso que buscar dentro de un activo, asi que
# el umbral sube. Pero el riesgo depende de cuantos planes hay para elegir: en el
# LATERE hay 366 y confundirse es facil; en una barcaza hay 20 y no. Con un unico
# umbral alto, tareas de barcaza que si estan cargadas salian como faltantes
# (la planilla dice "VALVULAS DE P/V: Testeo de libre funcionamiento. Prueba
# neumatica" y el sistema "Valvulas P/V: Prueba Neumatica ANUAL").
UMBRAL_BUQUE = 0.80
UMBRAL_BUQUE_CHICO = 0.60
PLANES_BUQUE_CHICO = 40
# Margen para la comparacion contra el umbral: el puntaje se calcula con flotantes
# y un empate exacto (0.60 contra 0.60) puede dar 0.5999999 y quedar afuera.
EPS = 1e-9

# Los cargadores juntaron los inyectores de cada motor en un solo plan
# ("INYECTORES: Recorrido y calibracion N°1 a N°16"), mientras que la planilla
# los lista uno por uno. Sin juntarlos, un motor del LATERE aporta 16 filas
# "solo en el Excel" y un plan "solo en el CMS3" que en realidad son lo mismo.
RX_INYECTOR = re.compile(r"^inyector(es)?\s*(n[°º.]?|#)?\s*\d+", re.I)

# La misma tarea escrita distinto de cada lado. El papel usa el castellano de a
# bordo y el sistema el termino del cargador. Sin esto, "Recorrido general" del
# papel y "OVERHAUL" del sistema salen contados como dos tareas distintas.
# Se mantiene corto a proposito: cada par es una equivalencia verificada.
SINONIMOS = {
    "overhaul": "recorrido general",
    "renovacion": "cambio",
    "renovar": "cambio",
    "service": "cambio",
}

# Corte de cada planilla: hasta que fecha refleja el trabajo hecho a bordo. Una
# ultima ejecucion posterior a esta fecha no es un error de carga, es que la
# tarea se hizo despues de que se imprimio el papel.
CORTES = {"DCH": "2026-06-28", "LTE": "2026-07-31", "M01": "2026-07-31",
          "M02": "2026-07-31", "_barcazas": "2026-04-30"}


def norm_titulo(s):
    """Titulo a forma comparable: sin tildes, sin puntuacion, en minusculas."""
    return re.sub(r"\s+", " ", normalizar(s or "")).strip()


def _tokens(s):
    """Palabras del titulo, con los sinonimos ya unificados."""
    out = []
    for w in _palabras(s):
        out.extend(SINONIMOS.get(w, w).split())
    return set(out)


def _f2(pa, pb):
    if not pa or not pb:
        return 0.0
    c = len(pa & pb)
    if not c:
        return 0.0
    prec, rec = c / len(pa), c / len(pb)
    return 5 * prec * rec / (4 * prec + rec)


def similar(a, b):
    """Parecido entre dos titulos, 0 a 1, por palabras compartidas (F2).

    Los titulos del sistema llevan adelante la categoria del trabajo
    ("BATERIAS DE ARRANQUE: Cambio de grupo...") y el papel no, asi que tambien
    se compara contra lo que va despues de los dos puntos y gana el mejor de los
    dos: el prefijo no puede castigar a una tarea que es la misma.
    """
    pa = _tokens(a)
    mejor = _f2(pa, _tokens(b))
    if ":" in (b or ""):
        mejor = max(mejor, _f2(pa, _tokens(b.split(":", 1)[1])))
    return mejor


def suf(task_code):
    m = re.search(r"-(\d+)$", task_code or "")
    return m.group(1) if m else (task_code or "")


def fecha(v):
    return v[:10] if v else None


def num(v):
    return None if v is None else round(float(v), 3)


# --------------------------------------------------------------- lado papel --
def cargar_papel():
    """Junta los lotes de todas las planillas en una sola lista de filas."""
    filas = []

    def agregar(planes, vessel, origen, titulo):
        for p in planes:
            filas.append(dict(
                vessel=p.get("vessel") or vessel,
                asset=p.get("asset"), code=p.get("code"),
                title=p.get("title") or "",
                taskType=p.get("taskType"), triggerType=p.get("triggerType"),
                frequencyHours=p.get("frequencyHours"),
                frequencyMonths=p.get("frequencyMonths"),
                lastExecutionDate=p.get("lastExecutionDate"),
                lastExecutionHours=p.get("lastExecutionHours"),
                nextDueDate=p.get("nextDueDate"), nextDueHours=p.get("nextDueHours"),
                hoja=p.get("hoja") or titulo, fila=p.get("fila"),
                equipo=p.get("equipo"), origen=origen,
                motorPapel=p.get("motorPapel"), familia=p.get("familia"),
                assetPuntaje=p.get("assetPuntaje"), assetVia=p.get("assetVia"),
                assetAmbiguo=p.get("assetAmbiguo", False),
                frecuenciaTexto=p.get("frecuenciaTexto"),
                frecuenciaRutina=p.get("frecuenciaRutina"),
                frecuenciaHeredada=p.get("frecuenciaHeredada", False),
                critico=p.get("critico")))

    # DON CHICUETO: un archivo por hoja de la planilla.
    for f in sorted(glob.glob(os.path.join(OUT, "dch-*-plans.json"))):
        lote = json.load(open(f, encoding="utf-8"))
        hoja = re.sub(r"^dch-|-plans\.json$", "", os.path.basename(f))
        for p in lote["planes"]:
            p.setdefault("hoja", hoja)
        agregar(lote["planes"], "DCH", os.path.basename(f), lote.get("titulo", ""))

    # El resto: un archivo por buque (y uno para las 33 barcazas).
    for nombre, vessel in (("m02-plans.json", "M02"), ("m01-plans.json", "M01"),
                           ("lte-plans.json", "LTE"), ("barcazas-plans.json", None)):
        ruta = os.path.join(OUT, nombre)
        if not os.path.exists(ruta):
            print("   [!] falta %s — ese buque queda fuera de la auditoria" % nombre)
            continue
        lote = json.load(open(ruta, encoding="utf-8"))
        agregar(lote["planes"], lote.get("vessel") or vessel, nombre, lote.get("titulo", ""))
    return juntar_inyectores(filas)


def juntar_inyectores(filas):
    """Los inyectores de un mismo motor pasan a ser una sola fila.

    Es el mismo criterio con el que se cargaron: un plan por motor y no uno por
    inyector. Se conserva la primera fila y se le pone el titulo del conjunto.
    """
    vistos, out = {}, []
    for f in filas:
        if f["asset"] and RX_INYECTOR.match(f["title"] or ""):
            clave = (f["vessel"], f["asset"])
            if clave in vistos:
                vistos[clave]["_inyectores"] += 1
                continue
            f["_inyectores"] = 1
            vistos[clave] = f
        out.append(f)
    for f in vistos.values():
        n = f["_inyectores"]
        f["title"] = ("INYECTORES: Recorrido N°1 a N°%d" % n) if n > 1 else f["title"]
        f["notaPapel"] = ("la planilla lista %d inyectores por separado; el sistema los "
                          "lleva en un plan unico" % n) if n > 1 else None
    return out


# ------------------------------------------------------------- emparejador --
def emparejar(papel, vivos):
    """Devuelve {indice de fila del papel: (plan, via)} y los planes ya usados."""
    por_asset_titulo, por_asset_code, por_buque_titulo = {}, {}, {}
    for p in vivos:
        t = norm_titulo(p["title"])
        por_asset_titulo.setdefault((p["_asset"], t), []).append(p)
        por_asset_code.setdefault((p["_asset"], suf(p["taskCode"])), []).append(p)
        por_buque_titulo.setdefault((p["vesselCode"], t), []).append(p)

    por_buque = {}
    for p in vivos:
        por_buque.setdefault(p["vesselCode"], []).append(p)

    par_spec, usados = {}, set()

    def tomar(i, candidatos, via):
        for p in candidatos:
            if p["id"] not in usados:
                usados.add(p["id"])
                par_spec[i] = (p, via)
                return True
        return False

    # 1) activo + titulo exacto
    for i, s in enumerate(papel):
        if s["asset"]:
            tomar(i, por_asset_titulo.get((s["asset"], norm_titulo(s["title"])), []), "activo+titulo")
    # 2) activo + sufijo del codigo
    for i, s in enumerate(papel):
        if i not in par_spec and s["asset"] and s["code"]:
            tomar(i, por_asset_code.get((s["asset"], s["code"]), []), "activo+codigo")
    # 3) activo + titulo parecido
    for i, s in enumerate(papel):
        if i in par_spec or not s["asset"]:
            continue
        cand = [(similar(s["title"], p["title"]), p) for p in por_buque.get(s["vessel"], [])
                if p["_asset"] == s["asset"] and p["id"] not in usados]
        cand = sorted((c for c in cand if c[0] >= UMBRAL_ASSET - EPS), key=lambda x: -x[0])
        if cand:
            tomar(i, [cand[0][1]], "activo+titulo parecido")
    # 4) buque + titulo exacto (filas cuyo equipo no se pudo resolver)
    for i, s in enumerate(papel):
        if i not in par_spec and not s["asset"]:
            tomar(i, por_buque_titulo.get((s["vessel"], norm_titulo(s["title"])), []), "buque+titulo")
    # 5) buque + titulo parecido
    for i, s in enumerate(papel):
        if i in par_spec or s["asset"]:
            continue
        pool = por_buque.get(s["vessel"], [])
        umbral = UMBRAL_BUQUE_CHICO if len(pool) <= PLANES_BUQUE_CHICO else UMBRAL_BUQUE
        cand = [(similar(s["title"], p["title"]), p) for p in pool if p["id"] not in usados]
        cand = sorted((c for c in cand if c[0] >= umbral - EPS), key=lambda x: -x[0])
        if cand:
            tomar(i, [cand[0][1]], "buque+titulo parecido")

    # 6) La tarea ya esta cubierta por un plan que agrupa varias filas del papel.
    # El sistema junta en un plan lo que la planilla escribe en renglones
    # separados ("CONTROL: Luz de Valvulas, Correa de Transmision y Mangueras"
    # son tres filas del papel del MAO 01). Ese plan NO se consume: sigue siendo
    # el par de la fila que lo tomo primero, y estas quedan colgadas de el.
    usados_por_asset = {}
    for i, (p, _) in par_spec.items():
        usados_por_asset.setdefault((p["vesselCode"], p["_asset"]), []).append(p)
    for i, s in enumerate(papel):
        if i in par_spec or not s["asset"]:
            continue
        pal = _tokens(s["title"])
        for p in usados_por_asset.get((s["vessel"], s["asset"]), []):
            tp = _tokens(p["title"])
            # recall: cuanto de la fila del papel entra en el titulo del plan
            if pal and len(pal & tp) / len(pal) >= 0.75:
                par_spec[i] = (p, "agrupada en otro plan")
                break
    return par_spec, usados


# ---------------------------------------------------------------- analisis --
CAMPOS = [
    ("frecuencia (horas)", "frequencyHours", num),
    ("frecuencia (meses)", "frequencyMonths", num),
    ("ultima ejecucion (fecha)", "lastExecutionDate", fecha),
    ("ultima ejecucion (horas)", "lastExecutionHours", num),
    ("vencimiento (fecha)", "nextDueDate", fecha),
    ("vencimiento (horas)", "nextDueHours", num),
    ("tipo de tarea", "taskType", lambda x: x),
]


def diferencias(s, plan, corte):
    """Campos que no coinciden, y si el desvio se explica por una ejecucion nueva."""
    campos = []
    for etiqueta, campo, cmp_ in CAMPOS:
        a, b = s.get(campo), plan.get(campo)
        if campo.startswith("last") or campo.startswith("next"):
            b = fecha(b) if "Date" in campo else b
        if cmp_(a) != cmp_(b):
            campos.append(dict(campo=etiqueta, papel=a, sistema=b))
    # El sistema puede estar ADELANTADO: la tarea se ejecuto despues del corte de
    # la planilla y la OT movio la fecha. No es un error de carga.
    up, us = s.get("lastExecutionDate"), fecha(plan.get("lastExecutionDate"))
    adelantado = bool(up and us and us > up and us > corte)
    hp, hs = num(s.get("lastExecutionHours")), num(plan.get("lastExecutionHours"))
    if hp is not None and hs is not None and hs > hp:
        adelantado = True
    return campos, adelantado


def main():
    estado = json.load(open(ESTADO, encoding="utf-8"))
    assets = {a["id"]: a for a in estado["assets"]}
    wos = {w["maintenancePlanId"]: w["_count"]["_all"] for w in estado["wos"]}
    vessels = {v["vesselCode"]: v for v in estado["vessels"]}

    vivos = [p for p in estado["plans"] if not p["deletedAt"]]
    for p in vivos:
        a = assets.get(p["assetId"], {})
        p["_asset"] = a.get("assetCode")
        p["_activo"] = a.get("name")
        p["_motor"] = " ".join(filter(None, [a.get("manufacturer"), a.get("model")])) or None

    papel = cargar_papel()
    par_spec, usados = emparejar(papel, vivos)

    # Motor que declara el papel, por buque (viene de las barcazas).
    motor_papel = {}
    for s in papel:
        if s.get("motorPapel"):
            motor_papel[s["vessel"]] = s["motorPapel"]

    filas, resumen = [], {}

    def base(vessel):
        v = vessels.get(vessel, {})
        return dict(buque=vessel, buqueNombre=v.get("name"), tipo=v.get("vesselType"),
                    motorPapel=motor_papel.get(vessel))

    for i, s in enumerate(papel):
        par = par_spec.get(i)
        # Las tareas de la guardia (diaria, semanal, quincenal) no generan un plan
        # propio: van juntas en los planes consolidados de rutina. No son un hueco
        # de carga, asi que se cuentan aparte y no bajan la cobertura.
        rutina = not par and s.get("triggerType") == "RUTINA"
        f = base(s["vessel"])
        f.update(
            estado="RUTINA DE GUARDIA" if rutina else ("EN AMBOS" if par else "SOLO EXCEL"),
            via=par[1] if par else None,
            activo=s["asset"], equipoPapel=s.get("equipo"),
            taskCode=par[0]["taskCode"] if par else None,
            tituloPapel=s["title"], tituloSistema=par[0]["title"] if par else None,
            motorSistema=par[0]["_motor"] if par else None,
            activoNombre=par[0]["_activo"] if par else None,
            frecPapel=frec_txt(s), frecSistema=frec_txt(par[0]) if par else None,
            ultPapel=s.get("lastExecutionDate") or s.get("lastExecutionHours"),
            ultSistema=(fecha(par[0].get("lastExecutionDate")) or par[0].get("lastExecutionHours")) if par else None,
            vencePapel=s.get("nextDueDate") or s.get("nextDueHours"),
            venceSistema=(fecha(par[0].get("nextDueDate")) or par[0].get("nextDueHours")) if par else None,
            hoja=s.get("hoja"), fila=s.get("fila"),
            ots=wos.get(par[0]["id"], 0) if par else None,
            assetPuntaje=s.get("assetPuntaje"), assetVia=s.get("assetVia"),
            assetAmbiguo=s.get("assetAmbiguo"), critico=s.get("critico"),
            frecuenciaHeredada=s.get("frecuenciaHeredada"))
        if par:
            corte = CORTES.get(s["vessel"], CORTES["_barcazas"])
            campos, adelantado = diferencias(s, par[0], corte)
            f["difiere"] = "; ".join("%s: papel %s / sistema %s"
                                     % (c["campo"], c["papel"], c["sistema"]) for c in campos)
            f["adelantado"] = adelantado
        filas.append(f)

    for p in vivos:
        if p["id"] in usados:
            continue
        f = base(p["vesselCode"])
        f.update(estado="SOLO CMS3", via=None, activo=p["_asset"], equipoPapel=None,
                 taskCode=p["taskCode"], tituloPapel=None, tituloSistema=p["title"],
                 motorSistema=p["_motor"], activoNombre=p["_activo"],
                 frecPapel=None, frecSistema=frec_txt(p),
                 ultPapel=None, ultSistema=fecha(p.get("lastExecutionDate")) or p.get("lastExecutionHours"),
                 vencePapel=None, venceSistema=fecha(p.get("nextDueDate")) or p.get("nextDueHours"),
                 hoja=None, fila=None, ots=wos.get(p["id"], 0),
                 difiere="", adelantado=False)
        filas.append(f)

    for f in filas:
        r = resumen.setdefault(f["buque"], dict(
            buque=f["buque"], buqueNombre=f["buqueNombre"], tipo=f["tipo"],
            motorPapel=f["motorPapel"], papel=0, sistema=0,
            ambos=0, soloExcel=0, soloCms3=0, rutina=0, difieren=0))
        if f["estado"] == "EN AMBOS":
            r["ambos"] += 1; r["papel"] += 1
            if f.get("difiere"):
                r["difieren"] += 1
        elif f["estado"] == "SOLO EXCEL":
            r["soloExcel"] += 1; r["papel"] += 1
        elif f["estado"] == "RUTINA DE GUARDIA":
            r["rutina"] += 1
        else:
            r["soloCms3"] += 1
    # Los planes del sistema se cuentan del dump y no sumando filas: un plan que
    # cubre varias filas del papel aparece en varias filas de la auditoria y si
    # se sumara quedaria contado de mas.
    for p in vivos:
        if p["vesselCode"] in resumen:
            resumen[p["vesselCode"]]["sistema"] += 1
    for r in resumen.values():
        r["cobertura"] = round(100.0 * r["ambos"] / r["papel"], 1) if r["papel"] else None

    sinmapear = []
    for nombre in ("m01-plans.json", "lte-plans.json"):
        ruta = os.path.join(OUT, nombre)
        if os.path.exists(ruta):
            lote = json.load(open(ruta, encoding="utf-8"))
            for eq, punt in lote.get("sinMapear", []):
                sinmapear.append(dict(buque=lote.get("vessel"), equipo=eq, mejorPuntaje=punt))

    json.dump(dict(generado=estado["generado"], filas=filas,
                   resumen=sorted(resumen.values(), key=lambda r: r["buque"]),
                   sinMapear=sinmapear),
              open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---- informe por consola
    L = "=" * 96
    print(L)
    print("AUDITORIA DE PLANES — planillas del Owner contra el CMS3")
    print("dump del VPS: %s" % estado["generado"][:19])
    print(L)
    print("%-8s %-15s %6s %7s %6s %10s %9s %7s %6s" %
          ("BUQUE", "NOMBRE", "PAPEL", "SISTEMA", "AMBOS", "SOLO EXCEL", "SOLO CMS3", "RUTINA", "COB.%"))
    tot = dict(papel=0, sistema=0, ambos=0, soloExcel=0, soloCms3=0, rutina=0)
    for r in sorted(resumen.values(), key=lambda r: r["buque"]):
        print("%-8s %-15s %6d %7d %6d %10d %9d %7d %6s" %
              (r["buque"], (r["buqueNombre"] or "")[:15], r["papel"], r["sistema"],
               r["ambos"], r["soloExcel"], r["soloCms3"], r["rutina"],
               "-" if r["cobertura"] is None else r["cobertura"]))
        for k in tot:
            tot[k] += r[k]
    print("-" * 96)
    print("%-24s %6d %7d %6d %10d %9d %7d" %
          ("TOTAL", tot["papel"], tot["sistema"], tot["ambos"], tot["soloExcel"],
           tot["soloCms3"], tot["rutina"]))
    print("\nfilas de la auditoria: %d · equipos sin mapear: %d" % (len(filas), len(sinmapear)))
    vias = {}
    for f in filas:
        if f["via"]:
            vias[f["via"]] = vias.get(f["via"], 0) + 1
    print("emparejadas por: " + ", ".join("%s %d" % kv for kv in sorted(vias.items())))


def frec_txt(p):
    """Frecuencia legible: '3000 h', '12 m', o el disparo si no hay numero."""
    if p.get("frequencyHours"):
        return "%.0f h" % float(p["frequencyHours"])
    if p.get("frequencyMonths"):
        return "%g m" % float(p["frequencyMonths"])
    return p.get("frecuenciaRutina") or p.get("triggerType") or None


main()
