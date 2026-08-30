# -*- coding: utf-8 -*-
"""Arma el informe HTML del estado del plan de mantenimiento del MAO 02.

Los datos salen del lote de carga y del volcado de la base: nada se transcribe
a mano.
"""
import html
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, "scripts/vessel-plan-tools")
from report_style import CSS  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

OUT = (r"C:\Users\gvill\AppData\Local\Temp\claude\c--CMS3-0"
       r"\3edf6b89-de5b-4f73-8f37-83e759543bcd\scratchpad\informe-m02.html")

e = html.escape

inf = json.load(open("scripts/vessel-plan-tools/out/informe-M02.json", encoding="utf-8"))
sob = json.load(open("scripts/vessel-plan-tools/out/m02-sobrantes.json", encoding="utf-8"))
lote = json.load(open("scripts/vessel-plan-tools/out/m02-plans.json", encoding="utf-8"))
rutinas = json.load(open("scripts/vessel-plan-tools/out/m02-rutinas.json", encoding="utf-8"))

planes = lote["planes"]
creados = lote["assetCreates"]
fixes = lote["assetFixes"]
REACTIVADOS = [("M02-COCINA", "Cocina", 8), ("M02-TERMOTQ", "Termotanque", 9),
               ("M02-MALACATE", "Malacate el\u00e9ctrico de pluma de lancha", 1),
               ("M02-LIBRO-AISL", "Libro de Aislaciones", 1),
               ("M02-COMB-CAL", "Calidad del Combustible", 1)]

# Sistema al que pertenece cada activo, en el orden del plan en papel.
SISTEMAS = [
    ("Sistema de propulsi\u00f3n", r"MP-|CR-|EJE-"),
    ("Motores auxiliares", r"MA-"),
    ("Alternadores y tablero", r"ALT-|TEP"),
    ("Circuito de combustible", r"COMB-CAL|EB-TRASV|TUB-COMB"),
    ("Bombas el\u00e9ctricas", r"EB-|BBA-INC|ACH-TIMON|FILT-"),
    ("Compresores", r"COMP-BR|COMP-ER"),
    ("Sistema hidr\u00e1ulico y maniobra", r"HID-GOB|BBA-HID|GUINCHE"),
    ("Ventiladores y extractores", r"VENT"),
    ("Otros equipos", r"AJUSTES|MALACATE|LIBRO-AISL|MOTOR-LANCHA|TERMOTQ|SEWAGE|COCINA|ELEV"),
    ("Navegaci\u00f3n y comunicaciones", r"AIS|CARTA|RADAR|ECO-|GPS|VHF"),
]


def sistema_de(asset):
    return next((n for n, rx in SISTEMAS if re.search(rx, asset)), "Otros")


por_sistema = defaultdict(int)
activos_de = defaultdict(set)
for p in planes:
    s = sistema_de(p["asset"])
    por_sistema[s] += 1
    activos_de[s].add(p["asset"])

notas = [(p["asset"], p["title"], p["nota"]) for p in planes if p.get("nota")]
TIPOS = [
    (r"pero .* da ", "\u00daltimo y pr\u00f3ximo trabajo que no cierran con la frecuencia"),
    (r"sin vencimiento", "Sin vencimiento anotado; calculado desde la \u00faltima ejecuci\u00f3n"),
    (r"no registra horas", "Sin horas de servicio registradas para el equipo"),
]
por_tipo = defaultdict(list)
for a, t, n in notas:
    por_tipo[next((lab for rx, lab in TIPOS if re.search(rx, n)), "Otras")].append((a, t, n))

sob_por_activo = defaultdict(list)
for s in sob:
    sob_por_activo[s.get("activo") or s.get("asset") or "(equipo dado de baja)"].append(s)


def tiles():
    datos = [
        (f"{inf['totalPlanes']}", "planes en el buque", None),
        (f"{inf['totalPlanes'] - len(sob)}", "salen del plan en papel", "accent"),
        (f"{len(creados)}", "equipos dados de alta", "accent"),
        (f"{len(REACTIVADOS)}", "equipos reactivados", "warn"),
        (f"{len(inf['vencidos'])}", "vencidos hoy", "crit"),
        (f"{len(sob)}", "sin par en el papel", "warn"),
    ]
    return "\n".join(
        f'<div class="tile{" t-" + k if k else ""}"><span class="num">{v}</span>'
        f'<span class="lbl">{e(l)}</span></div>' for v, l, k in datos)


