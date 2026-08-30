---
name: pms-pdf-generation
description: Reglas obligatorias al generar PDFs en el PMS. Evita el bug recurrente de "texto que se sale del badge gris al pasar de página" y unifica el patrón de renderizado de secciones de texto con label.
disable-model-invocation: false
model: inherit
---

# PMS PDF Generation — patrón obligatorio

Cuando trabajes en cualquier servicio `*-pdf-service.ts` (o crees uno nuevo) en `apps/api/src/tenant/**`, seguí estas reglas. El motivo: ya nos pasó (MOC) que un rectángulo de fondo se dibujaba una vez con altura limitada al espacio disponible, mientras pdfkit autopaginaba el texto. Resultado: la continuación del texto quedaba flotando sobre fondo blanco. **No volver a corregir esto.**

## 1. Nunca rolés tu propio renderizado multi-página de texto en cajas

Si vas a renderizar **una sección con label + caja de fondo + texto libre que puede ocupar más de una página**:

> **OBLIGATORIO:** usar `renderLabeledTextBox(doc, opts)` de [pdf-helpers.ts](apps/api/src/tenant/pms/pdf-helpers.ts).

Está hecho para esto. Internamente:
- pre-mide cada línea lógica con `heightOfString`
- arma chunks que entran en cada página
- dibuja la caja con la altura **exacta del chunk**
- redibuja la caja en cada página siguiente, con label `(CONT.)`
- soporta opcionalmente `**bold**` markdown inline (`markdown: true`)

```ts
import { renderLabeledTextBox } from "../pms/pdf-helpers";

y = renderLabeledTextBox(doc, {
  label: "Análisis de Riesgo",
  text: moc.riskAssessmentNotes ?? "",
  x: ML,
  y,
  width: W,
  pageBottom: CONTENT_BOTTOM,
  pageTop: MARGIN_V,
  // estilo (todos opcionales)
  labelPosition: "above",       // o "inside"
  fontSize: 9,
  bg: "#f8fafc",
  border: "#e2e8f0",
  // markdown opcional
  markdown: true,
});
```

`y` queda actualizado a la posición tras la última caja + `sectionGap`. No agregues `y += boxH` después.

## 2. Si no tenés label y solo necesitas partir el texto

Usá `splitTextIntoPageSegments(...)` (también en `pdf-helpers.ts`). El patrón estándar está en [deferral-pdf-service.ts](apps/api/src/tenant/pms/deferral-pdf-service.ts) (`textBlock` interno). **No copies ni reinventes esa lógica** — si necesitás el patrón completo, llamá `renderLabeledTextBox`.

## 3. Sanitización

- Usá `sanitizePdfText(text)` antes de pasar cualquier texto user/AI a `doc.text(...)`. Helvetica solo soporta WinAnsi; texto no sanitizado causa caracteres garbled.
- Si vas a usar `**bold**` markdown inline (vía `renderLabeledTextBox({ markdown: true })`), `sanitizePdfText(t, { keepMarkdown: true })` los preserva.

## 4. Antipatrones prohibidos

Si ves algo así en un PDF service, está mal:

```ts
// ❌ MAL — texto puede salirse de la caja si excede una página
const boxH = padding * 2 + heightOfString(text, { width });
doc.roundedRect(ML, y, W, boxH).fill(bg);
doc.text(text, ML + padding, y + padding, { width });
y += boxH;
```

Reemplazar SIEMPRE por `renderLabeledTextBox`. La excepción son cajas con valor **garantizadamente de una línea** (estado, fechas, badges chicos) — esas pueden usar `roundedRect` + `doc.text` directo.

## 5. Cuando agregues un nuevo PDF

Checklist antes de cerrar la tarea:

- [ ] Toda sección con texto libre (descripción, justificación, notas, análisis, observaciones, conclusiones) usa `renderLabeledTextBox`.
- [ ] Todo texto user/AI pasa por `sanitizePdfText`.
- [ ] No hay un `roundedRect(...)` seguido de `doc.text(...)` para texto que puede exceder una página.
- [ ] Probado con un caso de texto largo (>1 página) que el badge gris siga atrás en TODAS las páginas.
- [ ] Logo del tenant via `resolveTenantLogo(slug, ...)` (no fetch HTTP, prohibido por SSRF).

## 6. Lecturas de referencia

- Helper: [apps/api/src/tenant/pms/pdf-helpers.ts](apps/api/src/tenant/pms/pdf-helpers.ts)
- Caso correcto con label `inside` + multi-página: [apps/api/src/tenant/pms/deferral-pdf-service.ts](apps/api/src/tenant/pms/deferral-pdf-service.ts) (`textBlock`)
- Caso correcto con label `above` + markdown: [apps/api/src/tenant/moc/moc-pdf-service.ts](apps/api/src/tenant/moc/moc-pdf-service.ts) (`textSection`)
