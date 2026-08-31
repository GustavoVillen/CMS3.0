# -*- coding: utf-8 -*-
"""Lectores de las dos formas de hoja que usan las planillas de los remolcadores.

Las planillas del MAO 01, el MAO 02 y el LATERE salen todas del mismo formulario,
asi que repiten dos layouts:

  · HOJA DE TAREAS — una fila por tarea. El equipo se escribe una vez en la
    columna "Descripcion" y se arrastra hacia abajo mientras siguen sus tareas.
    Trae "Realizar cada", "Ultima verificacion" y "Proximo recorrido", en horas de
    servicio o en fechas segun la tarea.

  · HOJA SEMANAL ("equipos criticos") — la ronda de la tripulacion, con las cuatro
    semanas del mes como columnas. No hay vencimiento: la ultima ejecucion es la
    fecha mas nueva anotada en las semanas.

Cada buque arranca sus hojas en una columna distinta, asi que las columnas se
detectan por el texto del encabezado y no por posicion.

Esto NO transforma el papel (no junta tareas ni aparta rutinas): la auditoria
necesita ver la fila como esta escrita.
"""
import re

from paper_plan_common import as_date, as_num, norm, parse_frecuencia

# Filas que no son tareas: encabezados repetidos al cambiar de pagina, titulos de
# grupo, pies de hoja con la firma del jefe de maquinas.
RX_RUIDO = re.compile(
    r"firma y aclaraci|tarea a realizar|^r/e |^fecha|^item$|^.tem$|^maquinas$|"
    r"^hoja nr|^observaciones|^descripci|^renovado$|^mantenimiento$|^prox|^proxima|"
    r"^controlado$|^ok$|^carlos gomez$|^jefe de m|^firma", re.I)

RX_INSPECCION = re.compile(
    r"^\s*(verificar|verificaci|control|controlar|inspecci|comprobar|tomar|toma de|"
    r"prueba|probar|test|chequeo|muestreo|medici|analisis|analizar|regulacion|"
    r"protocolo|certificaci|renovar grupo)", re.I)

# "Cambio de Magnetron 2KW a las 9000 hs": la frecuencia esta en el texto de la
# tarea y no en su columna.
RX_HS_EN_TEXTO = re.compile(r"a las\s+([\d.]+)\s*hs", re.I)


def limpiar(t):
    t = re.sub(r"\s+", " ", t or "").strip(" .")
    return (t[0].upper() + t[1:]) if t else t


def _hdr(rows, marca="tarea a realizar"):
    """Indice de la fila de encabezado, por el texto que la identifica."""
    for i, r in enumerate(rows):
        if any(marca in norm(c).lower() for c in r):
            return i
    return None


def _col(hdr, *patrones, default=None):
    """Primera columna cuyo encabezado matchea alguno de los patrones."""
    for pat in patrones:
        for i, c in enumerate(hdr):
            if re.search(pat, c):
                return i
    return default


def _fila_base(vessel, hoja, i, equipo, tarea, asset, punt, via, amb):
    return dict(
        vessel=vessel, asset=asset, assetPuntaje=punt, assetVia=via, assetAmbiguo=amb,
        equipo=equipo, code=None, title=limpiar(tarea)[:120], hoja=hoja, fila=i + 1,
        taskType="INSPECTION" if RX_INSPECCION.match(tarea) else "MAINTENANCE",
        triggerType=None, frequencyHours=None, frequencyMonths=None,
        lastExecutionHours=None, nextDueHours=None,
        lastExecutionDate=None, nextDueDate=None,
        frecuenciaTexto=None, frecuenciaHeredada=False)


