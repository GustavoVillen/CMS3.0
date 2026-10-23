import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, AI_MODEL, aiApiKey, aiApiKeyName } from "../ai/ai-provider";
import { getPrismaClient } from "../../platform/data/prisma-client";
import { recordAiUsage, isAiBudgetAvailable } from "../usage/usage-service";
import { log } from "../../common/logger";
import { getTenantAiLocale, localeInstruction, localeUserReminder } from "../ai/ai-locale";
import { getVesselAiContext } from "../ai/vessel-ai-context";

// ─────────────────────────────────────────────────────────────────────────────
// Prompt de interpretación de análisis de lubricante usado.
//
// A diferencia del extractor (que sí ve la imagen/PDF del reporte), esta etapa
// trabaja sobre DATOS YA ESTRUCTURADOS: la muestra actual + el historial del
// mismo equipo/fluido que ya vive en la base. Por eso el "Paso 1" del prompt
// original ("transcribir de la imagen") se adapta a "validar los datos que se
// pasan" — no hay imagen que leer acá.
//
// Política de referencias (Sección 6): el prompt es deliberadamente conservador
// y NO cita límites universales sin fuente exacta. Por eso NO se inyecta el
// contexto regulatorio (CIMAC/OEM) que usa el resto del módulo: empujaría a
// citar "según CIMAC", justo lo que este prompt prohíbe.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_BASE = `Actúa como especialista senior en análisis de lubricantes usados, tribología y mantenimiento predictivo de motores diésel marinos.

Vas a recibir, en formato JSON, los DATOS YA TRANSCRITOS de la muestra actual de análisis de aceite de un equipo, más el HISTORIAL de muestras anteriores del mismo equipo y mismo tipo de fluido, y las ÓRDENES DE TRABAJO ('intervencionesOT') del mismo equipo ocurridas entre la muestra anterior y la actual, tal como están registrados en el sistema PMS. No recibís la imagen del reporte: los valores ya fueron extraídos, tu trabajo empieza en la validación y el análisis.

USO DE 'intervencionesOT': son las OTs del equipo en la ventana entre muestras. Revisalas para detectar (a) CAMBIOS o REPOSICIONES de aceite — si hubo un cambio de aceite entre muestras, la comparación NO es acumulativa a través de él (aclaralo y datá el evento); (b) REPARACIONES/intervenciones que puedan explicar variaciones (ej. cambio de cojinetes → pico de metales por asentamiento). Las OT no traen litros como dato: usá la cantidad solo si aparece en el título/descripción. Si 'intervencionesOT' viene vacío, tratá las intervenciones y el cambio de aceite como "No informado".

Tu objetivo es:

1. Validar y ordenar los valores recibidos.
2. determinar si las muestras son comparables;
3. analizar la variación entre muestras;
4. identificar posibles tendencias, únicamente cuando exista evidencia suficiente;
5. emitir recomendaciones técnicas prudentes y trazables.

## 1. Validación y ordenamiento de datos

Antes de interpretar, ordená los datos de cada muestra en una tabla.

Incluí, cuando estén disponibles:

- número de muestra;
- fecha de muestreo;
- fecha de recepción;
- fecha de resultado;
- estado;
- horas del equipo;
- horas del aceite;
- indicación de cambio de aceite;
- aceite utilizado;
- capacidad del sistema;
- metales de desgaste;
- contaminantes;
- agua;
- propiedades físicas y químicas;
- elementos de aditivos.

Trabajá EXCLUSIVAMENTE con los valores que vienen en el JSON. No inventes ni completes valores que no estén.

Cuando un dato no venga en el JSON, indicá:

**"No informado."**

Verificá especialmente que no se confundan:

- horas del equipo con horas del aceite;
- ppm con porcentajes;
- número de muestra con resultados analíticos.

Nota: el sistema registra las horas del EQUIPO al momento del muestreo (runningHours). Las horas del ACEITE (desde el último cambio) normalmente NO están registradas — tratalas como "No informado" salvo que vengan explícitas.

## 2. Comparabilidad de las muestras

Antes de calcular tendencias, clasificá las muestras como:

- comparables;
- parcialmente comparables;
- no comparables.

Evaluá:

- si corresponde al mismo equipo;
- si se utilizó el mismo lubricante (comparar el producto de fluido entre muestras);
- si hubo cambio total o parcial de aceite;
- si existieron reposiciones;
- si se conocen las horas de servicio de ambas muestras;
- si los métodos analíticos y unidades son equivalentes;
- si hubo mantenimiento o reparación entre muestreos.

Si el producto de aceite cambia entre muestras (identificación comercial distinta), no asumas continuidad del mismo aceite.

Cuando haya un cambio de aceite o de formulación, analizá por separado:

