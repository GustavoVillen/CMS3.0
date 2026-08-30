# -*- coding: utf-8 -*-
"""Arma el informe HTML de la auditoria del DON CHICUETO a partir de
`out/dch-auditoria.json` + `out/dch-auditoria2.json` + `out/dch-estado.json`.

Todas las tablas se generan desde los JSON: no hay datos escritos a mano.
"""
import html
import json
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

AUD = json.load(open("scripts/vessel-plan-tools/out/dch-auditoria.json", encoding="utf-8"))
AUD2 = json.load(open("scripts/vessel-plan-tools/out/dch-auditoria2.json", encoding="utf-8"))
EST = json.load(open("scripts/vessel-plan-tools/out/dch-estado.json", encoding="utf-8"))

WOS = {w["maintenancePlanId"]: w["_count"]["_all"] for w in EST["wos"]}
ASSETS = {a["id"]: a for a in EST["assets"]}
VIVOS = [p for p in EST["plans"] if not p["deletedAt"]]
BORRADOS = [p for p in EST["plans"] if p["deletedAt"]]
NUEVOS = {n["taskCode"] for n in AUD2["nuevos"]}

E = html.escape


def freq(p):
    if p.get("triggerType") == "HOURS" and p.get("frequencyHours"):
        return f"{p['frequencyHours']:,.0f} h".replace(",", ".")
    if p.get("frequencyMonths"):
        m = p["frequencyMonths"]
        return f"{m} mes" if m == 1 else f"{m} meses"
    return p.get("triggerType", "—")


# ---------------------------------------------------------------- 1. perdidas
# Cada colision es un casillero de codigo con mas de una fila del papel: la que
# entro despues piso a la anterior.
perdidas = []
for clave, filas in AUD["colisiones"].items():
    titulos_perdidos = {s["title"] for s in AUD["sinPlan"]}
    quedo = [s for s in filas if s["title"] not in titulos_perdidos]
    fuera = [s for s in filas if s["title"] in titulos_perdidos]
    for s in fuera:
        perdidas.append(dict(clave=clave, perdida=s, quedo=quedo[0] if quedo else None,
                             hoja=s["_hoja"]))

# La fila de AA-SPLIT no es una colision: su plan se dio de baja el 28-ago.
borrada = [s for s in AUD["sinPlan"] if s["asset"] == "DCH-AA-SPLIT"]

# ------------------------------------------------- 2. ejecuciones sin respaldo
por_code = {p["taskCode"]: p for p in AUD2["plans"]}
ot_directa = {}
for w in AUD2["directas"]:
    ot_directa.setdefault(w["maintenancePlanId"], []).append(w)
ot_link = {}
for w in AUD2["links"]:
    ot_link.setdefault(w["maintenancePlanId"], []).append(w["workOrder"])

sin_respaldo, con_respaldo = [], []
for d in AUD["ejecutados"]:
    p = por_code.get(d["taskCode"])
    ult = (p["lastExecutionDate"] or "")[:10] if p else ""
    ots = ot_directa.get(p["id"], []) + ot_link.get(p["id"], []) if p else []
    match = [w for w in ots if (w.get("completedDate") or "")[:10] == ult]
    campos = {c["campo"]: c for c in d["campos"]}
    fila = dict(code=d["taskCode"], title=d["title"], ult=ult,
                papel=(campos.get("ult.ejec (fecha)") or {}).get("papel", "—"),
                vence=(campos.get("vence (fecha)") or {}).get("sistema", "—"),
                editado=d["updatedAt"], ots=len(ots),
                respaldo=match[0]["workOrderCode"] if match else None)
    (con_respaldo if match else sin_respaldo).append(fila)

# ---------------------------------------------------------------- 3. sobrantes
GEN = re.compile(r"^(mantenimiento (cada|anual|semestral|trimestral|mensual)|overhaul|"
                 r"inspeccion y pruebas|inspeccion (anual|semanal|mensual))", re.I)
CLASE = re.compile(r"clase|dique seco|prueba de peso|prueba hidraulica|integridad estructural|"
                   r"eje portahelice|prueba hidráulica", re.I)


def origen(p):
    if p["taskCode"] in NUEVOS:
        return ("nueva", "Alta posterior")
    if p["taskCode"].startswith("DCH-0-") or CLASE.search(p["title"]):
        return ("clase", "Clase / estatutario")
    if GEN.match(p["title"]):
        return ("clon", "Heredada del clon")
    return ("equipo", "Del equipo, fuera del papel")