def leer_hoja_tareas(ws, vessel, hoja, res, filas, avisos, max_col=20,
                     usar_grupo=False, columnas=None):
    """Hoja de tareas con el equipo arrastrado hacia abajo.

    `usar_grupo`: si el equipo no resuelve, probar con el titulo de grupo. Sirve
    en el LATERE, donde el grupo ES el equipo con su marca y modelo ("MOTOR
    PRINCIPAL N01 BR-KTA 50 CUMMINS"). En el MAO 01 hay que dejarlo apagado: ahi
    el grupo es una familia ("VENTILADORES Y EXTRACTORES") de la que cuelgan
    equipos distintos, y arrastraria la cocina al activo de los ventiladores.
    """
    rows = [[c.value for c in r] for r in ws.iter_rows(max_col=min(ws.max_column, max_col))]
    h = _hdr(rows)
    if h is None:
        if columnas is None:
            avisos.append("%s: no se encontro la fila de encabezado" % hoja)
            return
        # Hoja sin encabezado (NAV-COM del LATERE): las columnas van a mano.
        h, c_eq, c_task, c_freq, c_last, c_next = columnas
    else:
        hdr = [norm(c).lower() for c in rows[h]]
        c_task = _col(hdr, r"tarea a realizar")
        c_eq = _col(hdr, r"descripci", default=max(c_task - 1, 0))
        c_freq = _col(hdr, r"realizar cada", default=c_task + 1)
        # Los motores usan "Hora de cambio Act."; el resto, "Ultima verificacion".
        c_last = _col(hdr, r"ltima.*verificaci", r"hora de cambio", r"ltima", default=c_task + 2)
        # Y del otro lado "Proximo recorrido" o "Recorrido Actual".
        c_next = _col(hdr, r"ximo.*recorrido", r"ximo", r"recorrido", default=c_task + 3)

    equipo, grupo, arrastrada = None, None, (None, None)
    for i in range(h + 1, len(rows)):
        r = list(rows[i]) + [None] * (max_col + 2)
        if norm(r[c_eq]):
            equipo = norm(r[c_eq])
            arrastrada = (None, None)      # equipo nuevo, frecuencia nueva
        tarea = norm(r[c_task])
        # Titulo de grupo: fila con texto a la izquierda y sin tarea. En el LATERE
        # ahi va el equipo con marca y modelo ("MOTOR PRINCIPAL N01 BR-KTA 50").
        primera = next((norm(c) for c in r[:c_eq + 1] if norm(c)), "")
        if not tarea:
            if primera and not RX_RUIDO.search(primera) and len(primera) > 5:
                grupo = primera
            continue
        if RX_RUIDO.search(tarea):
            continue
        # Titulo de grupo escrito en la MISMA columna que las tareas ("LINEA DE
        # EJES" en la hoja de cajas del LATERE): todo en mayusculas, pocas
        # palabras y sin frecuencia ni fechas. No es una tarea.
        if (tarea.isupper() and len(tarea.split()) <= 4 and not norm(r[c_freq])
                and not norm(r[c_last]) and not norm(r[c_next])):
            grupo = tarea
            continue
        if not equipo and not grupo:
            avisos.append("%s fila %d: tarea sin equipo — %s" % (hoja, i + 1, tarea[:60]))
            continue

        tipo, valor = parse_frecuencia(r[c_freq])
        heredada = False
        if tipo is None:
            m = RX_HS_EN_TEXTO.search(tarea)
            if m:
                tipo, valor = "HOURS", float(m.group(1).replace(".", ""))
            elif arrastrada[0]:
                # Los equipos de navegacion escriben la frecuencia una sola vez, en
                # la primera tarea del bloque; las de abajo son del mismo lapso.
                tipo, valor = arrastrada
                heredada = True
            else:
                avisos.append("%s fila %d: frecuencia ilegible '%s' — %s"
                              % (hoja, i + 1, norm(r[c_freq])[:20], tarea[:50]))
        else:
            arrastrada = (tipo, valor)

        if usar_grupo:
            asset, punt, via, amb = res.resolver(equipo, grupo)
        else:
            asset, punt, via, amb = res.resolver(equipo or grupo)
        p = _fila_base(vessel, hoja, i, equipo or grupo, tarea, asset, punt, via, amb)
        p["grupo"] = grupo
        p["triggerType"] = tipo
        p["frecuenciaTexto"] = norm(r[c_freq]) or None
        p["frecuenciaHeredada"] = heredada
        if tipo == "HOURS":
            p["frequencyHours"] = valor
            p["lastExecutionHours"] = as_num(r[c_last])
            p["nextDueHours"] = as_num(r[c_next])
        elif tipo == "MONTHS":
            p["frequencyMonths"] = valor
            d1, d2 = as_date(r[c_last]), as_date(r[c_next])
            p["lastExecutionDate"] = d1.isoformat() if d1 else None
            p["nextDueDate"] = d2.isoformat() if d2 else None
        elif tipo == "RUTINA":
            p["frecuenciaRutina"] = valor
        filas.append(p)


def leer_hoja_semanal(ws, vessel, hoja, res, filas, avisos, max_col=16):
    """Hoja 'equipos criticos': las cuatro semanas del mes son columnas."""
    rows = [[c.value for c in r] for r in ws.iter_rows(max_col=min(ws.max_column, max_col))]
    h = _hdr(rows)
    if h is None:
        avisos.append("%s: no se encontro la fila de encabezado" % hoja)
        return
    hdr = [norm(c).lower() for c in rows[h]]
    c_task = _col(hdr, r"tarea a realizar")
    c_eq = _col(hdr, r"descripci", default=max(c_task - 3, 0))
    c_freq = _col(hdr, r"realizar cada", default=c_task + 1)
    c_fechas = _col(hdr, r"fecha de realizaci", default=c_task + 2)
    c_crit = _col(hdr, r"^cr.tico|^critico")

    for i in range(h + 1, len(rows)):
        r = list(rows[i]) + [None] * (max_col + 2)
        tarea, equipo = norm(r[c_task]), norm(r[c_eq])
        if not tarea or RX_RUIDO.search(tarea):
            continue
        if not equipo:
            avisos.append("%s fila %d: tarea sin equipo — %s" % (hoja, i + 1, tarea[:60]))
            continue
        tipo, valor = parse_frecuencia(r[c_freq])
        critico = None
        if c_crit is not None:
            critico = ("SI" if norm(r[c_crit]).upper() == "X"
                       else ("NO" if norm(r[c_crit + 1]).upper() == "X" else None))
        # La ultima ejecucion es la fecha mas nueva anotada en las semanas; las
        # celdas con "ok" o "CONTROLADO" no traen fecha y as_date las descarta.
        fechas = sorted(d for d in (as_date(c) for c in r[c_fechas:c_fechas + 6]) if d)

        asset, punt, via, amb = res.resolver(equipo)
        p = _fila_base(vessel, hoja, i, equipo, tarea, asset, punt, via, amb)
        p["triggerType"] = tipo
        p["critico"] = critico
        p["frecuenciaTexto"] = norm(r[c_freq]) or None
        p["lastExecutionDate"] = fechas[-1].isoformat() if fechas else None
        if tipo == "HOURS":
            p["frequencyHours"] = valor
        elif tipo == "MONTHS":
            p["frequencyMonths"] = valor
        elif tipo == "RUTINA":
            p["frecuenciaRutina"] = valor
        filas.append(p)
