# -*- coding: utf-8 -*-
"""Generador de lote para las hojas del plan en papel del DON CHICUETO.

A diferencia del LATERE, el plan del DCH es uniforme: todas las hojas tienen la
misma fila de encabezado ("TRABAJO A RELIZAR", "ULTIMO TRABAJO", "PROXIMO
TRABAJO", "FRECUENCIA") y la columna anterior al trabajo nombra el componente o
el equipo. Por eso una sola configuracion cubre las 20 hojas.

Dos formas de hoja:
  - `asset`: hoja de un solo equipo (los motores). La columna previa nombra el
    COMPONENTE intervenido y todas las filas van al mismo activo.
  - `equipos`: hoja de varios equipos. Esa columna nombra el EQUIPO y decide a
    que activo va cada fila. Si el destino es una lista, la fila se duplica en
    cada activo: el papel trata algunas bombas de a pares en una sola linea
    ("agua potable BR y ER") y cada bomba tiene que llevar su propio historial.

El ultimo y el proximo trabajo vienen como fecha o como horas de servicio segun
la frecuencia de la tarea, en las mismas columnas.

Uso:
    python scripts/vessel-plan-tools/build-don-chicueto-plans-from-excel.py "MM.PP Bb."
    python scripts/vessel-plan-tools/build-don-chicueto-plans-from-excel.py --todas
"""
import json
import re
import sys
import warnings

import openpyxl

sys.path.insert(0, "scripts/vessel-plan-tools")
from paper_plan_common import as_date, as_num, norm, parse_frecuencia, add_months  # noqa: E402

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

SRC = "MisDocs/DCH/Mantenimiento/07- PMP DON CHICUETO - JULIO.xlsm"

# Verbos con los que arranca una tarea de verificacion; el resto es intervencion.
RX_INSPECCION = re.compile(
    r"^\s*(verificar|verificaci|control|controlar|inspecci|inspeccionar|comprobar|"
    r"tomar|toma de|prueba|probar|test|chequeo|chequear|muestreo|medici|analisis|"
    r"registrar|protocolo|angulo de pala|presi.n de encloche|manch.n|"
    r"tapas de observaci|alarmas|v.lvula rotativa|sistema neumatico|efic|"
    r"bujias|bateria de lancha|limpieza del panel)", re.I)

# Tareas de los motores auxiliares: identicas en los tres, con los mismos reusos.
REUSA_MMAA = [
    (r"cambio de filtro y\s+aceite del carter", "01"),
    (r"cambio de filtros de gas-oil", "03"),
    (r"luz de valvulas y timing", "08"),
    (r"cambio por recorridos con elementos nuevos", "11"),
    (r"reemplazo de bateria", "20"),
    (r"muestreo de aceites", "06"),
]
REUSA_MMPP = [
    (r"realizar el cambio del aceite", "01"),
    (r"cambio de filtros de combustible", "07"),
    (r"inspeccion visual elementos culata", "08"),
    (r"efectuar cambio de inyectores", "10"),
    (r"recorrido culatas, camisas y pistones", "16"),
    (r"muestreo de aceites", "18"),
    (r"reemplazo de baterias", "20"),
    (r"^recorrido general, regist\. novedades$", "24"),   # bombas de agua
]

