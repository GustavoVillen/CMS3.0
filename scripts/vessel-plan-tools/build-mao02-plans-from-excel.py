# -*- coding: utf-8 -*-
"""Genera el lote del plan en papel del MAO 02.

El plan del MAO 02 es una sola hoja con 48 items numerados, agrupados por
sistema. El formato es el del LATERE: la columna "Descripcion" nombra el equipo
y se arrastra hacia abajo mientras siguen sus tareas.

Columnas: 1=Item, 2=Descripcion (equipo), 3=Tarea, 4=Realizar cada,
5=Ultima verificacion, 6=Proximo recorrido, 7=Hs mes, 8=Hs totales, 9/10=mes.

Tres particularidades:
  - Los equipos de navegacion (items 40 a 48) traen la frecuencia solo en su
    primera fila; las de abajo son mas tareas del mismo trabajo y se suman a su
    descripcion, salvo el cambio de magnetron, que el papel pone a las 9000 hs.
  - Los inyectores de cada motor se cargan como un solo plan, como en los otros
    dos buques.
  - El control diario y las tareas de 15 dias no generan plan propio: van a los
    planes consolidados de rutina.

Uso: python scripts/vessel-plan-tools/build-mao02-plans-from-excel.py
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

SRC = "MisDocs/MAO02/Mao 02 -JULIO-PLAN DE MANTENIMIENTO MAQUINAS 06- 2026.xlsx"
HOJA = "PLAN DE MANTENIMIENTO MAO 02"
VESSEL = "M02"

C_ITEM, C_EQ, C_TASK, C_FREQ, C_LAST, C_NEXT = 1, 2, 3, 4, 5, 6

# Equipo del papel -> activo. Gana el primero que matchea: lo mas especifico va
# primero.
EQUIPOS = [
    (r"motor principal estribor", "M02-MP-ER"),
    (r"motor principal babor", "M02-MP-BR"),
    (r"caja reductora estribor", "M02-CR-ER"),
    (r"caja reductora babor", "M02-CR-BR"),
    (r"l.nea de eje estribor", "M02-EJE-ER"),
    (r"l.nea de eje babor", "M02-EJE-BR"),
    (r"motor auxiliar estribor", "M02-MA-ER"),
    (r"motor auxiliar babor", "M02-MA-BR"),
    (r"alternador estribor", "M02-ALT-ER"),
    (r"alternador babor", "M02-ALT-BR"),
    (r"tablero el.ctrico principal", "M02-TEP"),
    (r"calidad del combustible", "M02-COMB-CAL"),
    (r"trasvase de combustible n.\s*1", "M02-EB-TRASV"),
    (r"trasvase de combustible n.\s*2", "M02-EB-TRASV2"),
    (r"trasvase de combustible n.\s*3", "M02-EB-TRASV3"),
    (r"tuber.a embarque de combustible", "M02-TUB-COMB"),
    (r"bomba agua potable valco rpm 2851", "M02-EB-AP3"),
    (r"bomba pte valco", "M02-EB-PTE"),
    (r"electrobomba agua potable valco\s+rpm2850", "M02-EB-AP1"),
    (r"electrobomba agua potable valco rpm 2850", "M02-EB-AP2"),
    (r"incendio principal", "M02-EB-INC-P"),
    (r"incendio de emergencia", "M02-BBA-INC-EM"),
    (r"bomba\s+para lastre", "M02-EB-LASTRE"),
    (r"achique de sentina", "M02-EB-ACH-SENT"),
    (r"achique de cuarto de tim", "M02-ACH-TIMON"),
    (r"filtros de achique sentina", "M02-FILT-ACH"),
    (r"filtros tomas de mar", "M02-FILT-MAR"),
    (r"compresor de aire br", "M02-COMP-BR"),
    (r"compresor de aire er", "M02-COMP-ER"),
    (r"bomba hidr.ulica\s+bbr", "M02-BBA-HID-BR"),
    (r"bomba hidr.ulica\s+ebr", "M02-BBA-HID-ER"),
    (r"guinches de maniobra", "M02-GUINCHE"),
    (r"transmisi.n antag|sistema hidr.ulico|aceite hidr.ulico|filtros de aceite circuito",
     "M02-HID-GOB"),
    (r"^ventilador|^extractor|tomar aislacion|ventiladores y extractores", "M02-VENT"),
    (r"control de ajustes gral", "M02-AJUSTES"),
    (r"malacate", "M02-MALACATE"),
    (r"libro aislaciones", "M02-LIBRO-AISL"),
    (r"motor de lancha", "M02-MOTOR-LANCHA"),
    (r"termotanque", "M02-TERMOTQ"),
    (r"^sewage", "M02-SEWAGE"),
    (r"^cocina", "M02-COCINA"),
    (r"elementos de elevaci", "M02-ELEV"),
    (r"^ais", "M02-AIS"),
    (r"carta nautica", "M02-CARTA-NAUT"),
    (r"radar principal|furuno 1935", "M02-RADAR-ER"),
    (r"radar auxiliar|furuno 1815", "M02-RADAR-BR"),
    (r"ecosonda de barcaza|^garmin$", "M02-ECO-BARCAZA"),
    (r"^gps$|^futuno$", "M02-GPS"),
    (r"ecosonda del remolcador|furuno ls-\s*6100", "M02-ECO-REMOL"),
    (r"radio vhf babor", "M02-VHF-BR"),
    (r"radio vhf estribor", "M02-VHF-ER"),
]

CREAR = [
    ("M02-COMB-CAL", "Calidad del Combustible", "700", "B"),
    ("M02-EB-TRASV2", "ElectroBomba Trasvase de Combustible N°2", "700", "B"),
    ("M02-EB-TRASV3", "ElectroBomba Trasvase de Combustible N°3", "700", "B"),
    ("M02-EB-AP3", "Bomba Agua Potable N°3", "700", "C"),
    ("M02-EB-PTE", "Bomba de Planta de Tratamiento (PTE)", "700", "B"),
    ("M02-COMP-BR", "Compresor de Aire Babor", "600", "A"),
    ("M02-COMP-ER", "Compresor de Aire Estribor", "600", "A"),
    ("M02-BBA-HID-BR", "Bomba Hidráulica Babor", "700", "A"),
    ("M02-BBA-HID-ER", "Bomba Hidráulica Estribor", "700", "A"),
    ("M02-GUINCHE", "Guinches de Maniobra", "700", "A"),
    ("M02-MALACATE", "Malacate Eléctrico de Pluma de Lancha", "700", "B"),
    ("M02-LIBRO-AISL", "Libro de Aislaciones", "800", "C"),
    ("M02-TERMOTQ", "Termotanque", "500", "C"),
    ("M02-COCINA", "Cocina", "500", "C"),
    ("M02-CARTA-NAUT", "Carta Náutica Electrónica", "400", "B"),
    ("M02-ECO-BARCAZA", "Ecosonda de Barcaza", "400", "B"),
    ("M02-GPS", "GPS", "400", "B"),
]

# El papel contradice la ficha cargada en el sistema (herencia del clon).
FIXES = [
    {"asset": "M02-MP-ER", "manufacturer": "Caterpillar", "model": "3412"},
    {"asset": "M02-MP-BR", "manufacturer": "Caterpillar", "model": "3412D"},
    {"asset": "M02-CR-ER", "manufacturer": "Twin Disc", "model": "MG-520-1HP"},
    {"asset": "M02-CR-BR", "manufacturer": "Twin Disc", "model": "MG-520-1HP"},
    {"asset": "M02-ALT-ER", "manufacturer": "Kangying", "model": "KY50FC 65M/55C/S50"},
    {"asset": "M02-ALT-BR", "manufacturer": "Kangying", "model": "KY50FC 65M/55C/S50"},
    {"asset": "M02-MA-ER", "manufacturer": "Cummins", "model": "4BTA3.9-GM65"},
    {"asset": "M02-MA-BR", "manufacturer": "Cummins", "model": "Kangying 50 kW 1800 rpm"},
    {"asset": "M02-RADAR-ER", "manufacturer": "Furuno", "model": "1935"},
    {"asset": "M02-RADAR-BR", "manufacturer": "Furuno", "model": "1815"},
    {"asset": "M02-ECO-REMOL", "manufacturer": "Furuno", "model": "LS-6100"},
]

RX_INSPECCION = re.compile(
    r"^\s*(verificar|verificaci|control|controlar|inspecci|comprobar|tomar|toma de|"
    r"prueba|probar|test|chequeo|muestreo|medici|analisis|limpieza del panel|"
    r"regulacion|protocolo|certificaci)", re.I)
RX_INYECTOR = re.compile(r"^inyector\s*n", re.I)
RX_MAGNETRON = re.compile(r"cambio de magnetron", re.I)
RX_DIARIO = re.compile(r"control diario|\bdiario\b", re.I)


# Plan que YA existe en el sistema para esa tarea del papel. Sin esto la carga
# duplicaria: los 97 planes del clon quedarian al lado de los 218 del papel.
# La clave es el activo (o un prefijo de familia) y el valor, pares
# (regex sobre la tarea del papel, codigo del plan existente).
REUSA = {
    "M02-MP-": [(r"cambio de aceite y filtros de aceite", "01"),
                (r"controlar luz de v", "05"),
                (r"cambio de filtro de aire", "07"),
                (r"cambio de liquido refrigerante", "08"),
                (r"inyector", "10"),
                (r"full overhaul", "16"),
                (r"tomar muestras y analizar", "18"),
                (r"control de rotor de bomba de agua", "24")],
    "M02-MA-BR": [(r"^cambio de aceite$", "01"),
                  (r"cambio de filtro de gas oil", "03"),
                  (r"tomar muestras y analizar", "06"),
                  (r"controlar luz de v", "08"),
                  (r"cambio de liquido refrigerante", "10"),
                  (r"inyector", "11"),
                  (r"revisi.n y control bomba de agua", "16"),
                  (r"cambio de grupo de bater", "20")],
    "M02-CR-": [(r"cambio de aceite y filtro de descarga", "02"),
                (r"tomar muestras y analizar", "03"),
                (r"analisis vibraciones", "04"),
                (r"full overhaul", "05")],
    "M02-ALT-": [(r"control aislaci", "01"),
                 (r"limpieza de estator y rotor", "02"),
                 (r"cambio de rodamientos y barnizado", "03")],
    "M02-TEP": [(r"limpieza interior", "01"),
                (r"control y ajuste de contactores", "03"),
                (r"protocolo de protecciones", "06")],
    "M02-EB-TRASV": [(r"toma de aislaci", "03")],
    "M02-TUB-COMB": [(r"prueba hidr", "01")],
    "M02-FILT-MAR": [(r"desarme y limpieza", "01")],
    "M02-FILT-ACH": [(r"limpiar y controlar", "01")],
    "M02-HID-GOB": [(r"^cambiar$", "03"), (r"tomar muestra l\.o", "04")],
    "M02-MOTOR-LANCHA": [(r"cambio de aceite pata", "04"), (r"bater.a, cambio", "05")],
    "M02-RADAR-": [(r"verificacion de conexiones", "01"), (r"cambio de magnetron", "02")],
    "M02-ECO-REMOL": [(r"limpieza del panel", "01")],
    "M02-VHF-": [(r"prueba de transmision", "01")],
    "M02-AIS": [(r"prueba de transmision", "01")],
    "M02-ELEV": [(r"certificaci.n de swl", "02")],
    "M02-EB-INC-P": [(r"recorrido de bomba", "01"), (r"toma de aislaci", "03")],
    "M02-EB-AP1": [(r"recorrido de bomba", "02")],
    "M02-EB-AP2": [(r"recorrido de bomba", "01")],
    "M02-EB-ACH-SENT": [(r"recorrido de bomba", "01")],
    "M02-EB-LASTRE": [(r"recorrido de bomba", "04"), (r"toma de aislaci", "03")],
    "M02-VENT": [(r"recorrido motor el", "12")],
}


def code_reusado(asset, tarea):
    """Codigo del plan existente que corresponde a esa tarea, o None."""
    for clave, pares in REUSA.items():
        if not asset.startswith(clave):
            continue
        for rx, code in pares:
            if re.search(rx, tarea, re.I):
                return code
    return None


def limpiar(t):
    t = re.sub(r"\s+", " ", t).strip(" .")
    return t[0].upper() + t[1:] if t else t


def activo_de(equipo):
    return next((a for rx, a in EQUIPOS if re.search(rx, equipo, re.I)), None)


def nuevo(asset, usados, seqs, title, desc, task, tipo, valor, equipo, nota=None, code=None):
    u = usados.setdefault(asset, set())
    if code is None or code in u:
        seq = seqs.get(asset, 30)
        while str(seq) in u:
            seq += 1
        seqs[asset] = seq + 1
        code = str(seq)
    u.add(code)
    return dict(asset=asset, code=code, title=title, description=desc,
                taskType=task, triggerType="HOURS" if tipo == "HOURS" else "MONTHS",
                frequencyHours=valor if tipo == "HOURS" else None,
                frequencyMonths=valor if tipo == "MONTHS" else None,
                lastExecutionHours=None, nextDueHours=None,
                lastExecutionDate=None, nextDueDate=None,
                origen="MAO02 - " + equipo, nota=nota)


def fechas(p, tipo, valor, r):
    if tipo == "HOURS":
        last, nxt = as_num(r[C_LAST]), as_num(r[C_NEXT])
        p["lastExecutionHours"], p["nextDueHours"] = last, nxt
        if last is not None and nxt is not None and abs(last + valor - nxt) > 1:
            p["nota"] = ("la planilla dice ultimo %.0f y proximo %.0f, pero %.0f + %.0f "
                         "da %.0f" % (last, nxt, last, valor, last + valor))
    else:
        last, nxt = as_date(r[C_LAST]), as_date(r[C_NEXT])
        p["lastExecutionDate"] = last.isoformat() if last else None
        p["nextDueDate"] = nxt.isoformat() if nxt else None
        if last and nxt and abs((nxt - add_months(last, valor)).days) > 25:
            p["nota"] = ("la planilla vence el %s pero %s + %d meses da %s"
                         % (nxt, last, valor, add_months(last, valor)))
        elif last and not nxt:
            p["nextDueDate"] = add_months(last, valor).isoformat()
            p["nota"] = "sin vencimiento en la planilla; calculado desde la ultima ejecucion"


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    rows = [[c.value for c in r] for r in wb[HOJA].iter_rows(max_col=11)]

    planes, rutinas, warns = [], [], []
    usados, seqs = {}, {}
    equipo = None
    ultimo_de = {}        # activo -> ultimo plan emitido, para colgarle sub-tareas
    inyector_de = set()   # activos que ya tienen su plan de inyectores

    for i, r in enumerate(rows):
        eq_celda = norm(r[C_EQ])
        tarea = norm(r[C_TASK])
        # El item 41 (carta nautica) arranca con su tarea y recien nombra el
        # equipo en la fila siguiente: cuando empieza un item numerado sin equipo,
        # se toma el de la proxima fila que lo traiga dentro del mismo item.
        if not eq_celda and re.fullmatch(r"\d+", norm(r[C_ITEM])):
            for r2 in rows[i + 1:]:
                if norm(r2[C_ITEM]) and not norm(r2[C_EQ]):
                    break
                if norm(r2[C_EQ]):
                    eq_celda = norm(r2[C_EQ])
                    break
        if eq_celda:
            equipo = eq_celda
        if not tarea or re.search(r"firma y aclaraci|tarea a realizar|^r/e mao", tarea, re.I):
            continue
        if equipo is None:
            warns.append("fila sin equipo: " + tarea[:60])
            continue
        asset = activo_de(equipo)
        if not asset:
            warns.append("sin activo para '%s' (%s)" % (equipo[:45], tarea[:40]))
            continue

        tipo, valor = parse_frecuencia(r[C_FREQ])

        # Sin frecuencia propia: es una sub-tarea del ultimo plan de ese equipo.
        if tipo is None:
            if RX_MAGNETRON.search(tarea):
                kw = (re.search(r"(\d+)\s*kw", tarea, re.I) or [None, "?"])[1]
                hsm = re.search(r"(\d[\d.]*)\s*hs", tarea, re.I)
                hs = float(hsm.group(1).replace(".", "")) if hsm else 9000.0
                planes.append(nuevo(
                    asset, usados, seqs, "MAGNETRON: Cambio de magnetron " + kw + " KW",
                    "[  ] Cambio del magnetron de " + kw + " KW\n"
                    "[  ] Verificacion de emision y sintonia posterior\n"
                    "[  ] Registro de las horas del equipo al cambio",
                    "MAINTENANCE", "HOURS", hs, equipo,
                    nota="el papel no registra horas de servicio del equipo; queda sin ultima ejecucion",
                    code=code_reusado(asset, tarea)))
                continue
            base = ultimo_de.get(asset)
            if base:
                base["description"] += "\n[  ] " + limpiar(tarea)
                continue
            warns.append("%s: sin frecuencia y sin plan previo '%s'" % (equipo[:30], tarea[:45]))
            continue

        # Control diario y quincenal: van a los planes consolidados de rutina.
        if RX_DIARIO.search(tarea) or tipo == "RUTINA":
            frec = "DIARIO" if RX_DIARIO.search(tarea) else valor
            rutinas.append(dict(frecuencia=frec, equipo=equipo, asset=asset, tarea=tarea))
            continue

        # Los inyectores de cada motor, en un solo plan.
        if RX_INYECTOR.match(tarea):
            if asset in inyector_de:
                continue
            inyector_de.add(asset)
            n = 12 if "MP-" in asset else 4
            p = nuevo(asset, usados, seqs,
                      "INYECTORES: Recorrido N°1 a N°%d" % n,
                      "[  ] Desmontaje de los %d inyectores\n"
                      "[  ] Recorrido y calibracion en banco de los inyectores N°1 a N°%d\n"
                      "[  ] Cambio de toberas y juntas segun estado\n"
                      "[  ] Montaje y control de avance de inyeccion\n"
                      "[  ] Registro individual por inyector" % (n, n),
                      "MAINTENANCE", tipo, valor, equipo,
                      code=code_reusado(asset, tarea))
            fechas(p, tipo, valor, r)
            planes.append(p)
            ultimo_de[asset] = p
            continue

        p = nuevo(asset, usados, seqs, limpiar(tarea)[:100], "[  ] " + limpiar(tarea),
                  "INSPECTION" if RX_INSPECCION.match(tarea) else "MAINTENANCE",
                  tipo, valor, equipo, code=code_reusado(asset, tarea))
        fechas(p, tipo, valor, r)
        planes.append(p)
        ultimo_de[asset] = p

    lote = {
        "titulo": "MAO 02 / PLAN DE MANTENIMIENTO DE MAQUINAS",
        "vessel": VESSEL,
        "planes": planes,
        "assetCreates": [dict(assetCode=c, name=n, sfiCode=s, criticality=k)
                         for c, n, s, k in CREAR],
        "assetFixes": FIXES,
    }
    json.dump(lote, open("scripts/vessel-plan-tools/out/m02-plans.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(rutinas, open("scripts/vessel-plan-tools/out/m02-rutinas.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    porasset = {}
    for p in planes:
        porasset.setdefault(p["asset"], []).append(p)
    print("planes: %d sobre %d activos - rutinas apartadas: %d - avisos: %d\n"
          % (len(planes), len(porasset), len(rutinas), len(warns)))
    for a in sorted(porasset):
        print("-- %s (%d)" % (a, len(porasset[a])))
        for p in porasset[a]:
            f = ("%.0fh" % p["frequencyHours"]) if p["frequencyHours"] else ("%sm" % p["frequencyMonths"])
            lh = ("%.0f" % p["lastExecutionHours"]) if p["lastExecutionHours"] else (p["lastExecutionDate"] or "-")
            nh = ("%.0f" % p["nextDueHours"]) if p["nextDueHours"] else (p["nextDueDate"] or "-")
            print("   %3s %-64s %7s | %10s -> %s" % (p["code"], p["title"][:62], f, lh, nh))
            if p["nota"]:
                print("        [!] " + p["nota"])
    if rutinas:
        print("\nRUTINAS APARTADAS")
        for x in rutinas:
            print("  [%-8s] %-40s %s" % (x["frecuencia"], x["equipo"][:38], x["tarea"][:60]))
    if warns:
        print("\nAVISOS")
        for w in warns:
            print("  ", w)


main()