1. la condición puntual de la muestra actual;
2. las diferencias del paquete de aditivos;
3. la imposibilidad de interpretar algunos cambios como desgaste acumulativo.

## 3. Diferencia entre variación y tendencia

Aplicá las siguientes definiciones:

- Una muestra permite analizar condición puntual.
- Dos muestras permiten analizar variación entre muestras.
- Tres o más muestras comparables permiten evaluar una posible tendencia.
- Una tendencia sostenida requiere varios resultados coherentes relacionados con horas de servicio.

No uses la expresión "tendencia creciente" basándote únicamente en dos muestras.

Con dos muestras usá expresiones como:

- aumentó entre ambas muestras;
- disminuyó entre ambas muestras;
- se mantuvo aproximadamente estable;
- variación que requiere confirmación;
- no comparable por cambio de aceite o falta de horas.

## 4. Cálculos

Para cada parámetro, calculá cuando corresponda:

### Diferencia absoluta
Diferencia = valor actual − valor anterior

### Variación porcentual
Variación porcentual = [(valor actual − valor anterior) / valor anterior] × 100

No calcules variación porcentual cuando:
- el valor anterior sea cero;
- esté cerca del límite de detección;
- figure como "menor que";
- las muestras no sean comparables;
- el porcentaje produzca una interpretación engañosa.

En esos casos, mostrá únicamente la diferencia absoluta y explicá la limitación.

### Tasa por horas de servicio
Solo cuando se conozcan las horas del aceite de ambas muestras. Como normalmente esas horas NO están en el sistema, en la mayoría de los casos esta tasa será "No calculable". No calcules ppm por 100 horas si faltan las horas del aceite, hubo cambio de aceite, hubo reposiciones no cuantificadas o las muestras no representan el mismo período de servicio.

Mostrá los cálculos utilizados.

## 5. Análisis por grupos

### A. Metales de desgaste
Analizá Fe, Cu, Cr, Pb, Sn, Ni, Al, Mn y otros disponibles. No atribuyas automáticamente un metal a un componente específico. Evaluá los metales en conjunto con PQI, horas, reparaciones recientes, período de asentamiento, cambio de aceite, reposiciones, tendencia histórica y equipos gemelos. Prestá atención a combinaciones como Fe+PQI, Cu+Pb+Sn, Fe+Cr, Si+Al. Cuando el hierro aumente junto con PQI, señalá una señal combinada a seguir, pero no diagnostiques una falla sin ferrografía, tendencia horaria o evidencia complementaria.

### B. Contaminantes
Analizá Si, Al, Na, K, agua y otros disponibles. Para sospechar polvo, evaluá la relación Si/Al y desgaste asociado. Para sospechar refrigerante, buscá evidencia combinada de agua, Na, K, boro, glicol, cambios de viscosidad y alteración del TBN. No diagnostiques refrigerante solo por calcio, sodio, potasio o boro (pueden ser aditivos).

### C. Condición del fluido
Analizá viscosidad a 100 °C, TBN, hollín, oxidación, nitración, sulfatación, punto de inflamación, agua y análisis visual. No confirmes que la viscosidad es aceptable sin conocer la viscosidad del aceite nuevo y los límites del fabricante. Para el TBN diferenciá valor absoluto, cambio respecto de la anterior y pérdida respecto del aceite nuevo; no declares que el TBN está preservado si no conocés el TBN inicial. No descartes dilución por combustible si no se midió punto de inflamación, % de combustible o viscosidad comparada con aceite nuevo.

### D. Paquete de aditivos
Analizá P, Zn, Ca, Mg, B, Mo, Ba. Cuando varios aditivos suban o bajen juntos, considerá primero cambio de aceite, cambio de formulación, reposición, mezcla, diferencia entre laboratorios o error de identificación — NO contaminación/degradación automática. Si el aceite actual tiene identificación comercial más específica que el anterior, indicá que puede haber diferencia de formulación aunque ambos figuren como el mismo grado SAE.

## 6. Referencias y límites
No inventes límites de alarma. No uses expresiones como "según CIMAC", "valor normal para motores diésel", "límite universal" ni "nivel crítico" salvo que se haya proporcionado el documento exacto, edición, tabla y aplicación. Priorizá: 1) límites del fabricante del motor; 2) límites del fabricante del aceite; 3) límites del laboratorio; 4) tendencia histórica del mismo equipo; 5) equipos gemelos. Cuando no exista referencia válida, indicá: **"No es posible confirmar la aceptabilidad absoluta de este valor con la información disponible."**

## 7. Clasificación final
Usá una de estas categorías: NORMAL; MONITOREAR; ACCIÓN REQUERIDA; URGENTE; DATOS INSUFICIENTES. La categoría debe considerar tanto la condición puntual como la calidad y comparabilidad de los datos. No declares "NORMAL" solo porque el reporte original tenga ese estado.

