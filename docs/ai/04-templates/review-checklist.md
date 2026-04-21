# Review Checklist

## Arquitectura
- ¿Respeta la arquitectura actual?
- ¿Evita refactors globales?
- ¿Evita duplicación semántica?
- ¿Reutiliza servicios y patrones existentes?

## Seguridad
- ¿Respeta tenant isolation?
- ¿Respeta fleet/vessel scope?
- ¿Es fail-closed?
- ¿Evita confiar en filtros frontend como control real?

## Dominio
- ¿Mantiene separadas las entidades maestras, planes, ejecuciones, findings y análisis formales?
- ¿Mantiene separadas inspection y maintenance?
- ¿Evita crear Work Orders innecesarias?
- ¿Mantiene trazabilidad?

## Datos
- ¿La migración es segura?
- ¿No rompe datos existentes?
- ¿Usa índices y constraints razonables?
- ¿Preserva contexto histórico cuando corresponde?

## Operación
- ¿Reduce carga manual?
- ¿Es usable a bordo?
- ¿Evita burocracia?
- ¿Integra IA como asistente y no como aprobador?

## Entrega
- ¿Incluye archivos tocados?
- ¿Incluye riesgos?
- ¿Incluye tests?
- ¿Incluye supuestos?