HOJAS = {
    "MM.PP Bb.": dict(titulo="DON CHICUETO / MOTOR PRINCIPAL BABOR",
                      asset="DCH-MP-BR", reusa=REUSA_MMPP),
    "MM.PP Eb.": dict(titulo="DON CHICUETO / MOTOR PRINCIPAL ESTRIBOR",
                      asset="DCH-MP-ER", reusa=REUSA_MMPP),

    "MM.AA. Nº1 Bb": dict(titulo="DON CHICUETO / MOTOR AUXILIAR BABOR",
                          asset="DCH-MA-BR", reusa=REUSA_MMAA),
    "MM.AA. Nº2 Eb.": dict(titulo="DON CHICUETO / MOTOR AUXILIAR ESTRIBOR",
                           asset="DCH-MA-ER", reusa=REUSA_MMAA),
    "MM.AA. Nº3 Puerto": dict(titulo="DON CHICUETO / MOTOR AUXILIAR PUERTO",
                              asset="DCH-MA-PTO", reusa=REUSA_MMAA),

    "CAJAS": dict(
        titulo="DON CHICUETO / CAJAS REDUCTORAS",
        equipos=[(r"caja er", "DCH-CR-ER"), (r"caja br", "DCH-CR-BR")],
        reusa=[(r"aceite . cambiar", "02"),
               (r"muestreo de aceites", "03"),
               (r"inspeccion (abierta y limpia|por pna)", "05")],
    ),
    "ALTERNADORES": dict(
        titulo="DON CHICUETO / ALTERNADORES",
        equipos=[(r"alternador n.1 er", "DCH-ALT-ER"),
                 (r"alternador n.2 br", "DCH-ALT-BR"),
                 (r"alternador n.3 puerto", "DCH-ALT-PTO")],
        reusa=[(r"aislaci.n . tomar", "01"),
               (r"rotor y estator", "02"),
               (r"^recorrido general$", "03")],
    ),
    "COMPRESORES Y BOTELLONES": dict(
        titulo="DON CHICUETO / COMPRESORES Y BOTELLONES DE AIRE",
        equipos=[(r"compresores n.1 y n.2", ["DCH-COMP-1", "DCH-COMP-2"]),
                 (r"compresor n.1", "DCH-COMP-1"),
                 (r"compresor n.2", "DCH-COMP-2"),
                 (r"compresor cetec", "DCH-COMP-NK40"),
                 (r"botellones de aire principales", "DCH-BOT-AIRE-P"),
                 (r"botellones de aire auxiliar", "DCH-BOT-AIRE-AUX")],
        crear=[dict(assetCode="DCH-COMP-1", name="Compresor de Aire N°1", sfiCode="600", criticality="A"),
               dict(assetCode="DCH-COMP-2", name="Compresor de Aire N°2", sfiCode="600", criticality="A")],
        reusa=[(r"v.lvulas de seguridad . verificar", "01")],
    ),
    "SIST DE GOBIERNO ": dict(
        titulo="DON CHICUETO / SISTEMA DE GOBIERNO",
        equipos=[(r"^avance$", "DCH-TIM-AV"), (r"^retroceso$", "DCH-TIM-RE"),
                 (r"nivel de aceite tk", "DCH-HID-GOB")],
    ),
    "LINEA DE EJE Y HELICE": dict(
        titulo="DON CHICUETO / LINEA DE EJE Y HELICES",
        equipos=[(r"linea de eje eb", "DCH-EJE-ER"), (r"linea de eje br", "DCH-EJE-BR"),
                 (r"helice er", "DCH-HELICE-ER"), (r"helice br", "DCH-HELICE-BR")],
    ),
    "CABRESTANTE": dict(
        titulo="DON CHICUETO / CABRESTANTES",
        equipos=[(r"cabrestantes eb", "DCH-CABR-ER"), (r"cabrestantes br", "DCH-CABR-BR")],
    ),
    "MOTOR LANCHA DE TRABAJO": dict(
        titulo="DON CHICUETO / MOTOR DE LANCHA DE TRABAJO",
        asset="DCH-MOTOR-LANCHA",
        reusa=[(r"aceite y filtro de aceite de motor", "04"), (r"bateria de lancha", "05")],
    ),
    "BOMBAS": dict(
        titulo="DON CHICUETO / BOMBAS",
        equipos=[(r"bomba de incendio principal", "DCH-EB-INC-P"),
                 (r"bomba de lastre", "DCH-EB-LASTRE"),
                 (r"bombas de refrigeraci.n motores aux", ["DCH-EB-REF1", "DCH-EB-REF2"]),
                 (r"bomba de refrigeraci.n bocinas", "DCH-EB-REF-BOC"),
                 (r"bombas achique sentina", "DCH-EB-ACH-SENT"),
                 (r"bomba de prelubricaci.n", "DCH-EB-PRELUB"),
                 (r"bomba de trasvase", "DCH-EB-TRASV"),
                 (r"bomba de agua potable", ["DCH-EB-AP1", "DCH-EB-AP2"]),
                 (r"bomba de sanidad", "DCH-EB-SANID"),
                 (r"bomba de descarga de lodos", "DCH-EB-LODOS"),
                 (r"motobomba", "DCH-MBBA-PORT"),
                 (r"bomba de incendio emergencia", "DCH-BBA-INC-EM")],
    ),
    " CTRAL HIDRAULICA guinche-pluma": dict(
        titulo="DON CHICUETO / CENTRAL HIDRAULICA, GUINCHES Y PLUMA",
        equipos=[(r"guinche eb", "DCH-GUINCHE-ER"), (r"guinche br", "DCH-GUINCHE-BR"),
                 (r"^pluma$", "DCH-PLUMA"),
                 (r".", "DCH-CENT-HID")],   # el resto son partes de la central
        crear=[dict(assetCode="DCH-GUINCHE-ER", name="Guinche Hidráulico Estribor", sfiCode="700", criticality="B"),
               dict(assetCode="DCH-GUINCHE-BR", name="Guinche Hidráulico Babor", sfiCode="700", criticality="B"),
               dict(assetCode="DCH-PLUMA", name="Pluma Hidráulica", sfiCode="700", criticality="B")],
        reusa=[(r"aceite y filtro . realizar el cambio", "03")],
    ),
    "ENGRASE": dict(
        titulo="DON CHICUETO / PLAN DE ENGRASE",
        equipos=[(r"engrase de maq\. cubierta", "DCH-CENT-HID"),
                 (r"engrase timon", "DCH-HID-GOB"),
                 (r"cabrestante popa", "DCH-CABR-POPA"),
                 (r"engrase sala maquinas", "DCH-6-ED-001")],
        crear=[dict(assetCode="DCH-CABR-POPA", name="Cabrestante de Popa", sfiCode="700", criticality="A")],
    ),
    "EQUIPOS CRITICOS": dict(
        titulo="DON CHICUETO / EQUIPOS CRITICOS",
        equipos=[(r"sistema de gobierno de emergencia", "DCH-HID-GOB"),
                 (r"alarmas carboneras|alarmas tks", "DCH-ALARM-TK"),
                 (r"motobomba", "DCH-MBBA-PORT"),
                 (r"alarmas de disparo de c0?2", "DCH-CO2"),
                 (r"alarmas sentinas", "DCH-ALARM-SENT"),
                 (r"grampas de ventilacion|cortes de ventilacion", "DCH-CORTES"),
                 (r"baterias \(aux|luces de emergencia|efic", "DCH-BAT-EGA"),
                 (r"detectores humo", "DCH-DET-HUMO"),
                 (r"bba hidraulica", "DCH-BBA-HID"),
                 (r"bba incendio principal", "DCH-EB-INC-P"),
                 (r"bba de lastre", "DCH-EB-LASTRE"),
                 (r"purificadora", "DCH-PURIF"),
                 (r"paradas\s+de emergencia|alarmas de mot|alarmas cajas|sistema neumatico",
                  "DCH-6-ED-001")],
    ),
    "TOMAS DE MAR": dict(titulo="DON CHICUETO / TOMAS DE MAR", asset="DCH-FILT-MAR",
                         reusa=[(r"^limpiar$", "01")]),
    "TERMOTANQUES": dict(titulo="DON CHICUETO / TERMOTANQUE", asset="DCH-TERMOTQ"),
    "AIRE ACOND. CENTRAL": dict(titulo="DON CHICUETO / AIRE ACONDICIONADO",
                                asset="DCH-AA-SPLIT",
                                reusa=[(r"limpieza condensador", "03")]),
    "EQ NAVEGACION": dict(
        titulo="DON CHICUETO / NAVEGACION Y COMUNICACIONES",
        equipos=[(r"^ais", "DCH-AIS"), (r"barometro", "DCH-BAROM"),
                 (r"compas magnetico", "DCH-COMPAS"),
                 (r"radar de babor", "DCH-RADAR-BR"), (r"radar de estribor", "DCH-RADAR-ER"),
                 (r"ecosonda\s+babor", "DCH-ECO-BR"), (r"ecosonda estribor", "DCH-ECO-ER"),
                 (r"ecosonda del remolcador", "DCH-ECO-REMOL"),
                 (r"radio vhf babor", "DCH-VHF-BR"), (r"radio vhf estribor", "DCH-VHF-ER")],
        reusa=[(r".", "01")],
        # modelos que el papel declara y el sistema tenia mal
        fixes=[{"asset": "DCH-AIS", "manufacturer": "Emtrak", "model": "A-200"},
               {"asset": "DCH-RADAR-BR", "manufacturer": "Samyung", "model": "SMR 3700"},
               {"asset": "DCH-RADAR-ER", "manufacturer": "Furuno", "model": "FAR 2117BB"}],
    ),
}


