# -*- coding: utf-8 -*-
"""Hoja de estilo compartida por los informes de estado de los planes.

Neutros frios con acento de minio de casco; rotulo condensado para titulos,
serif para el cuerpo y monoespaciada para codigos, horas y fechas.
"""

CSS = """
:root{
  --paper:#F6F7F5; --surface:#FFFFFF; --ink:#14202A; --ink-2:#4A5A66;
  --accent:#B0521C; --accent-soft:#F0E2D8;
  --ok:#2E6A4E; --warn:#8A6410; --crit:#A02C28;
  --rule:#CDD5D1; --rule-soft:#E4E9E6;
  --shadow:0 1px 2px rgba(20,32,42,.06);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --paper:#0E161E; --surface:#16212B; --ink:#E3EAE6; --ink-2:#9BAAB3;
    --accent:#DC8049; --accent-soft:#2C2018;
    --ok:#69B08C; --warn:#D2A445; --crit:#E0736C;
    --rule:#2A3945; --rule-soft:#1D2A35;
    --shadow:0 1px 2px rgba(0,0,0,.4);
  }
}
:root[data-theme="dark"]{
  --paper:#0E161E; --surface:#16212B; --ink:#E3EAE6; --ink-2:#9BAAB3;
  --accent:#DC8049; --accent-soft:#2C2018;
  --ok:#69B08C; --warn:#D2A445; --crit:#E0736C;
  --rule:#2A3945; --rule-soft:#1D2A35;
  --shadow:0 1px 2px rgba(0,0,0,.4);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:ui-serif,Georgia,"Iowan Old Style","Times New Roman",serif;
  font-size:16.5px; line-height:1.65;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:62rem; margin:0 auto; padding:0 1.5rem 6rem}
.disp{
  font-family:"Arial Narrow","Helvetica Neue",Helvetica,ui-sans-serif,sans-serif;
  font-weight:700; letter-spacing:-.01em; text-wrap:balance;
}
.mono{font-family:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;
  font-size:.84em; font-variant-numeric:tabular-nums}
.dim{color:var(--ink-2)}

/* carátula */
header{border-bottom:3px solid var(--ink); padding:3.5rem 0 1.25rem; margin-bottom:2.5rem}
.eyebrow{
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  font-size:.72rem; letter-spacing:.16em; text-transform:uppercase;
  color:var(--accent); margin:0 0 .75rem;
}
h1{font-size:clamp(2.4rem,6vw,3.9rem); line-height:1.02; margin:0 0 1.25rem}
h1 .sub{display:block; font-size:.42em; font-weight:400; color:var(--ink-2);
  letter-spacing:.02em; margin-top:.5rem}
.meta{display:flex; flex-wrap:wrap; gap:.35rem 2.5rem; padding-top:.75rem;
  border-top:1px solid var(--rule-soft)}
.meta div{display:flex; gap:.6rem; align-items:baseline}
.meta dt{font-family:ui-monospace,Menlo,monospace; font-size:.68rem;
  letter-spacing:.1em; text-transform:uppercase; color:var(--ink-2); margin:0}
.meta dd{margin:0; font-size:.92rem}

/* cifras */
.tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));
  gap:1px; background:var(--rule); border:1px solid var(--rule);
  margin:0 0 3rem; box-shadow:var(--shadow)}
.tile{background:var(--surface); padding:1.1rem 1rem; display:flex; flex-direction:column; gap:.15rem}
.tile .num{font-family:"Arial Narrow","Helvetica Neue",sans-serif; font-weight:700;
  font-size:2.1rem; line-height:1; font-variant-numeric:tabular-nums}
.tile .lbl{font-size:.78rem; color:var(--ink-2); line-height:1.35}
.t-accent .num{color:var(--accent)} .t-ok .num{color:var(--ok)}
.t-crit .num{color:var(--crit)} .t-warn .num{color:var(--warn)}

section{margin:0 0 3.25rem}
h2{font-size:1.5rem; margin:0 0 .35rem; padding-top:1.25rem; border-top:1px solid var(--rule)}
h2 + .lead{margin:0 0 1.25rem; color:var(--ink-2); max-width:62ch}
h3{font-size:1.02rem; margin:2rem 0 .5rem; font-family:"Arial Narrow","Helvetica Neue",sans-serif;
  letter-spacing:.02em; text-transform:uppercase; color:var(--ink-2)}
p{max-width:68ch}

.scroll{overflow-x:auto; border:1px solid var(--rule); background:var(--surface);
  box-shadow:var(--shadow)}
table{border-collapse:collapse; width:100%; font-size:.93rem}
th,td{text-align:left; padding:.55rem .85rem; border-bottom:1px solid var(--rule-soft);
  vertical-align:top}
th{font-family:"Arial Narrow","Helvetica Neue",sans-serif; font-weight:700;
  font-size:.76rem; letter-spacing:.09em; text-transform:uppercase;
  color:var(--ink-2); border-bottom:1px solid var(--rule); white-space:nowrap}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right; font-variant-numeric:tabular-nums;
  font-family:ui-monospace,Menlo,monospace; font-size:.86rem}

.chip{display:inline-block; font-family:ui-monospace,Menlo,monospace; font-size:.66rem;
  letter-spacing:.06em; text-transform:uppercase; padding:.1rem .4rem;
  border:1px solid currentColor; border-radius:2px; vertical-align:middle}
.chip-warn{color:var(--warn)}

.callout{border-left:3px solid var(--accent); background:var(--accent-soft);
  padding:1rem 1.25rem; margin:1.5rem 0}
.callout p{margin:0; max-width:64ch}
.callout p + p{margin-top:.6rem}

details{border:1px solid var(--rule); background:var(--surface); margin-bottom:.5rem}
summary{cursor:pointer; padding:.65rem .9rem;
  font-family:"Arial Narrow","Helvetica Neue",sans-serif; font-weight:700;
  font-size:.95rem; display:flex; justify-content:space-between; gap:1rem; align-items:center}
summary:hover{background:var(--rule-soft)}
summary:focus-visible{outline:2px solid var(--accent); outline-offset:-2px}
.cnt{font-family:ui-monospace,Menlo,monospace; font-size:.78rem; color:var(--ink-2);
  border:1px solid var(--rule); padding:0 .35rem; border-radius:2px}
ul.notas{margin:0; padding:.25rem 1.25rem 1rem 2.25rem; font-size:.9rem}
ul.notas li{margin-bottom:.6rem}

ol.pend{max-width:68ch; padding-left:1.3rem}
ol.pend li{margin-bottom:1rem}
ol.pend b{font-family:"Arial Narrow","Helvetica Neue",sans-serif; letter-spacing:.01em}

footer{border-top:1px solid var(--rule); padding-top:1.25rem; color:var(--ink-2); font-size:.85rem}
@media (prefers-reduced-motion:reduce){*{animation:none!important; transition:none!important}}
"""
