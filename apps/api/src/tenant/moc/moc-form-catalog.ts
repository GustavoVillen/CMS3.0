// Catálogo de preguntas/labels del formulario controlado REGI-GES-06.1.
// Espejo backend de apps/web-modern/src/lib/moc-form-catalog.ts — se duplica
// porque frontend y backend son paquetes separados; es contenido estático del
// documento controlado. Si cambian las preguntas, actualizar AMBOS archivos.

export type EvalGroupKey = "GENERAL" | "INFRASTRUCTURE" | "TECHNOLOGY" | "ORGANIZATIONAL" | "PROCEDURES";

export const EVAL_GROUPS: { key: EvalGroupKey; label: string }[] = [
  { key: "GENERAL",        label: "Aspectos Generales" },
  { key: "INFRASTRUCTURE", label: "Cambios en la Infraestructura" },
  { key: "TECHNOLOGY",     label: "Cambios en la Tecnología" },
  { key: "ORGANIZATIONAL", label: "Cambios Organizacionales" },
  { key: "PROCEDURES",     label: "Cambios en los Procedimientos" },
];

export const EVAL_QUESTIONS: { n: number; group: EvalGroupKey; text: string }[] = [
  { n: 1,  group: "GENERAL", text: "¿El cambio alterará los aspectos e impactos ambientales, tales como la generación de residuos, aguas residuales, las emisiones atmosféricas, y otros?" },
  { n: 2,  group: "GENERAL", text: "¿El cambio aumentará los riesgos de seguridad tales como: incendios, explosiones, descargas eléctricas, inundaciones, desmoronamiento o colapso?" },
  { n: 3,  group: "GENERAL", text: "¿El cambio podría impactar en las comunidades vecinas?" },
  { n: 4,  group: "GENERAL", text: "¿El cambio va a alterar las condiciones de consumo de los recursos naturales de forma a que tenga impacto en SSMA?" },
  { n: 5,  group: "GENERAL", text: "¿El cambio aumentará los riesgos relacionados a la ergonomía de forma significativa?" },
  { n: 6,  group: "GENERAL", text: "¿El cambio aumentará los riesgos relacionados con la salud ocupacional, la exposición a agentes ambientales significativos (Físicas, químicas o biológicas)?" },
  { n: 7,  group: "INFRASTRUCTURE", text: "¿Se alterará el layout o las condiciones de uso de las instalaciones o equipamientos en relación al diseño original?" },
  { n: 8,  group: "INFRASTRUCTURE", text: "¿Los cambios implicarán alteraciones con impacto en SSMA en las instalaciones eléctricas o hidráulicas?" },
  { n: 9,  group: "INFRASTRUCTURE", text: "¿Los cambios implican intervención civil con el fin de alterar el layout del área?" },
  { n: 10, group: "INFRASTRUCTURE", text: "¿El retiro de las instalaciones de operación afectará los estándares de emergencia?" },
  { n: 11, group: "INFRASTRUCTURE", text: "¿La suspensión de las actividades afectará el flujo del proceso y necesitará revisión?" },
  { n: 12, group: "TECHNOLOGY", text: "¿Serán modificados o alterados cualquiera de los dispositivos de protección del equipamiento?" },
  { n: 13, group: "TECHNOLOGY", text: "¿Habrá alteraciones en los procesos o equipamiento para el transporte, almacenamiento, manipulación, utilización y descarte de materiales peligrosos?" },
  { n: 14, group: "TECHNOLOGY", text: "¿Los cambios causarán alteraciones en los planes de mantenimiento existentes o serán generados nuevos planes de mantenimiento?" },
  { n: 15, group: "TECHNOLOGY", text: "¿Los cambios generarán la necesidad de inclusión de nuevos EPI o EPC en el área?" },
  { n: 16, group: "TECHNOLOGY", text: "¿Los cambios causarán interferencia a otros equipamientos u operaciones?" },
  { n: 17, group: "TECHNOLOGY", text: "¿Serán realizadas modificaciones en los vehículos (neumáticos, estructura o diseño, la suspensión, la capacidad, el sistema mecánico o eléctrico)?" },
  { n: 18, group: "TECHNOLOGY", text: "¿Los cambios implicarán la sustitución de la contratada/proveedor o alterará la cantidad de los insumos de forma que tenga impacto en SSMA?" },
  { n: 19, group: "ORGANIZATIONAL", text: "¿Los cambios implicarán una alteración de función o puesto de trabajo con exposición directa a riesgos?" },
  { n: 20, group: "ORGANIZATIONAL", text: "¿Será necesario entrenamiento o actualización relacionados a SSMA debido al cambio de función, de equipamientos o procedimientos?" },
  { n: 21, group: "ORGANIZATIONAL", text: "¿Será necesario un nuevo examen médico para trabajar en la nueva función?" },
  { n: 22, group: "PROCEDURES", text: "¿El cambio implicará la revisión de la Evaluación Preliminar de Riesgos, el levantamiento de los Aspectos e Impactos existente o la elaboración de una nueva?" },
  { n: 23, group: "PROCEDURES", text: "¿Los cambios pueden entrar en conflicto con la legislación/regulación o norma reglamentaria existente?" },
  { n: 24, group: "PROCEDURES", text: "¿Los cambios generarán nuevos Procedimientos Operacionales o implicará la alteración de Procedimientos existente?" },
];

