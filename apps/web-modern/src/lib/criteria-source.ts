// ISM 10.1 — origen normativo de una tarea de mantenimiento: de qué regla nace.
//
// El Capítulo 10 del Código ISM pide poder mostrarle al auditor la trazabilidad
// "requisito → tarea de mantenimiento". Sin este dato el plan dice QUÉ hacer y
// CADA CUÁNTO, pero no de dónde sale la exigencia.
//
// Mismo vocabulario que los ítems de las plantillas de inspección
// (`CriteriaSource` en el schema): la pregunta es idéntica y tener dos listas
// obligaría al panel del Capítulo 10 a traducir entre ellas.
//
// Vive en `lib/` y no en la página de planes porque lo usan la página y la
// planilla (`MaintenancePlansGrid`), que ya se importan entre sí: sacar la
// constante de ahí evita convertir ese import de tipos en un ciclo en runtime.

export const CRITERIA_SOURCES = [
  "CLASS_REQUIREMENT", "STATUTORY", "MAKER_MANUAL", "COMPANY_STANDARD", "ENGINEERING_CRITERION",
] as const;

export type CriteriaSource = (typeof CRITERIA_SOURCES)[number];
