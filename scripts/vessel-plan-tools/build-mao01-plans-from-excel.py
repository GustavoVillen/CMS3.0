# -*- coding: utf-8 -*-
"""Lee el plan en papel del MAO 01 y lo deja en el formato comun de auditoria.

Fuente: MisDocs/MAO01/Mantenimiento/MAO01 - Plan de mantenimiento julio 2026.xlsx
Dos hojas: "plan de mantenimiento" (el plan de maquinas) y "equipos criticos"
(la ronda semanal de la tripulacion). Los dos layouts los lee paper_sheets.

Uso: python scripts/vessel-plan-tools/build-mao01-plans-from-excel.py
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

SRC = "MisDocs/MAO01/Mantenimiento/MAO01 - Plan de mantenimiento julio 2026.xlsx"
VESSEL = "M01"
ESTADO = "scripts/vessel-plan-tools/out/flota-estado.json"
SALIDA = "scripts/vessel-plan-tools/out/m01-plans.json"

# Equipos que el puntaje no resuelve y se verificaron a mano contra la lista de
# activos del MAO 01. Todos existen en el sistema con otro nombre; sin esto
# saldrian como "solo en el Excel" y serian un falso hallazgo.
FORZADOS = [
    (r"^sewage", "M01-SEWAGE"),                        # Planta de Tratamiento Sewage
    (r"control de ajustes gral", "M01-8-CD-001"),      # Control de Ajustes Generales
    (r"^ventilador|^extractor", "M01-VENT"),           # Ventiladores y Extractores
    (r"iluminaci.n de emergencia|luces de emergencia|"
     r"bater.as de (iluminaci|equipos)", "M01-BAT-EGA"),   # Baterias y Sistemas EGA
    (r"tim.n de emergencia|gobierno emergencia|"
     r"transmisi.n antag|operaci.n ega de motores", "M01-HID-GOB"),  # Gobierno y Maniobra
    (r"aceite hidr.ulico|sistema hidr.ulico|"
     r"filtros de aceite circuito hidr", "M01-CENT-HID"),  # Central Hidraulica
    (r"detectores humo", "M01-DET-HUMO"),              # Sistema de Deteccion de Incendio
    (r"purificadora", "M01-PURIF"),                    # Purificadora de combustible
    (r"calidad del combustible|tanque diario|tanque.? carbonera|"
     r"tanque.? sedimentaci|tanque residuos purificadora", "M01-1-TD-001"),  # Tanque de Combustible
    # La hoja de navegacion nombra los equipos por su modelo. Cada uno se
    # verifico contra la marca/modelo cargados en la ficha del activo.
    (r"^danforth", "M01-COMPAS"),            # Compas Magnetico Danforth
    (r"^furuno m1934", "M01-RADAR-ER"),      # Radar de Estribor Furuno M1934 BB
    (r"^furuno 1715", "M01-RADAR-BR"),       # Radar de Babor Furuno 1715
    (r"^furuno ls-?4100", "M01-ECO-REMOL"),  # Ecosonda del Remolcador Furuno LS-4100
    # Ojo: el activo vivo es M01-4-EB-001. M01-ECO-BR existe pero esta dado de
    # baja (es un duplicado que se limpio), asi que no sirve para emparejar.
    (r"^furuno\s*$", "M01-4-EB-001"),        # Ecosonda Babor Furuno (sin modelo en la ficha)
    # "IC-M412" queda a proposito sin forzar: es el modelo de las DOS radios VHF
    # (babor y estribor) y elegir una dejaria a la otra como plan huerfano. Se
    # empareja despues por titulo, que es lo unico que las distingue.
]


def main():
    estado = json.load(open(ESTADO, encoding="utf-8"))
    activos = [a for a in estado["assets"] if a["vesselCode"] == VESSEL and not a["deletedAt"]]
    res = Resolvedor(activos, forzados=FORZADOS)

    wb = openpyxl.load_workbook(SRC, data_only=True)
    filas, avisos = [], []
    leer_hoja_tareas(wb["plan de mantenimiento"], VESSEL, "plan de mantenimiento", res, filas, avisos)
    leer_hoja_semanal(wb["equipos criticos"], VESSEL, "equipos criticos", res, filas, avisos)

    lote = {"titulo": "MAO 01 / Plan de mantenimiento julio 2026",
            "vessel": VESSEL, "fuente": SRC, "planes": filas,
            "sinMapear": sorted(res.fallidos.items(), key=lambda x: -x[1]),
            "avisos": avisos}
    json.dump(lote, open(SALIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    sin = [p for p in filas if not p["asset"]]
    porhoja = {}
    for p in filas:
        porhoja[p["hoja"]] = porhoja.get(p["hoja"], 0) + 1
    print("filas del papel: %d  (%s)"
          % (len(filas), ", ".join("%s %d" % kv for kv in porhoja.items())))
    print("activos resueltos: %d de %d · equipos sin mapear: %d · avisos: %d"
          % (len(filas) - len(sin), len(filas), len(res.fallidos), len(avisos)))
    if res.fallidos:
        print("\nEQUIPOS SIN MAPEAR (mejor puntaje obtenido)")
        for eq, p in sorted(res.fallidos.items(), key=lambda x: -x[1]):
            print("   %.3f  %s" % (p, eq[:80]))
    for a in avisos[:15]:
        print("   [!]", a)


main()
