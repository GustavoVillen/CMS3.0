# UI/UX y Design System

## 1. Sistema de diseño
El sistema visual está definido principalmente en `Styles.html` y reforzado por estilos inline en `index.html` y `Script.html`.

## 2. Tipografías
### Principal
- `Inter` desde Google Fonts.

### Secundaria / fallback
- en `Login.html` se observa fallback a `Segoe UI`, `Tahoma`, `sans-serif`.

### Criterio visual
- lectura técnica, moderna y compacta;
- buen peso para títulos y badges;
- apropiado para dashboards y tablas densas.

## 3. Paleta de colores
### Tokens principales observados
| Token | Color | Uso |
|---|---|---|
| `--bg-main` | `#050a11` | fondo principal |
| `--bg-panel` | `#0a111e` | sidebar / paneles |
| `--bg-card` | `#101c30` | tarjetas y contenedores |
| `--text-main` | `#f8fafc` | texto principal |
| `--text-muted` | `#94a3b8` | texto secundario |
| `--accent-cyan` | `#06b6d4` | color marca / foco |
| `--accent-blue` | `#3b82f6` | identidad dashboard |
| `--accent-green` | `#10b981` | estados ok |
| `--accent-yellow` | `#f59e0b` | alertas / espera |
| `--accent-red` | `#ef4444` | fallas / vencidos |
| `--accent-orange` | `#f97316` | énfasis operativo |

## 4. Iconografía
- `Material Symbols Outlined`.
- uso intensivo de iconos semánticos:
  - `inventory_2`
  - `event_note`
  - `schedule`
  - `report`
  - `search_insights`
  - `security`
  - `verified`

## 5. Estilo visual
### Rasgos principales
- estética dark mode por defecto;
- lenguaje visual técnico/industrial;
- paneles con bordes suaves y brillo controlado;
- mezcla de acentos cyan/naranja/rojo/verde;
- uso de badges, dots y semáforos para estados.

### Efecto general
Transmite una herramienta operacional más cercana a un centro de control que a una app administrativa genérica.

## 6. Principios de usabilidad identificables
- acceso rápido a módulos críticos desde dashboard;
- priorización visual por estado;
- filtros cercanos al dato;
- conservación de contexto mediante modales;
- generación documental sin salir del flujo.

## 7. Componentes visuales principales
| Componente | Característica |
|---|---|
| `sidebar-mini` | navegación compacta |
| `chart-card` | KPI de dashboard |
| `snapshot-card` | resumen operacional |
| `data-table` | tablas densas con acciones |
| `table-badge` | estado visual |
| `modal` | edición/alta contextual |
| `btn-primary` | acción principal |
| `btn-outline` / `btn-cyan-outline` | acción secundaria |
| `btn-icon-subtle` | acción ligera contextual |

## 8. Consistencia gráfica
### Fortalezas
- lenguaje de color consistente;
- tipografía homogénea;
- iconografía coherente;
- buena identidad visual.

### Debilidades
- demasiados estilos inline;
- diferencias sutiles entre algunos modales;
- presencia de UI legacy dentro del mismo sistema.

## 9. Responsive UX
### Buenas prácticas presentes
- reflujo de layout a móvil;
- scroll horizontal de tablas;
- adaptación de modal;
- ocultamiento de componentes no esenciales.

### Limitaciones
- tablas muy anchas para operación intensiva móvil;
- algunos formularios mantienen alta densidad visual.

## 10. Evaluación UX por módulo
| Módulo | UX actual | Comentario |
|---|---|---|
| Dashboard | Buena | clara entrada al sistema |
| Flota/Inventario | Buena | estructura operativa sólida |
| Plan mantenimiento | Media | mucha densidad y reglas cruzadas |
| OT | Media-Alta | potente, pero extensa |
| Defectos | Alta | muy buen flujo contextual |
| Inspecciones | Alta | clara separación plan/log |
| Daily report | Media-Alta | profundo, pero complejo |

## 11. Recomendaciones de diseño para evolución
- reducir estilos inline y consolidarlos en tokens/componentes;
- introducir layout por secciones plegables más consistente;
- reemplazar `alert/confirm` por modales de confirmación nativos del sistema;
- distinguir visualmente estados canónicos vs estados visibles;
- simplificar formularios largos con pasos o agrupación progresiva.

## 12. Recomendación para Antigravity
Mantener:

- tema oscuro y visual técnico;
- semaforización de backlog;
- cards operacionales;
- identidad `Mercurio/GPMS`.

Rediseñar:

- modularidad de componentes;
- accesibilidad;
- consistencia móvil;
- sistema de feedback y confirmaciones.