def columnas(rows):
    """Indices de las columnas de esta hoja, por su encabezado."""
    hdr_i = next(i for i, r in enumerate(rows)
                 if any("TRABAJO A RELIZAR" in norm(c).upper() or "TRABAJO A REALIZAR" in norm(c).upper()
                        for c in r))
    hdr = [norm(c).upper() for c in rows[hdr_i]]
    c_task = next(i for i, c in enumerate(hdr) if "TRABAJO A" in c)
    c_last = next(i for i, c in enumerate(hdr) if c.startswith("ULTIMO"))
    c_next = next(i for i, c in enumerate(hdr) if c.startswith("PROXIMO"))
    c_freq = next(i for i, c in enumerate(hdr) if c == "FRECUENCIA")
    return hdr_i, c_task, c_task - 1, c_last, c_next, c_freq


def titulo_de(componente, trabajo):
    comp = re.sub(r"\s+", " ", componente).strip(" .:-").upper()
    t = re.sub(r"\s+", " ", trabajo).strip()
    # muchas tareas arrancan repitiendo el componente ("Bomba – recorrido general")
    # o con su numero de item ("20.01 - limpieza"); se saca ese ruido
    t = re.sub(r"^\d+[.\d]*\s*[–-]\s*", "", t).strip(" .")
    t = t[0].upper() + t[1:] if t else t
    if not comp:
        return t[:100]
    if len(comp) + len(t) + 2 > 100:
        t = t[:100 - len(comp) - 5].rstrip() + "…"
    return f"{comp}: {t}"


