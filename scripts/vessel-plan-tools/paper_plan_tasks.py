# -*- coding: utf-8 -*-
"""Catalogo de las tareas que se repiten a lo largo del plan en papel del LATERE.

Las hojas de bombas, compresores, ventiladores, cabrestantes, circuito de
combustible y separador repiten las mismas tareas equipo por equipo ("Toma de
Aislacion a Motor Electrico", "Recorrido motor electrico: limpieza, barnizado,
cambio rodamientos", "Prueba de Funcionamiento"...). Este catalogo les da a todas
el mismo titulo, la misma descripcion y el mismo codigo, para que el plan quede
consistente entre equipos y no dependa de como quedo tipeada cada fila.

Los codigos van de 30 en adelante a proposito: los planes que ya existian en el
sistema usan 01..24, asi que no hay colisiones.
"""

CATALOGO = [
    dict(code="30", match=r"toma de aislaci|control aislaci.n de motor|toma de aislacion",
         title="CONTROL: Aislacion del motor electrico", task="INSPECTION",
         desc="[  ] Medicion de aislacion del bobinado con megohmetro\n[  ] Comparacion contra el valor minimo admisible\n[  ] Registro del valor medido"),
    dict(code="31", match=r"verificar ajustes y estanqueidad|ajustes y estanqueidad bornera",
         title="CONTROL: Ajustes y estanqueidad de la bornera del motor electrico", task="INSPECTION",
         desc="[  ] Reapriete de bornes al torque especificado\n[  ] Control de estanqueidad de la bornera y de su junta\n[  ] Verificacion del prensacable y del estado del cableado"),
    dict(code="32", match=r"recorrido motor el.ctrico",
         title="RECORRIDO: Motor electrico", task="MAINTENANCE",
         desc="[  ] Desmontaje del motor electrico\n[  ] Limpieza y barnizado del bobinado\n[  ] Cambio de rodamientos\n[  ] Control de aislacion posterior y prueba de funcionamiento"),
    dict(code="33", match=r"recorrido de bomba",
         title="RECORRIDO: Bomba", task="MAINTENANCE",
         desc="[  ] Desarme de la bomba\n[  ] Verificacion del aro de rendimiento y del estado del impulsor\n[  ] Cambio de sellos y retenes, o reemplazo de la bomba\n[  ] Armado y prueba de caudal y presion"),
    dict(code="34", match=r"prueba de funcionamiento|verificar funcionamiento|puesta en marcha",
         title="PRUEBA: Funcionamiento", task="INSPECTION",
         desc="[  ] Puesta en marcha e inspeccion visual\n[  ] Control de presion, caudal y temperatura\n[  ] Verificacion de ruidos, vibracion y ausencia de perdidas"),
    dict(code="35", match=r"engrase de partes moviles|engrase",
         title="ENGRASE: Partes moviles", task="MAINTENANCE",
         desc="[  ] Engrase de partes moviles segun especificacion\n[  ] Control de estado de guias, ejes y rodamientos\n[  ] Limpieza de excedentes"),
    dict(code="36", match=r"prueba de comando direccional",
         title="PRUEBA: Comando direccional", task="INSPECTION",
         desc="[  ] Prueba de comando en ambos sentidos de giro\n[  ] Verificacion de finales de carrera y frenos\n[  ] Control de respuesta desde el puesto de maniobra"),
    dict(code="37", match=r"limpieza de condensador",
         title="LIMPIEZA: Condensador", task="MAINTENANCE",
         desc="[  ] Limpieza del condensador\n[  ] Control de aletas y de la ventilacion\n[  ] Verificacion de presiones de trabajo"),
    # Control y cambio de correas son dos tareas distintas del papel, con
    # frecuencias distintas (mensual contra anual en el compresor): no pueden
    # compartir entrada ni terminar con el mismo titulo.
    dict(code="46", match=r"cambio de correas",
         title="CAMBIO: Correas de transmision", task="MAINTENANCE",
         desc="[  ] Cambio de las correas de transmision\n[  ] Ajuste de tension segun especificacion\n[  ] Verificacion de alineacion de poleas"),
    dict(code="38", match=r"control de correa",
         title="CONTROL: Estado y tension de correas", task="INSPECTION",
         desc="[  ] Verificacion del estado y la tension de las correas\n[  ] Ajuste segun especificacion\n[  ] Cambio si presentan fisuras o desgaste"),
    dict(code="39", match=r"cambio de aceite",
         title="SERVICE: Cambio de aceite", task="MAINTENANCE",
         desc="[  ] Cambio de aceite\n[  ] Verificacion de nivel y ausencia de perdidas"),
    dict(code="40", match=r"cambio.*filtro de aire|cambio filtro de aire",
         title="FILTROS: Cambio de filtro de aire", task="MAINTENANCE",
         desc="[  ] Cambio de filtro de aire\n[  ] Limpieza del alojamiento"),
    dict(code="41", match=r"prueba hidr.ulica|prueba de presion de tuber",
         title="PRUEBA HIDRAULICA: Tuberias, con certificado", task="INSPECTION",
         desc="[  ] Prueba hidraulica de las tuberias a la presion de ensayo\n[  ] Verificacion de ausencia de perdidas y deformaciones\n[  ] Emision del certificado correspondiente"),
    dict(code="42", match=r"toma de muestra",
         title="TOMA DE MUESTRAS: Analisis en laboratorio", task="INSPECTION",
         sampling=("FLUID", None),
         desc="[  ] Toma de muestra en el punto definido\n[  ] Envio a laboratorio y analisis\n[  ] Registro del resultado en el historial del equipo"),
    dict(code="43", match=r"recorrido general",
         title="RECORRIDO GENERAL", task="MAINTENANCE",
         desc="[  ] Recorrido general del equipo\n[  ] Desarme, medicion y control de desgaste\n[  ] Cambio de componentes fuera de tolerancia\n[  ] Armado y prueba de funcionamiento"),
    dict(code="44", match=r"inspeccion termografica|inspecci.n termogr",
         title="INSPECCION TERMOGRAFICA", task="INSPECTION",
         desc="[  ] Inspeccion termografica en carga\n[  ] Identificacion de puntos calientes\n[  ] Informe con imagenes y temperaturas medidas"),
    dict(code="45", match=r"certificacion|certificaci.n",
         title="CERTIFICACION", task="INSPECTION",
         desc="[  ] Ensayo y verificacion por organismo o taller habilitado\n[  ] Emision del certificado\n[  ] Archivo del certificado en la documentacion del buque"),
]


def buscar(texto):
    """Devuelve la entrada del catalogo que corresponde a esa tarea, o None."""
    import re
    t = (texto or "").strip()
    for spec in CATALOGO:
        if re.search(spec["match"], t, re.I):
            return spec
    return None