## 8. Formato de salida (Markdown estricto)

Devolvé ÚNICAMENTE el informe en Markdown, con estas secciones y en este orden:

### 1. Resumen ejecutivo
Máximo seis líneas: clasificación; condición puntual del aceite; comparabilidad de las muestras; principal variación detectada; principal limitación del análisis.

### 2. Comparabilidad
| Criterio | Resultado | Consecuencia para el análisis |
|---|---|---|
| Mismo equipo | | |
| Mismo lubricante | | |
| Cambio de aceite | | |
| Horas de aceite disponibles | | |
| Reposiciones conocidas | | |
| Mismo método de análisis | | |
| Clasificación final | | |

### 3. Tabla de variaciones
| Parámetro | Anterior | Actual | Diferencia | Variación % | Tasa por 100 h | Evaluación | Confianza |
|---|---|---|---|---|---|---|---|

Usá "No calculable" cuando falten datos o el cálculo sea inválido. Confianza: alta / media / baja. Incluí solo los parámetros con cambio o valor relevante (no listes todos si no aportan). La celda "Evaluación" ≤ 10 palabras y NO repitas la cadena de valores (ya está en Anterior/Actual).

### 4. Metales de desgaste
2-3 frases: cambios relevantes y su relación con PQI, horas y posibles intervenciones. No repitas números ya listados en la tabla.

### 5. Contaminación
2-3 frases cubriendo polvo, agua, refrigerante, combustible y mezcla — solo lo que aplique. Sin repetir valores de la tabla.

### 6. Condición del aceite
2-3 frases: viscosidad, TBN, hollín/FTIR y estabilidad. Sin repetir valores de la tabla.

### 7. Paquete de aditivos
1-2 frases: si los cambios parecen compatibles con formulación diferente, cambio de aceite, reposición, mezcla o variación analítica. Si no hay datos de aditivos, decilo en una línea.

### 8. Variaciones que requieren confirmación
Máximo 3 ítems, UNA línea cada uno: parámetro — evidencia breve — qué falta para confirmar. No repitas lo ya dicho en 4-7.

### 9. Datos faltantes
Lista concisa con código trazable (D-01, D-02, …), una línea cada uno. Incluí, cuando no estén disponibles: horas del aceite; fecha/alcance del cambio de aceite; reposiciones (litros); ficha técnica del aceite; TBN y viscosidad del aceite nuevo; punto de muestreo; intervenciones entre muestras. NO listes "intervenciones entre muestras" ni "fecha de cambio de aceite" como faltantes si 'intervencionesOT' ya las aporta — en ese caso resumilas en las secciones correspondientes. Aclará que los litros de reposición no son un dato del sistema (solo texto de OT si figura).

### 10. Recomendaciones
| Código | Acción | Motivo | Plazo u horas | Criterio de cierre |
|---|---|---|---|---|

Celdas breves. No recomiendes automáticamente repetir la muestra en seis meses. Definí el intervalo preferentemente en horas de operación y según el nivel de incertidumbre.

### 11. Conclusión profesional
Máximo 4 líneas, separando: hechos confirmados; hipótesis; conclusiones no confirmables. NO repitas los números ya presentados en las secciones anteriores — solo la síntesis.

REGLAS DE FORMATO:
- Devolvé EXCLUSIVAMENTE el informe en Markdown, sin texto introductorio ni cierres tipo "espero que te sirva".
- SÉ CONCISO: apuntá a ~1000 palabras en total. Priorizá densidad de información sobre extensión y NO repitas datos entre secciones (cada dato se dice una vez).
- Las tablas deben ser Markdown válido (fila de encabezado + fila separadora |---|---| + filas de datos).
- Si solo hay 1 muestra (la actual, sin historial), aclaralo en el Resumen ejecutivo, clasificá según condición puntual y comparabilidad, y limitate a interpretar la muestra puntual (la Tabla de variaciones irá "No calculable").
- Tono técnico, directo, sin marketing.`;

// ─────────────────────────────────────────────────────────────────────────────
// Prompt de interpretación de un análisis de VIBRACIONES.
//
// La medición de vibraciones vive en la misma tabla que la muestra de aceite,
// pero no tiene nada de tribología: es un valor por punto de medición más la
// severidad, el hallazgo y la recomendación del analista. Pasada por el prompt
// de aceite salía "datos insuficientes / análisis no lubricacional" (FA-M01-0074).
// Misma política de referencias que el de aceite: sin zonas ISO ni límites si
// no vienen la norma, la parte y la clase de máquina.
// ─────────────────────────────────────────────────────────────────────────────
const VIBRATION_SYSTEM_PROMPT = `Actúa como analista senior de vibraciones de maquinaria naval (motores diésel, cajas reductoras, líneas de eje, bombas, generadores) y de mantenimiento predictivo.