export const EFFECTIVENESS_QUESTIONS: { n: number; text: string }[] = [
  { n: 1, text: "¿Fueron revisados, evaluados y actualizados planos, procedimientos, requisitos de mantenimiento, planes de emergencia y otros requisitos funcionales afectados por el cambio?" },
  { n: 2, text: "¿Todas las personas afectadas por el cambio fueron informadas y entrenadas?" },
  { n: 3, text: "¿Se realizó la actualización del Análisis de Riesgo e Impactos Ambientales, así como el Análisis de Riesgo de la Tarea?" },
  { n: 4, text: "¿El resultado fue de acuerdo con lo esperado?" },
  { n: 5, text: "¿Fue realizado o simulado una Inspección y Prueba?" },
  { n: 6, text: "¿Hubo algún efecto/riesgo no deseado durante las pruebas y que no estaban previstas en la evaluación de riesgo?" },
  { n: 7, text: "¿Los planes de acción previstos en la Planificación del Cambio fueron concluidos?" },
];

export const EVALUATOR_AREAS: { key: string; label: string }[] = [
  { key: "SSMA", label: "SSMA" },
  { key: "RRHH", label: "RRHH" },
  { key: "OPERATIONS", label: "Operaciones" },
  { key: "TECHNICAL", label: "Técnica" },
  { key: "WORKSHOP", label: "Taller" },
  { key: "CAPTAINS", label: "Capitanes" },
  { key: "CHIEF_ENGINEERS", label: "Jefes de Máquinas" },
  { key: "DESIGNATED_PERSON", label: "Persona Designada" },
];

export const CHANGE_TYPES: { key: string; label: string }[] = [
  { key: "INFRASTRUCTURE", label: "Infraestructura" },
  { key: "TECHNOLOGICAL", label: "Tecnológico" },
  { key: "PROCEDURES", label: "Procedimientos" },
  { key: "ORGANIZATIONAL", label: "Organizacional" },
];

export const LOCATION_TYPES: { key: string; label: string }[] = [
  { key: "OFFICE", label: "Oficina" },
  { key: "WAREHOUSE", label: "Depósito" },
  { key: "WORKSHOP", label: "Taller" },
];

export const DURATION_LABELS: Record<string, string> = { PERMANENT: "Permanente", TEMPORARY: "Temporal" };
export const YESNO_LABELS: Record<string, string> = { YES: "Sí", NO: "No", UNKNOWN: "No sabe" };
export const RISK_LABELS: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto", CRITICAL: "Crítico" };