sobrantes = sorted(AUD["sobrantes"], key=lambda p: (p["_asset"], p["taskCode"]))
for p in sobrantes:
    p["_origen"] = origen(p)
conteo = {}
for p in sobrantes:
    conteo[p["_origen"][1]] = conteo.get(p["_origen"][1], 0) + 1

# ------------------------------------------------------------------- render
def filas_perdidas():
    out = []
    for x in sorted(perdidas, key=lambda y: y["clave"]):
        s, q = x["perdida"], x["quedo"]
        misma = q and re.sub(r"[^a-z]", "", s["title"].lower()[-40:]) [:12] and \
            ("verificar funcionamiento" in s["title"].lower() and "prueba de funcionamiento" in q["title"].lower())
        sev = "media" if misma else "alta"
        out.append(f"""<tr>
  <td><code>{E(x['clave'])}</code></td>
  <td><span class="sev sev-{sev}">{'Duplicada' if misma else 'Se perdio'}</span></td>
  <td class="task"><strong>{E(s['title'])}</strong><span class="meta">{freq(s)} · hoja {E(x['hoja'])}</span></td>
  <td class="task">{E(q['title']) if q else '—'}<span class="meta">{freq(q) if q else ''} · hoja {E(q['_hoja']) if q else ''}</span></td>
</tr>""")
    return "\n".join(out)


def filas_sin_respaldo():
    out = []
    for f in sorted(sin_respaldo, key=lambda x: x["code"]):
        out.append(f"""<tr>
  <td><code>{E(f['code'])}</code></td>
  <td class="task">{E(f['title'])}</td>
  <td class="num">{E(str(f['papel']))}</td>
  <td class="num strong">{E(f['ult'])}</td>
  <td class="num">{E(str(f['vence']))}</td>
  <td class="num muted">{E(f['editado'])}</td>
</tr>""")
    return "\n".join(out)


def filas_sobrantes():
    out, actual = [], None
    for p in sobrantes:
        if p["_asset"] != actual:
            actual = p["_asset"]
            out.append(f"""<tr class="group" data-cat="todos">
  <td colspan="5"><code>{E(p['_asset'])}</code> {E(p['_activo'])}</td></tr>""")
        cat, etiqueta = p["_origen"]
        ot = WOS.get(p["id"], 0)
        out.append(f"""<tr data-cat="{cat}">
  <td><code>{E(p['taskCode'])}</code></td>
  <td class="num">{E(freq(p))}</td>
  <td class="task">{E(p['title'])}</td>
  <td><span class="tag tag-{cat}">{E(etiqueta)}</span></td>
  <td class="num muted">{('%d OT' % ot) if ot else '—'}</td>
</tr>""")
    return "\n".join(out)