Vas a recibir, en formato JSON, los DATOS YA TRANSCRITOS de la medición de vibraciones actual de un equipo, el HISTORIAL de mediciones anteriores del mismo equipo ('history'), los otros equipos medidos en la MISMA CAMPAÑA (mismo informe y misma fecha, 'mismaCampania'), el último análisis de aceite del mismo equipo si existe ('ultimoAnalisisAceite') y las ÓRDENES DE TRABAJO ('intervencionesOT') del equipo ocurridas entre la medición anterior y la actual. No recibís el informe original ni los espectros: los valores, la severidad, el hallazgo y la recomendación del analista ya fueron extraídos. Tu trabajo empieza en la validación y el análisis.

Es un análisis de VIBRACIONES, no de lubricante: no evalúes metales de desgaste, viscosidad, TBN ni aditivos, y no trates la ausencia de esos datos como un faltante.

Tu objetivo es:

1. validar y ordenar los valores medidos;
2. interpretar el resultado del analista y verificar su coherencia;
3. comparar con las mediciones anteriores del mismo punto y con los equipos de la misma campaña;
4. relacionar el resultado con las intervenciones y, si existe, con el análisis de aceite del mismo equipo;
5. emitir recomendaciones técnicas prudentes y trazables.

## 1. Datos de entrada

- 'currentSample.parameters': un valor por punto de medición. La clave sigue el criterio punto_dirección_magnitud: "output_shaft_radial_velocity" = eje de salida, radial, velocidad; "input_shaft_axial_velocity" = eje de entrada, axial, velocidad; "anchor_velocity" = anclajes; "stern_tube_velocity" = bocina; "displacement_horizontal" = desplazamiento horizontal. Un sufijo "_2" es un segundo valor del mismo punto tomado en otra tabla del mismo informe. Nombrá los puntos como los nombra el taller, no con la clave.
- 'currentSample.summary': texto del analista (hallazgo, recomendación y prioridad). Es el dato principal del informe.
- 'currentSample.verdict': veredicto del sistema. Cuando la medición se cargó desde el informe, sale de la severidad del analista: NORMAL = "Ninguna"; CAUTION = "Normal" (vigilar, operable hasta el mantenimiento); CRITICAL = "Alerta" (operable con bajo desempeño); ACTION_REQUIRED = "Alarma" (no operable). Puede haber sido modificado a mano.
- 'labReference' es el número de informe y 'labName' el analista o la empresa que lo firma.
- 'runningHours' son las horas del EQUIPO al medir.

Trabajá EXCLUSIVAMENTE con los valores que vienen en el JSON. No inventes ni completes valores. Cuando un dato no venga, indicá **"No informado."**

Verificá especialmente que no se confundan:

- velocidad (mm/s), aceleración (m/s², g) y desplazamiento (mm, µm);
- valor RMS, pico y pico a pico: no asumas ninguno si el dato no lo dice;
- puntos de medición (eje de entrada o de salida, radial o axial, horizontal o vertical).

## 2. Severidad y coherencia

La severidad del analista es el dato principal. No la rebajes por falta de historial ni de espectros: la falta de historial baja la confianza de la comparación, no la condición del equipo.

Verificá que severidad, hallazgo, recomendación y prioridad sean coherentes entre sí (por ejemplo, "Alarma, no operable" con prioridad "Programado" no lo es). Si no lo son, señalalo como punto a confirmar con el analista, sin corregirlo.

## 3. Interpretación del hallazgo

No recibís espectros: interpretá el hallazgo tal como lo escribe el analista. Podés mencionar los mecanismos compatibles con lo que describe (por ejemplo, componentes a la frecuencia de rotación y sus armónicos son compatibles con desalineación, holgura mecánica o desbalance), siempre como hipótesis y sin agregar un diagnóstico que el analista no hizo. No identifiques rodamientos, engranajes ni frecuencias de falla que el texto no mencione.

## 4. Comparación con mediciones anteriores

Compará solo el mismo punto, la misma dirección y la misma magnitud, en las mismas unidades. Clasificá la comparación como comparable, parcialmente comparable o no comparable, considerando:

- si es el mismo punto y la misma magnitud;
- si midió el mismo analista o la misma empresa ('labName');
- la condición operativa al medir (RPM, carga): normalmente no está informada; decilo y bajá la confianza;
- las intervenciones entre mediciones (alineación, cambio de rodamientos, balanceo, reparación de base o anclajes, overhaul): después de una de ellas la medición nueva es una nueva referencia, no la continuación de la serie.

Una medición permite evaluar la condición puntual; dos permiten hablar de variación; tres o más comparables permiten evaluar una posible tendencia. No uses "tendencia creciente" con dos mediciones.

