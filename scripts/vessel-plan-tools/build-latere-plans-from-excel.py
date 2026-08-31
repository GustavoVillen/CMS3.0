# -*- coding: utf-8 -*-
"""Lee el plan en papel del LATERE y lo deja en el formato comun de auditoria.

Fuente: MisDocs/LTE/Mantenimiento/PLAN DE MANT. LTE - JULIO.xlsx

Trece hojas: doce de tareas por sistema (motores, cajas, bombas, compresores...)
mas "EQUIPOS_CRITICOS", que es la ronda semanal de la tripulacion. Los dos
layouts los lee paper_sheets; aca solo va lo propio del buque.

Particularidad del LATERE: en las hojas de maquinas el equipo con marca y modelo
esta en la fila de grupo ("MOTOR PRINCIPAL N01 BR-KTA 50 CUMMINS") y no en la
columna Descripcion, asi que el resolvedor tiene que poder caer al grupo
(usar_grupo=True).

Uso: python scripts/vessel-plan-tools/build-latere-plans-from-excel.py
"""
import json
import sys
import warnings

import openpyxl

sys.path.insert(0, "scripts/vessel-plan-tools")
from paper_assets import Resolvedor  # noqa: E402
from paper_sheets import leer_hoja_semanal, leer_hoja_tareas  # noqa: E402

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8")

SRC = "MisDocs/LTE/Mantenimiento/PLAN DE MANT. LTE - JULIO.xlsx"
VESSEL = "LTE"
ESTADO = "scripts/vessel-plan-tools/out/flota-estado.json"
SALIDA = "scripts/vessel-plan-tools/out/lte-plans.json"

HOJAS_TAREAS = [
    "MOTORES_PROPULSORES", "CAJAS_REDUCTORAS", "MOTORES_GENERADORES",
    "PLANTA_ELECTRICA", "CIRCUITO_DE_COMBUSTIBLE", "NAV-COM",
    "BOMBAS_ELECTRICAS", "COMPRESOR-A_A-TIFON", "SISTEMA_HIDRAULICO_PRINC_-AUX",
    "VENTILADORES,_EXTRACTORES-OTROS", "CABRESTANTE_DE_PROA_Y_POPA",
    "SEPARADOR_Y_PLANTA_P_T,E",
]
HOJA_SEMANAL = "EQUIPOS_CRITICOS"

# NAV-COM es la unica hoja sin fila de encabezado: arranca directo en la fila 6
# con A=nro, B=equipo, C=tarea, D=frecuencia, E=ultima, F=proximo.
COLUMNAS_NAV_COM = (5, 1, 2, 3, 4, 5)

# Equipos que el puntaje no resuelve y se verificaron a mano contra la lista de
# activos del LATERE. Sin esto saldrian como "solo en el Excel".
FORZADOS = [
    (r"^sewage|planta de tratamiento", "LTE-SEWAGE"),
    (r"extractor de cocina", "LTE-EXTR-COCINA"),
    (r"^ventilador|^extractor|parada de ega a\.?a", "LTE-VENT"),
    (r"iluminaci.n de emergencia|luces de emergencia|"
     r"bater.as de (iluminaci|eq)", "LTE-BAT-EGA"),
    (r"tim.n de emergencia|gobierno de emergencia", "LTE-HID-GOB"),
    (r"detectores de humo|alarma detectores", "LTE-DET-HUMO"),
    (r"purificadora", "LTE-PURIF"),
    (r"separador", "LTE-SEPARADOR"),
    (r"control de ajustes gral", "LTE-AJUSTES"),
    (r"^chiller", "LTE-CHILLER"),
    (r"^compresor\s*$", "LTE-COMP-NK40"),    # Electrocompresor a tornillo NK40
    # NAV-COM nombra los equipos por su modelo; cada uno verificado contra la
    # marca/modelo de la ficha del activo.
    (r"^danforth", "LTE-COMPAS"),
    (r"^furuno m1934", "LTE-RADAR-ER"),
    (r"^furuno 1715", "LTE-RADAR-BR"),
    (r"^furuno ls-?4100", "LTE-ECO-REMOL"),
    (r"^furuno\s*$", "LTE-ECO-BR"),
    # "IC-M412" no se fuerza: es el modelo de las dos radios VHF y elegir una
    # dejaria a la otra como plan huerfano. Se empareja despues por titulo.
]


def main():
    estado = json.load(open(ESTADO, encoding="utf-8"))
    activos = [a for a in estado["assets"] if a["vesselCode"] == VESSEL and not a["deletedAt"]]
    res = Resolvedor(activos, forzados=FORZADOS)

    wb = openpyxl.load_workbook(SRC, data_only=True)
    filas, avisos = [], []
    for hoja in HOJAS_TAREAS:
        leer_hoja_tareas(wb[hoja], VESSEL, hoja, res, filas, avisos, usar_grupo=True,
                         columnas=COLUMNAS_NAV_COM if hoja == "NAV-COM" else None)
    leer_hoja_semanal(wb[HOJA_SEMANAL], VESSEL, HOJA_SEMANAL, res, filas, avisos)

    lote = {"titulo": "LATERE / PLAN DE MANT. LTE - JULIO 2026",
            "vessel": VESSEL, "fuente": SRC, "planes": filas,
            "sinMapear": sorted(res.fallidos.items(), key=lambda x: -x[1]),
            "avisos": avisos}
    json.dump(lote, open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    sin = [p for p in filas if not p["asset"]]
    print("filas del papel: %d" % len(filas))
    for hoja in HOJAS_TAREAS + [HOJA_SEMANAL]:
        print("   %-34s %3d" % (hoja, sum(1 for p in filas if p["hoja"] == hoja)))
    print("activos resueltos: %d de %d · equipos sin mapear: %d · avisos: %d"
          % (len(filas) - len(sin), len(filas), len(res.fallidos), len(avisos)))
    if res.fallidos:
        print("\nEQUIPOS SIN MAPEAR (mejor puntaje obtenido)")
        for eq, p in sorted(res.fallidos.items(), key=lambda x: -x[1]):
            print("   %.3f  %s" % (p, eq[:80]))
    for a in avisos[:15]:
        print("   [!]", a)


main()