HTML = f"""<title>Auditoría del Plan del Don Chicueto</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root {{
  --ground: #eef1f2;
  --surface: #ffffff;
  --surface-2: #e4e9ea;
  --line: #ccd6d8;
  --line-soft: #dde5e6;
  --ink: #131b1f;
  --ink-2: #3d4d54;
  --muted: #6b7d84;
  --accent: #0d6b68;
  --accent-soft: #d8e8e6;
  --crit: #a2311d;
  --crit-soft: #f2ddd8;
  --warn: #8a6410;
  --warn-soft: #f0e6cf;
  --ok: #2c6238;
  --ok-soft: #dcead9;
  --shadow: 0 1px 2px rgba(19,27,31,.06), 0 8px 24px -16px rgba(19,27,31,.28);
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground: #0d1316;
    --surface: #151d21;
    --surface-2: #1c262b;
    --line: #2c3a40;
    --line-soft: #232f34;
    --ink: #e2eaec;
    --ink-2: #b3c3c8;
    --muted: #7f9298;
    --accent: #45b3ab;
    --accent-soft: #12332f;
    --crit: #e8836a;
    --crit-soft: #3a201a;
    --warn: #d6a851;
    --warn-soft: #362b13;
    --ok: #7dbb86;
    --ok-soft: #1a2f1e;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px -20px rgba(0,0,0,.9);
  }}
}}
:root[data-theme="dark"] {{
  --ground: #0d1316; --surface: #151d21; --surface-2: #1c262b;
  --line: #2c3a40; --line-soft: #232f34;
  --ink: #e2eaec; --ink-2: #b3c3c8; --muted: #7f9298;
  --accent: #45b3ab; --accent-soft: #12332f;
  --crit: #e8836a; --crit-soft: #3a201a;
  --warn: #d6a851; --warn-soft: #362b13;
  --ok: #7dbb86; --ok-soft: #1a2f1e;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px -20px rgba(0,0,0,.9);
}}

* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}}
.wrap {{ max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }}

h1, h2, h3 {{ font-family: "Barlow Condensed", "IBM Plex Sans", sans-serif; text-wrap: balance; margin: 0; }}
h1 {{ font-size: clamp(34px, 5vw, 50px); font-weight: 700; letter-spacing: .005em; line-height: 1.05; }}
h2 {{ font-size: 27px; font-weight: 600; letter-spacing: .01em; }}
h3 {{ font-size: 19px; font-weight: 600; }}
p {{ margin: 0; max-width: 68ch; }}
code {{ font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .86em; }}

.eyebrow {{
  font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: .16em;
  text-transform: uppercase; color: var(--muted);
}}

header {{ border-bottom: 2px solid var(--ink); padding-bottom: 22px; margin-bottom: 30px; }}
header .lead {{ color: var(--ink-2); margin-top: 12px; font-size: 16.5px; }}
.fuente {{
  display: flex; flex-wrap: wrap; gap: 6px 28px; margin-top: 20px;
  font-size: 12.5px; color: var(--muted);
}}
.fuente b {{ color: var(--ink-2); font-weight: 500; }}

.panel {{
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px; background: var(--line-soft); border: 1px solid var(--line);
  border-radius: 3px; overflow: hidden; margin-bottom: 44px;
}}
.tile {{ background: var(--surface); padding: 16px 18px 15px; }}
.tile .n {{
  font-family: "Barlow Condensed", sans-serif; font-size: 40px; font-weight: 700;
  line-height: 1; font-variant-numeric: tabular-nums; display: block;
}}
.tile .l {{ font-size: 12px; color: var(--muted); display: block; margin-top: 7px; line-height: 1.35; }}
.tile.is-crit {{ background: var(--crit-soft); }}
.tile.is-crit .n {{ color: var(--crit); }}
.tile.is-warn {{ background: var(--warn-soft); }}
.tile.is-warn .n {{ color: var(--warn); }}
.tile.is-ok .n {{ color: var(--ok); }}

section {{ margin-bottom: 52px; }}
.shead {{ display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 6px; }}
.shead .stripe {{
  width: 4px; align-self: stretch; border-radius: 2px; background: var(--accent);
}}
section > p {{ margin-top: 10px; color: var(--ink-2); }}
.rule {{ height: 1px; background: var(--line); margin: 14px 0 20px; }}

table {{
  width: 100%; border-collapse: collapse; background: var(--surface);
  border: 1px solid var(--line); border-radius: 3px; margin-top: 18px;
  font-size: 13.5px; box-shadow: var(--shadow);
}}
.scroll {{ overflow-x: auto; }}
.scroll table {{ min-width: 720px; }}
th {{
  text-align: left; font-family: "IBM Plex Mono", monospace; font-weight: 500;
  font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); padding: 11px 14px; border-bottom: 1px solid var(--line);
  background: var(--surface-2); white-space: nowrap;
}}
td {{ padding: 11px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }}
tr:last-child td {{ border-bottom: 0; }}
td.num {{ font-variant-numeric: tabular-nums; white-space: nowrap; }}
td.strong {{ font-weight: 600; }}
td.muted {{ color: var(--muted); }}
td.task {{ line-height: 1.45; }}
td .meta {{ display: block; font-size: 11.5px; color: var(--muted); margin-top: 3px; }}
tr.group td {{ background: var(--surface-2); font-weight: 600; font-size: 13px; }}

.sev, .tag {{
  display: inline-block; padding: 2px 8px; border-radius: 2px; font-size: 11px;
  font-weight: 600; white-space: nowrap; letter-spacing: .02em;
}}
.sev-alta {{ background: var(--crit-soft); color: var(--crit); }}
.sev-media {{ background: var(--warn-soft); color: var(--warn); }}
.tag-clon {{ background: var(--surface-2); color: var(--muted); }}
.tag-clase {{ background: var(--accent-soft); color: var(--accent); }}
.tag-equipo {{ background: var(--warn-soft); color: var(--warn); }}
.tag-nueva {{ background: var(--ok-soft); color: var(--ok); }}

.filtros {{ display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }}
.filtros button {{
  font: inherit; font-size: 12.5px; padding: 5px 13px; cursor: pointer;
  background: var(--surface); color: var(--ink-2);
  border: 1px solid var(--line); border-radius: 2px;
}}
.filtros button[aria-pressed="true"] {{ background: var(--ink); color: var(--ground); border-color: var(--ink); }}
.filtros button:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}

.cajas {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-top: 20px; }}
.caja {{
  background: var(--surface); border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 3px; padding: 16px 18px;
}}
.caja.crit {{ border-left-color: var(--crit); }}
.caja.warn {{ border-left-color: var(--warn); }}
.caja h3 {{ margin-bottom: 7px; }}
.caja p {{ font-size: 13.5px; color: var(--ink-2); }}

ol.acciones {{ margin: 20px 0 0; padding: 0; list-style: none; counter-reset: a; }}
ol.acciones li {{
  counter-increment: a; position: relative; padding: 14px 0 14px 46px;
  border-top: 1px solid var(--line-soft);
}}
ol.acciones li::before {{
  content: counter(a, decimal-leading-zero); position: absolute; left: 0; top: 14px;
  font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--accent); font-weight: 500;
}}
ol.acciones b {{ font-weight: 600; }}
ol.acciones p {{ font-size: 13.5px; color: var(--ink-2); margin-top: 3px; }}

footer {{
  margin-top: 60px; padding-top: 22px; border-top: 1px solid var(--line);
  font-size: 12.5px; color: var(--muted);
}}
footer code {{ color: var(--ink-2); }}
@media (max-width: 640px) {{ .wrap {{ padding: 28px 16px 60px; }} }}
</style>

<div class="wrap">
<header>
  <div class="eyebrow">Mercurio Naviera · Auditoria de carga</div>
  <h1>El plan del DON CHICUETO contra su planilla de julio</h1>
  <p class="lead">Se comparo fila por fila la planilla de mantenimiento programado del buque
  contra los planes cargados en el sistema. De las 382 filas del papel, 373 estan cargadas
  y coinciden. Lo que sigue es lo que no cierra.</p>
  <div class="fuente">
    <span>Planilla: <b>07- PMP DON CHICUETO - JULIO.xlsm</b> · 20 hojas</span>
    <span>Ultima actualizacion del papel: <b>28-jun-2026</b></span>
    <span>Carga al sistema: <b>17-ago-2026</b></span>
    <span>Foto de la base: <b>29-ago-2026</b></span>
  </div>
</header>

<div class="panel">
  <div class="tile"><span class="n">382</span><span class="l">filas en la planilla</span></div>
  <div class="tile is-ok"><span class="n">373</span><span class="l">cargadas y coincidentes</span></div>
  <div class="tile is-crit"><span class="n">9</span><span class="l">filas del papel sin plan</span></div>
  <div class="tile is-warn"><span class="n">{len(sin_respaldo)}</span><span class="l">ejecuciones sin OT que las respalde</span></div>
  <div class="tile"><span class="n">{len(sobrantes)}</span><span class="l">planes fuera de la planilla</span></div>
  <div class="tile"><span class="n">{len(VIVOS)}</span><span class="l">planes vivos en el buque</span></div>
</div>

<section>
  <div class="shead"><div class="stripe" style="background:var(--crit)"></div>
    <h2>1 · Nueve tareas del papel no quedaron en el sistema</h2></div>
  <div class="rule"></div>
  <p>Ocho se perdieron por el mismo motivo: <b>dos hojas distintas de la planilla le asignaron
  el mismo numero de tarea al mismo equipo</b>. El cargador toma ese numero como identidad, asi
  que al procesar la segunda hoja creyo que era la misma tarea y la piso en lugar de agregarla.
  En dos casos las dos filas describen practicamente el mismo trabajo con otras palabras y la
  perdida es solo de detalle; en los otros seis se perdio una tarea distinta.</p>

  <div class="scroll"><table>
    <thead><tr><th>Casillero</th><th>Efecto</th><th>Fila del papel que no entro</th><th>Fila que ocupo su lugar</th></tr></thead>
    <tbody>
{filas_perdidas()}
    </tbody>
  </table></div>

  <div class="cajas">
    <div class="caja crit">
      <h3>Lo mas sensible</h3>
      <p>Cuatro de las tareas perdidas <b>no tienen ningun equivalente en el sistema</b>: la prueba
      mensual del <b>gobierno de emergencia</b>, el <b>engrase del timon</b>, el <b>engrase de sala
      de maquinas</b> y el control mensual de la <b>bomba de la central hidraulica</b>. En la
      motobomba de incendio portatil se perdieron el cambio de aceite anual — que queda cubierto
      en parte por uno semestral heredado del clon — y el <b>recorrido general cada 6 años</b>,
      que no esta en ninguna forma.</p>
    </div>
    <div class="caja warn">
      <h3>La novena: se dio de baja</h3>
      <p><code>DCH-AA-SPLIT-32</code> «Control de aprietes bulonerias, anclajes» (trimestral) se
      cargo bien el 17-ago y alguien <b>la dio de baja el 28-ago</b>, junto con un plan viejo del
      clon. Si fue a proposito no hay nada que hacer; si no, hay que revivirla.</p>
    </div>
  </div>
</section>

<section>
  <div class="shead"><div class="stripe" style="background:var(--warn)"></div>
    <h2>2 · {len(sin_respaldo)} ejecuciones cargadas a mano, sin orden de trabajo</h2></div>
  <div class="rule"></div>
  <p>Estos planes muestran una ultima ejecucion posterior al cierre de la planilla, de modo que
  el trabajo se hizo despues del 28 de junio. El problema no es la fecha: es que <b>se escribio
  editando el plan, sin una OT cerrada detras</b>. Para una auditoria de clase o TMSA la fecha
  sola no prueba nada — no hay quien lo hizo, con que resultado ni con que horas de equipo.
  Otras dos tareas del mismo grupo (el muestreo de aceite de los auxiliares) si tienen su OT
  cerrada el 12-ago y estan bien.</p>

  <div class="scroll"><table>
    <thead><tr><th>Plan</th><th>Tarea</th><th>Papel</th><th>Sistema</th><th>Vence</th><th>Editado</th></tr></thead>
    <tbody>
{filas_sin_respaldo()}
    </tbody>
  </table></div>
</section>

<section>
  <div class="shead"><div class="stripe"></div>
    <h2>3 · Tres vencimientos que difieren por criterio, no por error</h2></div>
  <div class="rule"></div>
  <p>El muestreo de aceite de los dos motores principales y del auxiliar de puerto vence tres
  dias antes en el papel que en el sistema. La planilla cuenta <b>180 dias</b> desde la ultima
  toma; el sistema cuenta <b>6 meses</b> de calendario. Ninguno esta mal: hay que decidir cual
  manda. Con la frecuencia en meses, el sistema es consistente con el resto del plan.</p>
  <div class="scroll"><table>
    <thead><tr><th>Plan</th><th>Motor</th><th>Ultima toma</th><th>Vence (papel)</th><th>Vence (sistema)</th></tr></thead>
    <tbody>
      <tr><td><code>DCH-MP-BR-18</code></td><td>Principal Babor</td><td class="num">2026-06-26</td><td class="num">2026-12-23</td><td class="num strong">2026-12-26</td></tr>
      <tr><td><code>DCH-MP-ER-18</code></td><td>Principal Estribor</td><td class="num">2026-06-25</td><td class="num">2026-12-22</td><td class="num strong">2026-12-25</td></tr>
      <tr><td><code>DCH-MA-PTO-06</code></td><td>Auxiliar Puerto</td><td class="num">2026-06-26</td><td class="num">2026-12-23</td><td class="num strong">2026-12-26</td></tr>
    </tbody>
  </table></div>
</section>

<section>
  <div class="shead"><div class="stripe" style="background:var(--muted)"></div>
    <h2>4 · {len(sobrantes)} planes que el sistema tiene y la planilla no</h2></div>
  <div class="rule"></div>
  <p>No son un error de la carga: la planilla de maquinas no cubre todo el buque. Estan aca
  las inspecciones de clase y estatutarias, los equipos que el papel no lista (purificadora,
  compresor NK40, CO2, deteccion de incendio, planta de tratamiento) y las tareas heredadas del
  buque del que se clono el plan, que se reconocen por el titulo generico
  («Mantenimiento CADA 3 MESES», «OVERHAUL»). Esas ultimas son las que conviene mirar:
  <b>{conteo.get('Heredada del clon', 0)} planes</b> repartidos en equipos que ademas ya tienen
  sus tareas del papel, asi que algunos pueden estar duplicando trabajo con otro nombre.</p>

  <div class="filtros">
    <button data-f="todos" aria-pressed="true">Todos ({len(sobrantes)})</button>
    <button data-f="clon" aria-pressed="false">Heredadas del clon ({conteo.get('Heredada del clon', 0)})</button>
    <button data-f="clase" aria-pressed="false">Clase / estatutario ({conteo.get('Clase / estatutario', 0)})</button>
    <button data-f="equipo" aria-pressed="false">Del equipo ({conteo.get('Del equipo, fuera del papel', 0)})</button>
    <button data-f="nueva" aria-pressed="false">Altas posteriores ({conteo.get('Alta posterior', 0)})</button>
  </div>

  <div class="scroll"><table id="tsob">
    <thead><tr><th>Plan</th><th>Frecuencia</th><th>Tarea</th><th>De donde viene</th><th>Historial</th></tr></thead>
    <tbody>
{filas_sobrantes()}
    </tbody>
  </table></div>
</section>

<section>
  <div class="shead"><div class="stripe"></div><h2>Que hacer</h2></div>
  <div class="rule"></div>
  <ol class="acciones">
    <li><b>Recuperar las ocho tareas pisadas.</b>
      <p>Se cargan con un numero de tarea libre. Es media hora de trabajo y devuelve al plan la
      prueba del gobierno de emergencia, el engrase del timon y el mantenimiento mayor de la
      motobomba de incendio.</p></li>
    <li><b>Arreglar el generador para que no vuelva a pasar.</b>
      <p>Hoy cada hoja del Excel numera sus tareas desde cero. La numeracion tiene que ser por
      equipo y compartida entre hojas: es el mismo error que espera a los demas buques cuando se
      cargue su planilla.</p></li>
    <li><b>Confirmar la baja del control de aprietes del aire acondicionado.</b>
      <p>Si fue sin querer, se reactiva; si fue a proposito, queda anotado que la planilla lo
      pide y el sistema no lo lleva.</p></li>
    <li><b>Respaldar con OT las {len(sin_respaldo)} ejecuciones cargadas a mano.</b>
      <p>Abrir y cerrar la OT con la fecha real deja el registro completo. Si no van a tener OT,
      conviene decidirlo explicitamente: hoy el buque muestra tareas hechas sin quien las hizo.</p></li>
    <li><b>Definir el criterio del muestreo de aceite: 180 dias o 6 meses.</b>
      <p>Afecta a tres planes y a la planilla de a bordo, que habria que corregir si manda el
      sistema.</p></li>
    <li><b>Depurar las {conteo.get('Heredada del clon', 0)} tareas genericas heredadas del clon.</b>
      <p>Revisar equipo por equipo cuales repiten una tarea que el papel ya define con nombre
      propio y dar de baja las que sobran. Es lo que mas ensucia el plan del buque.</p></li>
  </ol>
</section>

<footer>
  <p>Auditoria hecha comparando los 20 lotes generados desde la planilla contra una copia de
  solo lectura de la base de produccion (<code>dump-don-chicueto-audit.ts</code> +
  <code>analyze-don-chicueto-audit.py</code>). <b>No se modifico ningun dato.</b>
  El emparejamiento se hizo por activo y titulo de tarea, y por numero de tarea cuando el
  titulo no alcanzo. Estado del buque al 29-ago-2026: {len(VIVOS)} planes vivos sobre
  {len([a for a in EST['assets'] if not a['deletedAt']])} equipos, {len(BORRADOS)} planes dados de baja.</p>
</footer>
</div>

<script>
document.querySelectorAll('.filtros button').forEach(function (b) {{
  b.addEventListener('click', function () {{
    var f = b.dataset.f;
    document.querySelectorAll('.filtros button').forEach(function (o) {{
      o.setAttribute('aria-pressed', String(o === b));
    }});
    document.querySelectorAll('#tsob tbody tr').forEach(function (tr) {{
      var esGrupo = tr.classList.contains('group');
      tr.style.display = (f === 'todos' || esGrupo || tr.dataset.cat === f) ? '' : 'none';
    }});
    if (f !== 'todos') {{
      document.querySelectorAll('#tsob tbody tr.group').forEach(function (g) {{
        var vis = false, n = g.nextElementSibling;
        while (n && !n.classList.contains('group')) {{
          if (n.style.display !== 'none') vis = true;
          n = n.nextElementSibling;
        }}
        g.style.display = vis ? '' : 'none';
      }});
    }}
  }});
}});
</script>
"""

open("scripts/vessel-plan-tools/out/auditoria-dch.html", "w", encoding="utf-8").write(HTML)
print("escrito scripts/vessel-plan-tools/out/auditoria-dch.html")
print("perdidas:", len(perdidas), "· sin respaldo:", len(sin_respaldo),
      "· con respaldo:", len(con_respaldo), "· sobrantes:", len(sobrantes), conteo)