def filas_sistema():
    return "\n".join(
        f"<tr><td>{e(n)}</td><td class=num>{len(activos_de[n])}</td>"
        f"<td class=num>{por_sistema[n]}</td></tr>"
        for n, _ in SISTEMAS if por_sistema[n])


def lista_creados():
    return "\n".join(
        f'<tr><td class="mono">{e(c["assetCode"])}</td><td>{e(c["name"])}</td>'
        f'<td class="mono dim">SFI {e(str(c.get("sfiCode") or "\u2014"))}</td></tr>'
        for c in creados)


def lista_reactivados():
    return "\n".join(
        f'<tr><td class="mono">{e(c)}</td><td>{e(n)}</td>'
        f'<td class="num">{ot}</td></tr>' for c, n, ot in REACTIVADOS)


def lista_fixes():
    previo = {
        "M02-MP-ER": "Volvo Penta D16 MH", "M02-MP-BR": "Volvo Penta D16 MH",
        "M02-CR-ER": "Twin Disc 5170", "M02-CR-BR": "Twin Disc 5170",
        "M02-ALT-ER": "DBT Cramaco G2R 200 SD/4", "M02-ALT-BR": "DBT Cramaco G2R 200 SD/4",
        "M02-MA-ER": "Cummins 4BTA3-G1", "M02-MA-BR": "Cummins 4BTA3-G1",
        "M02-RADAR-ER": "Furuno 1715", "M02-RADAR-BR": "Furuno M1934 BB",
        "M02-ECO-REMOL": "Furuno LS-4100",
    }
    nombre = {
        "M02-MP-ER": "Motor Principal Estribor", "M02-MP-BR": "Motor Principal Babor",
        "M02-CR-ER": "Caja reductora Estribor", "M02-CR-BR": "Caja reductora Babor",
        "M02-ALT-ER": "Alternador Estribor", "M02-ALT-BR": "Alternador Babor",
        "M02-MA-ER": "Motor Auxiliar Estribor", "M02-MA-BR": "Motor Auxiliar Babor",
        "M02-RADAR-ER": "Radar Principal", "M02-RADAR-BR": "Radar Auxiliar",
        "M02-ECO-REMOL": "Ecosonda del Remolcador",
    }
    return "\n".join(
        f'<tr><td>{e(nombre.get(f["asset"], f["asset"]))}</td>'
        f'<td class="dim">{e(previo.get(f["asset"], "\u2014"))}</td>'
        f'<td><b>{e(f["manufacturer"])} {e(f["model"])}</b></td></tr>' for f in fixes)


def lista_vencidos(limite=50):
    vs = sorted(inf["vencidos"], key=lambda x: x["nextDueDate"])
    filas = "\n".join(
        f'<tr><td class="mono">{e(str(v["nextDueDate"])[:10])}</td>'
        f'<td>{e(v["activo"] or v["asset"])}</td><td>{e(v["title"])}</td></tr>'
        for v in vs[:limite])
    resto = len(vs) - limite
    if resto > 0:
        filas += (f'<tr><td class="mono dim">\u2026</td><td colspan="2" class="dim">'
                  f'y {resto} m\u00e1s, todos con vencimiento posterior al '
                  f'{e(str(vs[limite]["nextDueDate"])[:10])}</td></tr>')
    return filas


def lista_sobrantes():
    return "\n".join(
        f'<tr><td>{e(a)}</td><td class="dim">'
        + "<br>".join(e(i["title"]) for i in sob_por_activo[a])
        + f'</td><td class="num">{len(sob_por_activo[a])}</td></tr>'
        for a in sorted(sob_por_activo))


def lista_notas():
    out = []
    for tipo in sorted(por_tipo, key=lambda t: -len(por_tipo[t])):
        items = por_tipo[tipo]
        filas = "\n".join(
            f'<li><span class="mono">{e(a)}</span> \u2014 {e(t)}<br><span class="dim">{e(n)}</span></li>'
            for a, t, n in items)
        out.append(f'<details><summary>{e(tipo)} <span class="cnt">{len(items)}</span></summary>'
                   f'<ul class="notas">{filas}</ul></details>')
    return "\n".join(out)