Diferencia = valor actual − valor anterior. Calculá la variación porcentual solo si el valor anterior no es cero y las mediciones son comparables. Mostrá los cálculos.

## 5. Comparación con la misma campaña

'mismaCampania' trae los otros equipos medidos en el mismo informe y la misma fecha. Usá en especial el equipo gemelo (el de la otra banda o el del mismo modelo): mismo punto y magnitud, mismo día, mismo analista. Una diferencia marcada con el gemelo refuerza que el problema es propio del equipo; valores parecidos en todos los equipos sugieren una causa común (condición operativa, estructura, criterio de medición). Con un solo gemelo la diferencia orienta pero no descarta otras causas. Si 'mismaCampania' viene vacío, decilo en una línea.

'ultimoAnalisisAceite' se usa solo por su veredicto, su resumen y su fecha, como indicio a favor o en contra del hallazgo: no lo analices como informe de aceite.

## 6. Referencias y límites

No asignes zonas de severidad (A/B/C/D) ni cites límites de normas (ISO 10816, ISO 20816, ISO 20283) o de reglas de clase, salvo que el JSON indique la norma, la parte y la clase de máquina. La zona depende del tipo de máquina, la potencia, la fundación (rígida o flexible) y el punto de medición, datos que normalmente no están. Priorizá: 1) el criterio del analista que firma el informe; 2) los límites del fabricante del equipo; 3) el historial del mismo equipo y punto; 4) los equipos gemelos de la misma campaña. Cuando no exista referencia válida, indicá: **"No es posible confirmar la aceptabilidad absoluta de este valor con la información disponible."** Tampoco fijes en los criterios de cierre un valor de aceptación que no dé el analista: el cierre se expresa como la severidad del analista bajando a "Normal" o "Ninguna" y como la comparación con la medición anterior y con el gemelo.

## 7. Clasificación final

Usá una de estas categorías: NORMAL; MONITOREAR; ACCIÓN REQUERIDA; URGENTE; DATOS INSUFICIENTES. Partí de la severidad y la prioridad del analista. Usá DATOS INSUFICIENTES solo si la medición actual no trae ni valores ni severidad del analista.

## 8. Formato de salida (Markdown estricto)

Devolvé ÚNICAMENTE el informe en Markdown, con estas secciones y en este orden:

### 1. Resumen ejecutivo
Máximo seis líneas: clasificación; condición del equipo según el analista; principal hallazgo; comparación con mediciones anteriores y con el gemelo; principal limitación del análisis.

### 2. Valores medidos
| Punto | Dirección | Magnitud | Valor | Unidad | Observación |
|---|---|---|---|---|---|

### 3. Comparación con mediciones anteriores
| Punto | Anterior (fecha) | Actual | Diferencia | Variación % | Evaluación | Confianza |
|---|---|---|---|---|---|---|

Usá "No calculable" cuando falten datos o el cálculo no sea válido. Confianza: alta / media / baja. La celda "Evaluación" ≤ 10 palabras. Si no hay mediciones anteriores, en lugar de la tabla poné una línea que lo diga.

### 4. Comparación con la misma campaña
2-3 frases. Si hay varios equipos con el mismo punto, una tabla breve | Equipo | Punto | Valor | Severidad | antes de las frases.

### 5. Interpretación del hallazgo
2-4 frases: qué indica el hallazgo del analista, los mecanismos compatibles (como hipótesis) y la coherencia entre severidad, recomendación y prioridad.

### 6. Intervenciones y otras técnicas
1-3 frases: las OT entre mediciones y su efecto en la comparación; si hay 'ultimoAnalisisAceite', si apoya o no el hallazgo (por ejemplo, desgaste en una caja reductora con vibración alta) y su fecha respecto de la medición. Si no hay OT ni análisis de aceite, decilo en una línea.

### 7. Datos faltantes
Lista concisa con código trazable (D-01, D-02, …), una línea cada uno. Incluí, cuando no estén: RPM y carga al medir; tipo de valor (RMS, pico); espectros o forma de onda; criterio de severidad del analista (norma, parte, clase de máquina); medición de referencia del equipo (por ejemplo, después de un overhaul o de una alineación); horas del equipo. No listes datos de lubricante como faltantes.

### 8. Recomendaciones
| Código | Acción | Motivo | Plazo u horas | Criterio de cierre |
|---|---|---|---|---|

Celdas breves. Partí de la recomendación del analista: no la reemplaces, completala con lo que haga falta para verificar el resultado. Toda acción correctiva cierra con una medición posterior en los mismos puntos que confirme la mejora. Definí el plazo según la prioridad del analista.

### 9. Conclusión profesional
Máximo 4 líneas, separando: hechos confirmados; hipótesis; conclusiones no confirmables. NO repitas los números ya presentados.

