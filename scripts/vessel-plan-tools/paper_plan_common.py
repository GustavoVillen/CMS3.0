# -*- coding: utf-8 -*-
"""Utilidades compartidas para leer el plan en papel del LATERE.

La planilla la llenan a mano varias personas desde hace años, asi que la misma
columna trae fechas en media docena de formatos ("13/JULIO/2026", "18/JUN/2026",
"30/07/2026-07:00", "04-07-2025", un datetime de Excel) y celdas con "ok" donde
deberia haber un numero. Todo eso se normaliza aca.
"""
import datetime
import re

MESES = {
    "ENE": 1, "ENERO": 1, "FEB": 2, "FEBRERO": 2, "MAR": 3, "MARZO": 3,
    "ABR": 4, "ABRIL": 4, "MAY": 5, "MAYO": 5, "JUN": 6, "JUNIO": 6,
    "JUL": 7, "JULIO": 7, "AGO": 8, "AGOSTO": 8, "SEP": 9, "SET": 9,
    "SEPTIEMBRE": 9, "SETIEMBRE": 9, "OCT": 10, "OCTUBRE": 10,
    "NOV": 11, "NOVIEMBRE": 11, "DIC": 12, "DICIEMBRE": 12,
}


def norm(v):
    """Celda a string limpio."""
    return "" if v is None else str(v).strip().replace("\n", " ")