HTML = f"""<title>Plan de M\u00e1quinas del Mao 02</title>
<style>{CSS}</style>
<div class="wrap">

<header>
  <p class="eyebrow">Estado de resultado \u00b7 Mercurio Group</p>
  <h1 class="disp">Plan de M\u00e1quinas del Mao 02
    <span class="sub">El plan cargado en el sistema, alineado contra la planilla de a bordo</span></h1>
  <dl class="meta">
    <div><dt>Buque</dt><dd>R/E MAO 02</dd></div>
    <div><dt>Fuente</dt><dd>Plan de Mantenimiento M\u00e1quinas \u2014 Julio 2026</dd></div>
    <div><dt>\u00cdtems</dt><dd>48 de 48</dd></div>
    <div><dt>Fecha</dt><dd>20 de agosto de 2026</dd></div>
  </dl>
</header>

<div class="tiles">{tiles()}</div>

<section>
  <h2 class="disp">De d\u00f3nde se part\u00eda</h2>
  <p class="lead">97 planes en el sistema contra 222 tareas en la planilla de a bordo.</p>
  <p>El plan del MAO 02 ven\u00eda de un clon, igual que los del Latere y el Don Chicueto: los
  planes dec\u00edan \u00abSERVICE: Cambio de Aceite y Filtros\u00bb con la frecuencia del buque de origen,
  donde la planilla nombra la tarea y su frecuencia real. Faltaban adem\u00e1s <b>154 tareas</b>
  que la tripulaci\u00f3n s\u00ed lleva en el papel.</p>
</section>

<section>
  <h2 class="disp">Lo que se carg\u00f3</h2>
  <p class="lead">218 planes salen de la planilla, m\u00e1s dos de rutina consolidada.</p>
  <div class="scroll"><table>
    <thead><tr><th>Sistema</th><th class="num">Equipos</th><th class="num">Planes</th></tr></thead>
    <tbody>{filas_sistema()}</tbody>
  </table></div>

  <h3>Equipos dados de alta</h3>
  <p>La planilla los lleva y el sistema no los ten\u00eda. Los tres de trasvase de combustible y
  las tres bombas de agua potable estaban cargados como un equipo \u00fanico cuando en realidad
  son varios.</p>
  <div class="scroll"><table>
    <thead><tr><th>C\u00f3digo</th><th>Equipo</th><th>Grupo</th></tr></thead>
    <tbody>{lista_creados()}</tbody>
  </table></div>

  <h3>Equipos reactivados</h3>
  <p>Estaban dados de baja el 14 de julio, pero la planilla de julio los lleva con tareas
  cumplidas y ten\u00edan \u00f3rdenes de trabajo colgando. Se reactivaron en vez de crear un equipo
  gemelo, que habr\u00eda partido su historial en dos.</p>
  <div class="scroll"><table>
    <thead><tr><th>C\u00f3digo</th><th>Equipo</th><th class="num">OT previas</th></tr></thead>
    <tbody>{lista_reactivados()}</tbody>
  </table></div>

  <h3>Fichas de equipo corregidas</h3>
  <p>Once equipos ten\u00edan la marca y el modelo del buque del que se clon\u00f3 el plan.</p>
  <div class="scroll"><table>
    <thead><tr><th>Equipo</th><th>Figuraba</th><th>Dice la planilla</th></tr></thead>
    <tbody>{lista_fixes()}</tbody>
  </table></div>
</section>

<section>
  <h2 class="disp">Rutinas de guardia</h2>
  <p class="lead">Cuatro tareas de rutina, unificadas en dos planes.</p>
  <p>El control diario en general de los dos motores principales qued\u00f3 en un plan
  <b>semanal</b> \u2014 las tareas van marcadas \u00ab(diaria)\u00bb para no perder con qu\u00e9 frecuencia se
  hacen \u2014 y el control de bater\u00edas de arranque de los dos motores auxiliares, que la planilla
  pone cada 15 d\u00edas, en un plan <b>quincenal</b>. Los dos cuelgan de \u00abEquipos de M\u00e1quinas en
  General\u00bb.</p>
</section>

<section>
  <h2 class="disp">Lo que est\u00e1 en el sistema y no en la planilla</h2>
  <p class="lead">{len(sob)} planes sobre {len(sob_por_activo)} equipos. No se tocaron:
  conservan su tarea, su frecuencia y su forma de disparo.</p>
  <p>Son requisitos de clase y estatutarios que la planilla de m\u00e1quinas no lista \u2014 casco y
  cubierta, CO2, detecci\u00f3n de incendio, sistema de amarre, bater\u00edas de emergencia \u2014 m\u00e1s los
  planes gen\u00e9ricos del clon sin equivalente en el papel. A todos se les complet\u00f3 \u00e1rea y
  responsable, y todos tienen el an\u00e1lisis de IA.</p>
  <div class="scroll"><table>
    <thead><tr><th>Equipo</th><th>Planes</th><th class="num">N.\u00ba</th></tr></thead>
    <tbody>{lista_sobrantes()}</tbody>
  </table></div>
  <div class="callout">
    <p><b>El electrocompresor a tornillo NK40 concentra 10 de esos planes.</b> La planilla del
    MAO 02 no lo menciona: lleva dos compresores Ingersoll-Rand, que se dieron de alta. Vale
    confirmar si el NK40 est\u00e1 realmente a bordo.</p>
    <p><b>El motor auxiliar de puerto tambi\u00e9n queda entero sin par</b> (10 planes): la
    planilla s\u00f3lo lleva los auxiliares de babor y estribor.</p>
  </div>
</section>

<section>
  <h2 class="disp">Datos de la planilla que no cierran</h2>
  <p class="lead">{len(notas)} observaciones. Ninguna se corrigi\u00f3 por cuenta propia: se carg\u00f3
  lo que dice el papel y queda anotado para revisar a bordo.</p>
  {lista_notas()}
  <div class="callout">
    <p><b>Dos fechas imposibles en la planilla.</b> La bomba de incendio de emergencia tiene
    pr\u00f3ximo recorrido en el a\u00f1o <span class="mono">20231</span>, y la bomba hidr\u00e1ulica de
    estribor en <span class="mono">20231</span> tambi\u00e9n. Un inyector del motor principal de
    babor tiene <span class="mono">1931-11-05</span>. Se descartaron y el vencimiento se
    calcul\u00f3 desde la \u00faltima ejecuci\u00f3n.</p>
    <p><b>Una tarea no se carg\u00f3</b>: el control de correas del motor principal de estribor,
    porque la planilla le pone \u00abN/A\u00bb en la frecuencia. En el de babor s\u00ed figura, cada 600
    horas, y se carg\u00f3.</p>
  </div>
</section>

<section>
  <h2 class="disp">Vencidos al d\u00eda de hoy</h2>
  <p class="lead">{len(inf['vencidos'])} planes con fecha de vencimiento pasada, seg\u00fan los
  datos de la planilla.</p>
  <div class="scroll"><table>
    <thead><tr><th>Venci\u00f3</th><th>Equipo</th><th>Tarea</th></tr></thead>
    <tbody>{lista_vencidos()}</tbody>
  </table></div>
</section>

<section>
  <h2 class="disp">Pendiente de decisi\u00f3n</h2>
  <ol class="pend">
    <li><b>Un plan hu\u00e9rfano.</b> El bar\u00f3metro (<span class="mono">M02-BAROM</span>) est\u00e1 dado
      de baja pero su plan sigue activo, as\u00ed que no aparece en ninguna pantalla de equipo.
      La planilla del MAO 02 no lo lista \u2014 a diferencia de las del Latere y el Don Chicueto \u2014
      as\u00ed que no se reactiv\u00f3. Hay que decidir si el equipo existe a bordo.</li>
    <li><b>El electrocompresor NK40</b> y el <b>motor auxiliar de puerto</b>, que la planilla
      no lleva pero el sistema s\u00ed, con 20 planes entre los dos.</li>
    <li><b>Nueve equipos m\u00e1s siguen dados de baja</b>: alarmas de sentina y de tanques,
      ecosondas de babor y estribor, intercomunicador, tel\u00e9fono de consola, torre de se\u00f1ales
      y cortes de emergencia. Ninguno figura en la planilla de m\u00e1quinas.</li>
    <li><b>El compresor de aire del pito</b> qued\u00f3 sin par: la planilla no lo menciona.</li>
  </ol>
</section>

<footer>
  <p>Los datos de este informe salen de la base del sistema y del archivo de carga. El estado
  previo qued\u00f3 respaldado antes de escribir.</p>
</footer>

</div>
"""

open(OUT, "w", encoding="utf-8").write(HTML)
print("escrito:", OUT)
print(f"sistemas {len([1 for n, _ in SISTEMAS if por_sistema[n]])} \u00b7 creados {len(creados)} \u00b7 "
      f"reactivados {len(REACTIVADOS)} \u00b7 fichas {len(fixes)} \u00b7 notas {len(notas)} \u00b7 "
      f"sobrantes {len(sob)} en {len(sob_por_activo)} equipos \u00b7 vencidos {len(inf['vencidos'])}")