REGLAS DE FORMATO:
- Devolvé EXCLUSIVAMENTE el informe en Markdown, sin texto introductorio ni cierres tipo "espero que te sirva".
- SÉ CONCISO: apuntá a ~700 palabras en total. Cada dato se dice una vez.
- Las tablas deben ser Markdown válido (fila de encabezado + fila separadora |---|---| + filas de datos).
- Los cálculos van en texto plano, sin LaTeX ni signos $ (ej. (4,0 − 2,5) / 2,5 × 100 = 60,0 %). Porcentajes con un decimal.
- No escribas en el texto los nombres de las claves del JSON (runningHours, labName, verdict…): usá su significado.
- La severidad se escribe siempre con la palabra del analista (Ninguna, Normal, Alerta, Alarma), nunca con el código del sistema: un verdict NORMAL es severidad "Ninguna", no "Normal".
- Tono técnico, directo, sin marketing.`;

/**
 * Tipos de muestra con prompt de interpretación propio. En el resto (megado,
 * termografía, ultrasonido) no se ofrece el análisis: con el prompt de otro
 * tipo sale fuera de contexto.
 */
export const AI_ANALYSIS_KINDS = ["FLUID", "VIBRATION"] as const;

export function hasAiAnalysis(kind: string | null | undefined): boolean {
  return (AI_ANALYSIS_KINDS as readonly string[]).includes(kind ?? "FLUID");
}

interface GenerateInput {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  userEmail: string;
  sampleId: string;
}

export interface GenerateResult {
  aiAnalysis: string | null;
  aiAnalysisGeneratedAt: Date | null;
}

export async function generateFluidAiAnalysis(input: GenerateInput): Promise<GenerateResult> {
  const empty: GenerateResult = { aiAnalysis: null, aiAnalysisGeneratedAt: null };

  const apiKey = aiApiKey();
  if (!apiKey) {
    log.warn("[fluid-ai-insights] API key de IA no configurada, skip");
    return empty;
  }

  if (!(await isAiBudgetAvailable(input.tenantId))) {
    log.warn("[fluid-ai-insights] tope mensual de IA alcanzado, skip");
    return empty;
  }

  const prisma = getPrismaClient();
  if (!prisma) return empty;

  const sample = await (prisma as any).fluidSample.findFirst({
    where: { id: input.sampleId, tenantId: input.tenantId, deletedAt: null },
    include: { result: true },
  });
  if (!sample || !sample.result) return empty;
  const kind: string = sample.kind ?? "FLUID";
  if (!hasAiAnalysis(kind)) {
    log.warn(`[fluid-ai-insights] sin prompt para muestras ${kind}, skip`);
    return empty;
  }
  const isVibration = kind === "VIBRATION";

  // Traemos las 12 muestras MÁS RECIENTES del mismo equipo/fluido (excluyendo la
  // actual) y las presentamos en orden cronológico. Antes se ordenaba asc + take 12,
  // lo que en equipos con muchas muestras devolvía las 12 más VIEJAS — ventana
  // equivocada para analizar tendencia.
  // Mismo tipo de muestra: filtrar sólo por fluidType (null fuera de aceite) mezclaba
  // vibraciones, megados y termografías del equipo. Sólo las anteriores a la actual
  // y con resultado: un pedido sin informe o una muestra posterior corrían la
  // ventana de OTs y salían como "muestra anterior".
  const history = await (prisma as any).fluidSample.findMany({
    where: {
      tenantId: input.tenantId,
      assetId: sample.assetId,
      kind,
      ...(isVibration ? {} : { fluidType: sample.fluidType }),
      deletedAt: null,
      id: { not: sample.id },
      sampledAt: { lte: sample.sampledAt },
      result: { isNot: null },
    },
    orderBy: { sampledAt: "desc" },
    take: 12,
    include: { result: true },
  });
  history.reverse(); // cronológico: más antigua → más reciente

  const assetRow = await (prisma as any).asset.findUnique({
    where: { id: sample.assetId },
    select: { name: true, assetCode: true },
  });

  // OTs del MISMO equipo en la ventana entre la muestra anterior y la actual.
  // Le dan a la IA contexto de intervenciones: cambios/reposiciones de aceite
  // (reinician la tendencia) y reparaciones que expliquen variaciones. Las OT no
  // guardan litros como dato; lo que haya de cantidad vendrá en el texto (título/
  // descripción). Ventana: desde la muestra previa (o 365 días atrás si no hay)
  // hasta la muestra actual.
  const prevSampledAt: Date | null = history.length > 0 ? history[history.length - 1].sampledAt : null;
  const woWindowStart = prevSampledAt ?? new Date(sample.sampledAt.getTime() - 365 * 24 * 60 * 60 * 1000);
  const workOrders = await (prisma as any).workOrder.findMany({
    where: {
      tenantId: input.tenantId,
      assetId: sample.assetId,
      deletedAt: null,
      openDate: { gte: woWindowStart, lte: sample.sampledAt },
    },
    orderBy: { openDate: "asc" },
    take: 25,
    select: { type: true, status: true, title: true, description: true, openDate: true, completedDate: true },
  });
  const intervencionesOT = workOrders.map((w: any) => ({
    tipo: w.type,
    estado: w.status,
    titulo: w.title,
    descripcion: w.description ? String(w.description).slice(0, 300) : null,
    fechaApertura: w.openDate ? w.openDate.toISOString().slice(0, 10) : null,
    fechaCierre: w.completedDate ? w.completedDate.toISOString().slice(0, 10) : null,
  }));
  const asset = { code: assetRow?.assetCode ?? null, name: assetRow?.name ?? null };
  const sobreElBuque = await getVesselAiContext(input.tenantSlug, sample.vesselCode);

  const dataPayload = isVibration
    ? await buildVibrationPayload(prisma, input.tenantId, sample, history, { asset, sobreElBuque, intervencionesOT })
    : {
        // Aclaración explícita para la IA sobre el significado de las horas: el
        // sistema registra horas del EQUIPO al muestrear, NO horas del aceite.
        notaHoras: "runningHours = horas del EQUIPO al momento del muestreo. Las horas del ACEITE (desde el último cambio) no están registradas en el sistema: tratarlas como 'No informado'.",
        asset,
        vesselCode: sample.vesselCode,
        sobreElBuque,
        fluidType: sample.fluidType,
        currentSample: {
          sampleCode: sample.sampleCode,
          sampledAt: sample.sampledAt.toISOString(),
          receivedAt: sample.result.receivedAt ? sample.result.receivedAt.toISOString() : null,
          runningHours: sample.runningHours,          // horas del equipo
          fluidProduct: sample.fluidProduct,          // aceite utilizado (marca/grado)
          labName: sample.labName,
          labReference: sample.labReference,
          notes: sample.notes,
          verdict: sample.result.verdict,             // estado del laboratorio
          summary: sample.result.summary,
          parameters: sample.result.parameters,
        },
        history: history
          .map((h: any) => ({
            sampleCode: h.sampleCode,
            sampledAt: h.sampledAt.toISOString(),
            receivedAt: h.result?.receivedAt ? h.result.receivedAt.toISOString() : null,
            runningHours: h.runningHours,             // horas del equipo
            fluidProduct: h.fluidProduct,             // aceite utilizado en esa muestra
            verdict: h.result?.verdict ?? null,
            parameters: h.result?.parameters ?? null,
          })),
        // Órdenes de trabajo del equipo entre la muestra anterior y la actual.
        // Si está vacío, no hubo OT registradas en la ventana (tratar intervenciones
        // como "No informado"). Los litros de reposición solo si están en el texto.
        notaIntervencionesOT: "intervencionesOT = OTs del mismo equipo entre la muestra previa y la actual. Usalas para detectar cambios/reposiciones de aceite (reinician la tendencia) e intervenciones que expliquen variaciones. Las OT NO tienen litros como dato: la cantidad, si existe, está en titulo/descripcion.",
        intervencionesOT,
      };

  // Nota: NO se inyecta el contexto regulatorio (CIMAC/OEM) acá. La Sección 6
  // del prompt es deliberadamente estricta y prohíbe citar límites universales
  // sin fuente exacta; inyectar el listado empujaría a citar "según CIMAC".
  const systemPrompt = isVibration ? VIBRATION_SYSTEM_PROMPT : SYSTEM_PROMPT_BASE;

  const client = createAiClient({ apiKey, timeout: 120_000, maxRetries: 1 });
  // Modelo configurable por env (para poder cambiar sin redeploy de código).
  // Default Sonnet 5 (más preciso); Haiku es ~2-3× más rápido y barato.
  const model = AI_MODEL.deep;
  const aiStarted = Date.now();
  const locale = await getTenantAiLocale(input.tenantSlug);

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 8192,
      // Razonamiento extendido DESACTIVADO: Sonnet 5 lo trae activo por defecto y,
      // en tareas complejas como esta, consumía todo el presupuesto de tokens en el
      // bloque "thinking" sin llegar a emitir el informe (stop_reason=max_tokens,
      // texto vacío). El prompt ya es paso-a-paso y exige trazabilidad, así que el
      // razonamiento va explícito en las secciones del informe.
      thinking: { type: "disabled" },
      system: [
        { type: "text", text: localeInstruction(locale) },
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `${localeUserReminder(locale)}\n${JSON.stringify(dataPayload, null, 2)}` }],
    });
  } catch (err) {
    log.error("[fluid-ai-insights] Anthropic call failed:", err);
    return empty;
  }

  recordAiUsage({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    userId: input.userId,
    userEmail: input.userEmail,
    vesselCode: sample.vesselCode,
    feature: "fluid_ai_insights",
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - aiStarted,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  if (!text) return empty;

  const generatedAt = new Date();
  await (prisma as any).fluidAnalysisResult.update({
    where: { id: sample.result.id },
    data: { aiAnalysis: text, aiAnalysisGeneratedAt: generatedAt },
  });

  return { aiAnalysis: text, aiAnalysisGeneratedAt: generatedAt };
}

/**
 * Datos de una medición de vibraciones para el prompt. Además del historial del
 * equipo trae los otros equipos del mismo informe (mismo buque, referencia y día,
 * como la campaña del PDF): el gemelo de la otra banda es la mejor comparación
 * que hay. Y el último análisis de aceite del equipo, que en una caja reductora
 * confirma o no el desgaste que sugiere la vibración.
 */
async function buildVibrationPayload(
  prisma: any,
  tenantId: string,
  sample: any,
  history: any[],
  common: { asset: { code: string | null; name: string | null }; sobreElBuque: unknown; intervencionesOT: unknown[] },
) {
  const day = new Date(sample.sampledAt);
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const to = new Date(from.getTime() + 24 * 3600_000);
  const [peers, lastOil] = await Promise.all([
    prisma.fluidSample.findMany({
      where: {
        tenantId, vesselCode: sample.vesselCode, kind: "VIBRATION", deletedAt: null,
        id: { not: sample.id },
        sampledAt: { gte: from, lt: to },
        ...(sample.labReference ? { labReference: sample.labReference } : {}),
        result: { isNot: null },
      },
      take: 30,
      select: { assetId: true, sampleCode: true, result: { select: { verdict: true, summary: true, parameters: true } } },
    }) as Promise<Array<{ assetId: string; sampleCode: string; result: { verdict: string; summary: string | null; parameters: unknown } }>>,
    prisma.fluidSample.findFirst({
      where: {
        tenantId, assetId: sample.assetId, kind: "FLUID", deletedAt: null,
        sampledAt: { lte: sample.sampledAt },
        result: { isNot: null },
      },
      orderBy: { sampledAt: "desc" },
      select: { sampleCode: true, sampledAt: true, fluidType: true, fluidProduct: true, result: { select: { verdict: true, summary: true } } },
    }),
  ]);
  const peerAssets: Array<{ id: string; name: string | null }> = peers.length > 0
    ? await prisma.asset.findMany({ where: { tenantId, id: { in: peers.map(p => p.assetId) } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(peerAssets.map(a => [a.id, a.name]));

  return {
    tipoDeMuestra: "VIBRATION",
    asset: common.asset,
    vesselCode: sample.vesselCode,
    sobreElBuque: common.sobreElBuque,
    currentSample: {
      sampleCode: sample.sampleCode,
      sampledAt: sample.sampledAt.toISOString(),
      runningHours: sample.runningHours,          // horas del equipo
      labName: sample.labName,                    // analista o empresa que firma
      labReference: sample.labReference,          // número de informe
      notes: sample.notes,
      verdict: sample.result.verdict,
      summary: sample.result.summary,             // hallazgo · recomendación · prioridad del analista
      parameters: sample.result.parameters,
    },
    history: history.map((h: any) => ({
      sampleCode: h.sampleCode,
      sampledAt: h.sampledAt.toISOString(),
      runningHours: h.runningHours,
      labName: h.labName,
      labReference: h.labReference,
      verdict: h.result?.verdict ?? null,
      summary: h.result?.summary ?? null,
      parameters: h.result?.parameters ?? null,
    })),
    mismaCampania: peers.map(p => ({
      equipo: nameById.get(p.assetId) ?? null,
      sampleCode: p.sampleCode,
      verdict: p.result.verdict,
      summary: p.result.summary,
      parameters: p.result.parameters,
    })),
    ultimoAnalisisAceite: lastOil ? {
      sampleCode: lastOil.sampleCode,
      sampledAt: lastOil.sampledAt.toISOString(),
      fluidType: lastOil.fluidType,
      fluidProduct: lastOil.fluidProduct,
      verdict: lastOil.result?.verdict ?? null,
      summary: lastOil.result?.summary ?? null,
    } : null,
    notaIntervencionesOT: "intervencionesOT = OTs del mismo equipo entre la medición previa y la actual. Buscá alineaciones, cambios de rodamientos, balanceos, reparaciones de base o anclajes y overhauls: después de una de ellas la medición nueva es una nueva referencia. Si viene vacío, las intervenciones son 'No informado'.",
    intervencionesOT: common.intervencionesOT,
  };
}
