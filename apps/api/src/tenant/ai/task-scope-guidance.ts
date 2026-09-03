// Calibración común de los prompts que generan contenido operativo de una tarea:
// criterios de aceptación, LOTO, análisis de riesgo (JSA) y consecuencia RCM.
//
// Dos problemas reales que estos bloques corrigen (sep 2026):
//
// 1. La IA se iba del alcance. Ante "Inspección de Clase" proponía deflexión de
//    cigüeñal, alineación de línea de eje y análisis de vibraciones: una
//    inspección general de clase no es un control del cigüeñal. El criterio
//    tiene que salir de LO QUE LA TAREA DICE, no del mantenimiento completo que
//    ese equipo podría llegar a tener.
//
// 2. La IA escribía para un taller. Pedía torquímetro certificado, ensayos no
//    destructivos y laboratorio a una tripulación que a bordo tiene llaves,
//    multímetro y un termómetro infrarrojo. Un criterio que nadie puede
//    verificar no se cumple: queda como plan de papel.
//
// Se comparten como constantes (no como capa nueva): cada prompt las concatena
// donde corresponde. Van dentro del bloque cacheado del system prompt, así que
// no pagan tokens en cada llamada.

/** Alcance: contestar por la tarea pedida y nada más. Aplica a los cuatro análisis. */
export const SCOPE_RULES = `ALCANCE — no te salgas de la tarea pedida (regla dura):
- Respondé SOLO por el trabajo que la tarea describe. No agregues mediciones, desarmes ni controles de otros trabajos, por más que el equipo los tenga en su mantenimiento habitual.
- Una inspección general (de Clase, de bandera, de la Compañía, ronda de rutina) es una verificación general del estado: funcionamiento, ausencia de fugas/daños/corrosión, fijaciones, señalización y documentación. NO exijas ensayos especializados de componentes (deflexión de cigüeñal, alineación de línea de eje, análisis de vibraciones, medición de aislación, apertura de partes) salvo que la tarea los nombre explícitamente.
- Si la tarea nombra un componente o sistema puntual, quedate en ese componente: no la conviertas en una intervención mayor.`;

/** Nivel de exigencia: lo ejecuta la tripulación con lo que hay a bordo. */
export const CREW_LEVEL_RULES = `NIVEL — escribí para una tripulación, no para un taller (regla dura):
- Quien lo ejecuta es la tripulación del buque: conocimiento general de a bordo, no especialistas. Todo lo que pidas tiene que poder hacerse así.
- Instrumentos disponibles a bordo: herramientas comunes, multímetro, pinza amperométrica, manómetros e indicadores del propio equipo, termómetro infrarrojo, calibre, galga de espesores, linterna. Con eso alcanza.
- NO pidas laboratorio, banco de pruebas, torquímetro con certificado de calibración, ensayos no destructivos, endoscopía, alineación láser ni análisis instrumental. Excepción única: que la tarea diga que la ejecuta un proveedor o taller externo — ahí sí puede exigir sus instrumentos.
- Preferí lo simple y verificable: a la vista, al oído, al tacto, o medido con lo que hay a bordo. Un criterio básico que la tripulación puede cumplir vale más que uno perfecto que nadie va a poder verificar.
- Quedate en lo esencial: pocos puntos, los que de verdad definen si el trabajo está bien hecho.`;

/** Diferenciación inspección / mantenimiento para los prompts que no la traen propia. */
export const TASK_TYPE_RULES = `TENÉ EN CUENTA EL TIPO DE TAREA (si se indica):
- INSPECCIÓN: verificación o medición sin desarmar. Lo verificable es el ESTADO y el FUNCIONAMIENTO: qué se miró, en qué condición está, si hay fugas, ruidos, holguras, corrosión o daños. No pidas resultados de desarme ni de intervención.
- MANTENIMIENTO: intervención física (desarme, cambio de componentes, ajuste, lubricación). Lo verificable es que el trabajo quedó ejecutado y el equipo volvió a operar normal (sin fugas, sin ruidos anormales, valores de operación normales).`;
