# -*- coding: utf-8 -*-
"""Lee el plan en papel de las barcazas y lo expande buque por buque.

Fuente: MisDocs/MercurioSGS/REGI-MAN/REGI-MAN-02.2 Plan de Mantenimiento Barcazas.xlsx
Es la revision mas nueva de las tres que hay en MisDocs (modificada 30-abr-2026,
contra 13-oct-2025 y 08-jul-2025 de las otras dos).

Se usa la hoja "Plan Consolidado", que ya viene en el formato de carga del CMS3
(vesselCode, taskCode, title, triggerType, frequencyMonths...) en vez de las hojas
por familia de motor: es la misma informacion ya normalizada.

Dos particularidades de esa hoja:
  · El plan es por FAMILIA DE MOTOR, no por barcaza ("MGT01-09" son nueve buques).
    Aca se expande a cada barcaza, que es como hay que auditarlo: el plan lo tiene
    que tener cada buque en el sistema.
  · La columna `title` es generica ("Mantenimiento c/ 12 meses"); la tarea real
    esta en `description` ("VALVULAS DE P/V: Testeo de libre funcionamiento").
    Para emparejar contra el sistema vale la description, no el title.

Uso: python scripts/vessel-plan-tools/build-barcazas-plans-from-excel.py
"""
import json
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

SRC = "MisDocs/MercurioSGS/REGI-MAN/REGI-MAN-02.2 Plan de Mantenimiento Barcazas.xlsx"
HOJA = "Plan Consolidado"
SALIDA = "scripts/vessel-plan-tools/out/barcazas-plans.json"

# Familia del papel -> buques que cubre, y el motor que declara la planilla.
# Los nombres de motor salen de las hojas por familia del mismo archivo
# ("Plan de Mant. JOHN - MGT 01-09", "Plan de Mant. CAT - MGT 10-15"...).
FAMILIAS = {
    "MGT01-09":   (["MGT%02d" % n for n in range(1, 10)],   "John Deere"),
    "MGT10-15":   (["MGT%02d" % n for n in range(10, 16)],  "Caterpillar"),
    "MGT16-27":   (["MGT%02d" % n for n in range(16, 28)],  "John Deere"),
    "GLT001":     (["GLT001"],                              "Caterpillar"),
    "GLT007-008": (["GLT007", "GLT008"],                    "MWM"),
    "YT":         (["YT010", "YT012", "YT013"],             "sin declarar"),
}

C_VESSEL, C_ASSET, C_TASKCODE, C_TITLE, C_DESC = 0, 1, 4, 6, 7
C_TASKTYPE, C_TRIGGER, C_MESES, C_HORAS = 8, 9, 10, 11


def norm(v):
    return "" if v is None else re.sub(r"\s+", " ", str(v)).strip()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    filas = [r for r in wb[HOJA].iter_rows(min_row=2, values_only=True) if norm(r[C_VESSEL])]

    planes, avisos = [], []
    for r in filas:
        familia = norm(r[C_VESSEL])
        if familia not in FAMILIAS:
            avisos.append("familia desconocida en la planilla: %s" % familia)
            continue
        buques, motor = FAMILIAS[familia]
        desc = norm(r[C_DESC])
        titulo = norm(r[C_TITLE])
        if not desc and not titulo:
            continue
        for buque in buques:
            planes.append(dict(
                vessel=buque, familia=familia, motorPapel=motor,
                asset=norm(r[C_ASSET]) or None, assetPuntaje=None,
                assetVia=None, assetAmbiguo=False, equipo=None,
                # El codigo del papel lleva la familia adentro
                # (M-MGT01-09-1.1-12M); se deja tal cual para poder rastrear la
                # fila de origen, pero no sirve para emparejar contra el sistema,
                # que numera por buque.
                code=None, codePapel=norm(r[C_TASKCODE]) or None,
                title=desc or titulo, titleGenerico=titulo,
                hoja=HOJA, fila=None,
                taskType=norm(r[C_TASKTYPE]) or "MAINTENANCE",
                triggerType=norm(r[C_TRIGGER]) or None,
                frequencyMonths=num(r[C_MESES]), frequencyHours=num(r[C_HORAS]),
                lastExecutionDate=None, nextDueDate=None,
                lastExecutionHours=None, nextDueHours=None,
                frecuenciaTexto=None))

    lote = {"titulo": "BARCAZAS / REGI-MAN-02.2 Plan de Mantenimiento (rev. 30-abr-2026)",
            "vessel": None, "fuente": "%s · hoja %s" % (SRC, HOJA),
            "planes": planes, "sinMapear": [], "avisos": avisos}
    json.dump(lote, open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("filas de la planilla: %d · familias: %d" % (len(filas), len(FAMILIAS)))
    for fam, (buques, motor) in FAMILIAS.items():
        n = sum(1 for r in filas if norm(r[C_VESSEL]) == fam)
        print("   %-12s %2d tareas × %2d buques = %3d  (motor: %s)"
              % (fam, n, len(buques), n * len(buques), motor))
    print("TOTAL expandido: %d filas sobre %d buques"
          % (len(planes), len({p["vessel"] for p in planes})))
    for a in avisos:
        print("   [!]", a)


main()
