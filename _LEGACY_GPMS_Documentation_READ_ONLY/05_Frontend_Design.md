# Diseño Frontend del GPMS

## 1. Enfoque general
El frontend es una SPA ligera servida por Google Apps Script. Está construido con HTML, CSS y JavaScript vanilla, sin framework formal. Toda la interfaz se apoya en render imperativo, variables globales y modales reutilizables.

## 2. Archivos principales
| Archivo | Rol |
|---|---|
| `index.html` | Layout principal y contenedor de vistas |
| `Login.html` | Pantalla de autenticación standalone |
| `Script.html` | Lógica cliente, estado, render, modales, llamadas al servidor |
| `Styles.html` | Sistema visual, layout, componentes, responsive |

## 3. Estructura de pantalla
### 3.1 Layout principal
`index.html` define una estructura `app-layout` compuesta por:

- `sidebar-mini`: navegación lateral compacta.
- `dashboard-main`: cabecera + contenido.
- overlays modales fuera del flujo principal.

### 3.2 Navegación visible
- Inicio.
- Flota.
- Recorrido.
- Asistente IA.
- botón de ajustes visual.

El resto de módulos se accede desde el dashboard y grillas internas, no desde una barra lateral extensa.

## 4. Pantallas del sistema
### Principales vistas renderizadas
- Dashboard principal.
- Flota.
- Recorrido de embarcación.
- Inventario SFI.
- Repuestos críticos.
- Pedidos de repuestos.
- Plan de mantenimiento.
- Órdenes de trabajo.
- Plan y registros de inspecciones.
- Defectos.
- RCA.
- CAPA.
- Diferimientos / backlog.
- Certificados.
- Reportes diarios.
- Proveedores, evaluación y no conformidades.

## 5. Componentes UI clave
### 5.1 Dashboard
- cards KPI tipo pie chart simulados/dinámicos;
- snapshots operativos;
- grilla de módulos cargada con `getModulesConfig()`.

### 5.2 Tablas
- construcción dinámica por módulo;
- filtros por embarcación, estado y SFI;
- badges de estado;
- acciones inline por fila.

### 5.3 Modal genérico
`openGeneralModal(rowIndex, mode, prefilledData)` es el componente central de edición/alta.

Soporta múltiples modos:

- `FLOTA`
- `INVENTARIO`
- `SPARES`
- `SPARE_ORDERS`
- `INSPECTIONS`
- `CAPA_LOG`
- `RCA_LOG`
- `DEFECT_LOG`
- `WORK_ORDERS`
- `MAINTENANCE_PLAN`
- `CERTIFICATES`
- `DEFERRALS`

### 5.4 Overlays especializados
- `login-overlay`
- modal de reporte diario detallado
- `pdf-preview-overlay`
- `ai-modal-overlay`
- `barrier-modal-overlay`
- wizard dinámico RCA

## 6. Patrón de interacción
### 6.1 Estado global
`Script.html` mantiene muchos estados globales, por ejemplo:

- `currentVesselsData`
- `currentInventoryData`
- `currentMaintenancePlanData`
- `currentWorkOrdersData`
- `currentDefectData`
- `currentDeferralsData`
- `currentDailyData`
- `currentInspectionsData`

### 6.2 Carga de datos
Patrones usados:

- `cachedRun(method, args, ttl)` para lecturas;
- `google.script.run` directo para mutaciones;
- `clearCache()` tras operaciones que alteran datos.

### 6.3 Feedback al usuario
- `showToast()` para feedback rápido;
- overlays de carga con ícono `sync`;
- algunos `alert`/`confirm` todavía persistentes.

## 7. Experiencia de usuario (UX)
### Fortalezas observadas
- fuerte orientación operativa;
- indicadores por color y badges;
- acceso directo a acciones desde tablas;
- generación inmediata de PDF y adjuntos;
- uso intensivo de modales para no perder contexto;
- IA incrustada en momentos de decisión, no solo como chat lateral.

### Debilidades observadas
- alta densidad visual en algunas tablas;
- exceso de lógica inline y `onclick` embebido;
- presencia de `alert/confirm` en flujos críticos;
- estados globales compartidos que pueden generar efectos laterales.

## 8. Identidad visual
### Tipografía
- `Inter` como fuente principal.
- `Material Symbols Outlined` como iconografía.

### Estilo
- tema oscuro técnico-industrial;
- acentos cyan, azul, naranja, verde, rojo;
- paneles con gradientes suaves y bordes brillantes;
- badges y tags muy visibles.

## 9. Responsive design
### Breakpoints observados
- `768px`
- `480px`

### Comportamientos móviles
- sidebar pasa a comportamiento compacto;
- grids se vuelven de una columna;
- tablas ganan scroll horizontal;
- modales se adaptan al ancho de viewport;
- `field-guide-bar` se oculta en móvil.

## 10. Archivos específicos
### 10.1 `index.html`
- inyecta contexto del usuario;
- carga `Styles` y `Script`;
- importa Google API y Leaflet;
- define layout principal y contenedores de vistas.

### 10.2 `Login.html`
- login minimalista independiente;
- mensaje explícito sobre tabla `_USERS`;
- útil como fallback o acceso directo.

### 10.3 `Script.html`
- contiene la mayor parte del comportamiento del frontend;
- arrays de definición de campos;
- render de tablas;
- modales;
- lógica de autenticación cliente;
- integración con Drive Picker y con IA.

### 10.4 `Styles.html`
- tokens visuales en `:root`;
- layout base;
- utilidades y componentes reutilizables;
- reglas responsive.

## 11. Riesgos de diseño actuales
- frontend monolítico;
- bajo encapsulamiento por módulo;
- alta dependencia de `innerHTML`;
- separación limitada entre presentación y lógica;
- sanitización manual y no homogénea.

## 12. Recomendaciones para reimplementación
- modularizar UI por dominio;
- reemplazar render string-based por componentes declarativos;
- centralizar estado y servicios;
- estandarizar feedback visual con modales/toasts propios;
- mantener el lenguaje visual oscuro y técnico, pero con menos densidad por pantalla.
