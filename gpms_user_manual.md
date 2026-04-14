# Manual de Usuario - Sistema GPMS (Gas Planned Maintenance System)

Bienvenido al Manual de Usuario del **Sistema GPMS**. Este documento describe cómo navegar y aprovechar al máximo las funcionalidades principales de la plataforma. La plataforma ha sido diseñada para optimizar los procesos de mantenimiento, reportes de fallas e investigaciones mediante la integración con Inteligencia Artificial.

---

## 🚀 1. Introducción y Acceso

El sistema GPMS centraliza la gestión del mantenimiento planificado y los reportes operativos, actuando como el corazón de las operaciones de mantenimiento.

- **Diseño Moderno:** Interfaz por tarjetas y paneles optimizada para lectura rápida.
- **Asistentes de Inteligencia Artificial:** Integra asistentes para la Evaluación de Barreras de Seguridad y Análisis de Causa Raíz (RCA).
- **Integración Nativa:** Generación de archivos PDF y subida directa de evidencias fotográficas o adjuntos a Google Drive.

## 📊 2. Tablero Principal (Backlog Operativo)

El *Backlog Operativo* es la pantalla central desde donde los usuarios monitorean las tareas críticas, incluyendo Inspecciones (PMs), Órdenes de Trabajo (OTs), Defectos Abiertos, Diferimientos (Deferrals) y Acciones Correctivas/Preventivas (CAPA).

*   **Identificación rápida de alertas:** Los elementos muestran insignias y colores de estado (ej. "Vencido" en rojo pastel, "Completado" en verde, "En Espera" en amarillo).
*   **Secciones Dinámicas:** Los registros se dividen por modo de trabajo permitiendo una revisión organizada.
*   **Acciones Directas:** Haciendo clic sobre una tarea pendiente, se habilita la creación automática de formularios asociados (Ej: Cerrar Orden de Trabajo).

## 🛠️ 3. Gestión de Notas de Falla / Defectos (Defect Logging)

Cuando se detecta una falla o desviación técnica en la operación, se debe ingresar al módulo de **Notas de Falla**.

1. **Ingreso del Defecto:** Seleccione el componente afectado e informe del modo de falla.
2. **Contexto de Inventario Inteligente:** El sistema detectará automáticamente la criticidad del equipo y su historial asociado verificando su recurrencia.
3. **Planes de Acción Dinámicos:** Dependiendo del estado y la criticidad (A/B vs C), el plan correctivo se adaptará automáticamente (requiriendo opciones o permitiendo diferimientos de forma controlada).
4. **Alerta de Inoperatividad (NO-GO):** Si se clasifica con impacto severo y se declara que la unidad queda Inoperativa, se bloquea la posibilidad de "Diferir" para evitar malas prácticas.

## 🧠 4. Análisis de Causa Raíz (RCA Asistido por IA)

El GPMS viene equipado con un asistente de IA capaz de evaluar las fallas complejas y elaborar un informe de RCA detallado.

1.  **Ejecución del Wizard:** Accede al asistente desde una nota de falla validada.
2.  **Entrevista Dinámica:** La plataforma guiada indagará aspectos claves sobre la falla utilizando el método de evaluación interactivo.
3.  **Generación de Resultados:** La IA interpreta el contexto, determina variables desencadenantes e infiere y completa automáticamente los formularios de "Plan de Acción" a seguir.
4.  **Generación de PDF:** Con un solo clic, se puede exportar el reporte final del RCA con formato institucional en versión PDF y guardar copia directamente en el registro documental de la orden correspondiente.

## 🛡️ 5. Evaluación de Barreras (Interviewer Asesoria)

Este módulo evalúa la integridad y eficacia de las barreras de seguridad dispuestas frente a un evento o defecto en el equipo.

1.  **Inicio de la Sesión:** Al activar el módulo, se lanza un formulario donde la Inteligencia Artificial conversará paso-a-paso interactuando con las respuestas proporcionadas por el Inspector/Funcionario.
2.  **Generación de Medidas Compensatorias:** De la charla iterativa, el sistema genera de forma automática sugerencias sobre medidas operativas provisorias (Mitigaciones) para continuar manteniendo la seguridad del sistema operando degradado.
3.  **Aprobación y Disparo Cautelar:** Dependiendo del resultado consolidado de riesgos, las advertencias clave se disparan vía notificaciones (Captain/Shore Alert) pertinentes.

## 📝 6. Módulo de Órdenes de Trabajo (Work Orders)

Permite ejecutar y rastrear el historial de intervenciones.
- Generación de reportes tras la reparación final listando las causas identificadas o confirmadas durante las inspecciones programadas.
- Actualización automática del medidor de horas (HS) de componentes y proyecciones de vida útil restantes en tiempo real tras re-enviar la ejecución.
- Subida de Informes/imágenes extraídas localmente o buscando reportes en el Google Picker.

## 💡 Mejores Prácticas del Sistema

*   **Evidencias de Impacto:** Siempre adjuntar la fotografía del componente desde el inicio de la avería.
*   **Respuestas en la IA:** Ser claro y específico sobre los síntomas o "consecuencias observadas" mientras la Inteligencia artificial asiste en el módulo de investigación; cuanto mejor el contexto, mejores las deducciones de RCA/Barreras.
*   **Atención a las Notificaciones:** Nunca ignorar el color rojo (NO-GO) puesto que detiene la ventana operativa regular.

---
*Este manual sirve como guía operativa standard orientada a los roles técnicos, inspectores, ingenieros de planta, y capitanes.* 