def as_num(v):
    """Numero de horas, o None si la celda trae 'ok', un guion o una fecha."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and re.fullmatch(r"\d{2,6}", v.strip()):
        return float(v.strip())
    return None


def as_date(v):
    """Fecha de la celda en cualquiera de los formatos de la planilla, o None."""
    if isinstance(v, (datetime.datetime, datetime.date)):
        d = v.date() if isinstance(v, datetime.datetime) else v
        return d if 2000 <= d.year <= 2100 else None
    if not isinstance(v, str):
        return None
    s = v.strip()
    # 13/JULIO/2026, 18/JUN/2026, 13/FEB/27
    m = re.match(r"^(\d{1,2})[/-]([A-Za-zÁÉÍÓÚáéíóú]{3,10})[/-](\d{2,4})", s)
    if m:
        mes = MESES.get(m.group(2).upper())
        if mes:
            y = int(m.group(3))
            y += 2000 if y < 100 else 0
            return _safe(y, mes, int(m.group(1)))
    # 30/07/2026-07:00, 04-07-2025, 16/04/2026
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})", s)
    if m:
        return _safe(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    # 2025-11-27
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return _safe(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _safe(y, m, d):
    # Las celdas con el anio mal tipeado ("0206-07-23", "0207-06-13" en bombas
    # electricas y cabrestantes) se descartan a proposito: no se puede saber si
    # 0206 quiso decir 2006 o 2026, y adivinar mal arrastraria un vencimiento
    # equivocado. Al descartarlas, resolver_fechas cae a la columna de respaldo y
    # deja la nota del desfase, que es lo que hay que revisar a bordo.
    try:
        dt = datetime.date(y, m, d)
    except ValueError:
        return None
    return dt if 2000 <= y <= 2100 else None


def add_months(d, n):
    y, m = divmod((d.year * 12 + d.month - 1) + n, 12)
    return datetime.date(y, m + 1, min(d.day, 28))


# Frecuencias que la tripulacion controla en la guardia. No se cargan como plan
# propio: se juntan en los tres planes consolidados (DIARIO / SEMANAL / 15 DIAS)
# que se arman al cierre, con todas sus tareas en el campo TAREAS.
RUTINA_DIARIA = "DIARIO"
RUTINA_SEMANAL = "SEMANAL"
RUTINA_QUINCENAL = "15 DIAS"


def parse_frecuencia(txt):
    """Interpreta la columna "Realizar cada: Hs/lapso".

    Devuelve (tipo, valor):
      ("HOURS", n)   -> cada n horas de servicio
      ("MONTHS", n)  -> cada n meses
      ("EVENT", None)-> con cada evento (embarque, viaje)
      ("RUTINA", RUTINA_*) -> diaria/semanal/quincenal, va al plan consolidado
      (None, None)   -> celda vacia o no interpretable
    """
    s = norm(txt).lower().replace(",", ".")
    if not s:
        return None, None
    if re.search(r"\bdiari|\bdiaria\b", s):
        return "RUTINA", RUTINA_DIARIA
    if re.search(r"semanal|\bsemana\b", s):
        return "RUTINA", RUTINA_SEMANAL
    if re.search(r"15\s*d[ií]as|quincenal", s):
        return "RUTINA", RUTINA_QUINCENAL
    if re.search(r"mensual", s):
        return "MONTHS", 1
    if re.search(r"trimestral", s):
        return "MONTHS", 3
    if re.search(r"semestral", s):
        return "MONTHS", 6
    # "C/Emb.", "C/CAMBIO", "C/ 2 VIAJES" y "CV/V" (cada viaje) del motor de lancha
    if re.search(r"\bc\s*/\s*|cv\s*/\s*v|con cada|por viaje|viajes?\b", s):
        return "EVENT", None
    m = re.search(r"(\d+)\s*a[nñ]os?", s)
    if m:
        return "MONTHS", int(m.group(1)) * 12
    if re.search(r"^anual|\banual\b", s):
        return "MONTHS", 12
    m = re.search(r"(\d+)\s*mes", s)
    if m:
        return "MONTHS", int(m.group(1))
    m = re.search(r"(\d+)\s*d[ií]as?", s)
    if m:
        d = int(m.group(1))
        return ("RUTINA", RUTINA_QUINCENAL) if d <= 15 else ("MONTHS", max(1, round(d / 30)))
    # numero pelado o con "hs" = horas de servicio
    m = re.search(r"(\d[\d.]*)\s*(hs|h|horas)?$", s)
    if m:
        try:
            return "HOURS", float(m.group(1).replace(".", ""))
        except ValueError:
            return None, None
    return None, None


def resolver_horas(E, F, H, freq):
    """Resuelve (ultima ejecucion, vencimiento) en horas.

    Manda el "Proximo recorrido" (H), que es el numero que la tripulacion
    controla. La hora de ultima ejecucion se toma de "Hora de cambio Act." (F) o
    de "Ultima verificacion" (E), la que cierre con H - frecuencia; si ninguna
    cierra se deriva de H y se deja aviso, asi un error de tipeo en E/F no
    arrastra un vencimiento equivocado.
    """
    nota = None
    if H:
        last = next((c for c in (F, E) if c and abs(c + freq - H) < 1), None)
        if last is None:
            last = H - freq
            if F or E:
                nota = (f"E={E if E else '-'} F={F if F else '-'} no cierran con "
                        f"H={H:.0f}; ultima ejecucion derivada = {last:.0f}")
        return last, H, nota
    base = F or E
    if base:
        return base, base + freq, "sin 'Proximo recorrido' en la planilla; vencimiento calculado"
    return None, None, None


def resolver_fechas(celdas_last, celdas_next, freq_meses):
    """Resuelve (ultima ejecucion, vencimiento) en fechas.

    Cada lista va en orden de prioridad: primero la columna donde ese dato deberia
    estar, despues los respaldos (tipicamente las columnas del mes, donde la
    tripulacion anota la fecha real cuando la celda de arriba dice 'ok'). Las dos
    listas se pasan por separado y no se deducen por orden porque no todos los
    bloques de la planilla usan las mismas columnas: en el generador de emergencia
    la ultima ejecucion esta a la derecha del vencimiento.
    """
    last = next((d for d in (as_date(c) for c in celdas_last) if d), None)
    if not last:
        return None, None, None
    esperado = add_months(last, freq_meses)
    nxt = next((d for d in (as_date(c) for c in celdas_next) if d and d > last), None)
    if not nxt:
        return last, esperado, "sin vencimiento en la planilla; calculado desde la ultima ejecucion"
    nota = None
    if abs((nxt - esperado).days) > 20:
        nota = f"la planilla vence el {nxt} pero {last} + {freq_meses} meses da {esperado}"
    return last, nxt, nota