def destinos(cfg, equipo):
    """Activos a los que va esta fila."""
    if cfg.get("asset"):
        return [cfg["asset"]]
    for rx, destino in cfg["equipos"]:
        if re.search(rx, equipo, re.I):
            return destino if isinstance(destino, list) else [destino]
    return []


def construir(cfg, asset, componente, trabajo, tipo, valor, celda_last, celda_next,
              usados, seqs, hoja):
    code = next((c for rx, c in cfg.get("reusa", []) if re.search(rx, trabajo, re.I)), None)
    if code is None or code in usados:
        seq = seqs.get(asset, 30)
        while str(seq) in usados:
            seq += 1
        code = str(seq)
        seqs[asset] = seq + 1
    usados.add(code)

    rec = dict(asset=asset, code=code,
               title=titulo_de(componente, trabajo),
               description="[  ] " + re.sub(r"\s+", " ", trabajo).strip(" ."),
               taskType="INSPECTION" if RX_INSPECCION.match(trabajo) else "MAINTENANCE",
               triggerType="HOURS" if tipo == "HOURS" else "MONTHS",
               frequencyHours=valor if tipo == "HOURS" else None,
               frequencyMonths=valor if tipo == "MONTHS" else None,
               lastExecutionHours=None, nextDueHours=None,
               lastExecutionDate=None, nextDueDate=None,
               origen=f"{hoja} · {componente}", nota=None)

    if tipo == "HOURS":
        last, nxt = as_num(celda_last), as_num(celda_next)
        rec["lastExecutionHours"], rec["nextDueHours"] = last, nxt
        # el papel usa 0 en "ultimo trabajo" para "nunca ejecutado"
        if last == 0:
            rec["lastExecutionHours"] = None
            rec["nota"] = "el papel no registra ejecucion previa (ultimo = 0); queda sin ultima ejecucion"
        elif last is not None and nxt is not None and abs(last + valor - nxt) > 1:
            rec["nota"] = (f"la planilla dice ultimo {last:.0f} y proximo {nxt:.0f}, "
                           f"pero {last:.0f} + {valor:.0f} da {last + valor:.0f}")
    else:
        last, nxt = as_date(celda_last), as_date(celda_next)
        rec["lastExecutionDate"] = last.isoformat() if last else None
        rec["nextDueDate"] = nxt.isoformat() if nxt else None
        if last and nxt and abs((nxt - add_months(last, valor)).days) > 20:
            rec["nota"] = (f"la planilla vence el {nxt} pero {last} + {valor} meses "
                           f"da {add_months(last, valor)}")
        elif last and not nxt:
            rec["nextDueDate"] = add_months(last, valor).isoformat()
            rec["nota"] = "sin vencimiento en la planilla; calculado desde la ultima ejecucion"
    return rec


