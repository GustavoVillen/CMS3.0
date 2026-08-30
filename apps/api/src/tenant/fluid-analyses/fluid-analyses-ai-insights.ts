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

  // Traemos las 12 muestras MÁS RECIENTES del mismo equipo/fluido (excluyendo la
  // actual) y las presentamos en orden cronológico. Antes se ordenaba asc + take 12,
  // lo que en equipos con muchas muestras devolvía las 12 más VIEJAS — ventana
  // equivocada para analizar tendencia.
  const history = await (prisma as any).fluidSample.findMany({
    where: {
      tenantId: input.tenantId,
      assetId: sample.assetId,
      fluidType: sample.fluidType,
      deletedAt: null,
      id: { not: sample.id },
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

  const dataPayload = {
    // Aclaración explícita para la IA sobre el significado de las horas: el
    // sistema registra horas del EQUIPO al muestrear, NO horas del aceite.
    notaHoras: "runningHours = horas del EQUIPO al momento del muestreo. Las horas del ACEITE (desde el último cambio) no están registradas en el sistema: tratarlas como 'No informado'.",
    asset: { code: assetRow?.assetCode ?? null, name: assetRow?.name ?? null },
    vesselCode: sample.vesselCode,
    sobreElBuque: await getVesselAiContext(input.tenantSlug, sample.vesselCode),
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
    intervencionesOT: workOrders.map((w: any) => ({
      tipo: w.type,
      estado: w.status,
      titulo: w.title,
      descripcion: w.description ? String(w.description).slice(0, 300) : null,
      fechaApertura: w.openDate ? w.openDate.toISOString().slice(0, 10) : null,
      fechaCierre: w.completedDate ? w.completedDate.toISOString().slice(0, 10) : null,
    })),
  };

  // Nota: NO se inyecta el contexto regulatorio (CIMAC/OEM) acá. La Sección 6
  // del prompt es deliberadamente estricta y prohíbe citar límites universales
  // sin fuente exacta; inyectar el listado empujaría a citar "según CIMAC".
  const systemPrompt = SYSTEM_PROMPT_BASE;

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