def procesar(hoja, wb, verbose=True):
    cfg = HOJAS[hoja]
    rows = [[c.value for c in r] for r in wb[hoja].iter_rows(max_col=12)]
    hdr_i, c_task, c_comp, c_last, c_next, c_freq = columnas(rows)

    planes, warns = [], []
    usados, seqs = {}, {}
    for r in rows[hdr_i + 1:]:
        trabajo = norm(r[c_task])
        if not trabajo or "TRABAJO A" in trabajo.upper() or "MANTENIMIENTO PROGRAMADO" in trabajo.upper():
            continue
        componente = norm(r[c_comp])

        tipo, valor = parse_frecuencia(r[c_freq])
        if tipo not in ("HOURS", "MONTHS"):
            warns.append(f"frecuencia ilegible '{norm(r[c_freq])}' en «{trabajo[:50]}»")
            continue

        assets = destinos(cfg, componente)
        if not assets:
            warns.append(f"sin activo para el equipo «{componente}» ({trabajo[:45]})")
            continue
        for asset in assets:
            planes.append(construir(cfg, asset, componente, trabajo, tipo, valor,
                                    r[c_last], r[c_next],
                                    usados.setdefault(asset, set()), seqs, hoja))

    out = f"scripts/vessel-plan-tools/out/dch-{re.sub(r'[^a-z0-9]+', '-', hoja.lower()).strip('-')}-plans.json"
    json.dump({"titulo": cfg["titulo"], "vessel": "DCH", "planes": planes,
               **({"assetCreates": cfg["crear"]} if cfg.get("crear") else {}),
               **({"assetFixes": cfg["fixes"]} if cfg.get("fixes") else {})},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"{out:<62} {len(planes):>3} planes" + (f"   ⚠ {len(warns)} avisos" if warns else ""))
    if verbose:
        for p in planes:
            f = f"{p['frequencyHours']:.0f}h" if p["frequencyHours"] else f"{p['frequencyMonths']}m"
            lh = f"{p['lastExecutionHours']:.0f}" if p["lastExecutionHours"] else (p["lastExecutionDate"] or "-")
            nh = f"{p['nextDueHours']:.0f}" if p["nextDueHours"] else (p["nextDueDate"] or "-")
            print(f"  {p['asset']:<16} {p['code']:>3} {p['title'][:64]:<66} {f:>7} | {lh:>10} → {nh}")
            if p["nota"]:
                print(f"       ⚠ {p['nota']}")
    for w in warns:
        print("   ⚠", w)
    return len(planes), warns


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    if sys.argv[1] == "--todas":
        tot, aw = 0, 0
        for hoja in HOJAS:
            n, w = procesar(hoja, wb, verbose=False)
            tot += n
            aw += len(w)
        print(f"\nTOTAL: {tot} planes en {len(HOJAS)} hojas · {aw} avisos")
    else:
        procesar(sys.argv[1], wb)


main()
