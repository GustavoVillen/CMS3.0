# Cambios de esquema propuestos — auditoría 2026-09-09

**Ninguno está aplicado.** No se corrió `db:push` ni `prisma:generate`. Las
correcciones de la auditoría funcionan **sin** estos cambios; lo de acá abajo
es lo que haría falta para cerrar los límites que quedaron documentados.

Están ordenados por relación costo/beneficio.

---

## 1. Índice en `RefreshToken.refreshTokenHash` — recomendado

```prisma
model RefreshToken {
  // ... sin cambios de columnas ...
  @@index([refreshTokenHash])   // ← agregar
}
```

**Por qué.** Cada renovación de sesión (`refreshTenantSession`) y cada logout
buscan por `refreshTokenHash`. Hoy sólo hay índices por `userId`, `tenantId` y
`expiresAt`, así que Postgres filtra por `tenantId` y después recorre. Con 185
refresh tokens activos no se nota; con miles, cada refresh se vuelve un scan.

**Impacto.** Ninguno en los datos ni en el código: es sólo un índice. Se puede
aplicar en caliente.

**Riesgo.** Nulo. Ocupa unos KB más por fila indexada.

---

## 2. Valor `SENDING` en `ScheduledReportStatus` — mejora de legibilidad

```prisma
enum ScheduledReportStatus {
  SENDING                  // ← agregar
  SENT
  FAILED
  SKIPPED_NO_RECIPIENTS
  SKIPPED_NOT_CONFIGURED
}
```

**Por qué.** La reserva del parte semanal (`weekly-report-claim.ts`) necesita un
estado "reclamado, todavía sin salir". Como el enum no lo tiene, hoy se marca
con `status: FAILED` + `error: "PENDING_SEND"`. Funciona y es fail-safe (si el
proceso se cae, la fila queda como fallida, que es la verdad), pero durante los
segundos que dura el envío la pantalla de "semanas anteriores" muestra esa
semana como fallida.

**Impacto.** Aditivo: ningún registro existente cambia. Después habría que
tocar dos cosas en `weekly-report-claim.ts` (usar `SENDING` en vez de
`FAILED` + marcador) y decidir si el listado del archivo lo muestra como
"en curso" o lo oculta.

**Riesgo.** Bajo. Un enum nuevo obliga a regenerar el cliente Prisma
(`prisma:generate`) y a revisar cualquier `switch` sobre el status — hoy no hay
ninguno: el frontend lo muestra como texto.

---

## 3. Registro persistente de archivos recién subidos — sólo si molesta el límite

```prisma
model PendingUpload {
  id           String   @id @default(cuid())
  tenantId     String
  /** URL tal como la devuelve el save*: "/uploads/<kind>/<slug>/<archivo>" */
  url          String   @unique
  uploadedByUserId String
  createdAt    DateTime @default(now())
  expiresAt    DateTime

  tenant       Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([expiresAt])
}
```

**Por qué.** `file-access-service.ts` autoriza un archivo por el registro que lo
contiene. Entre que se sube y que se guarda el registro (escaneo de remito,
wizard de análisis de fluidos, archivo de un certificado antes de "Guardar")
no hay registro todavía, así que se anota en memoria quién lo subió. Ese
registro es **de un proceso**: con más de una instancia y sin afinidad de
sesión, la previsualización de un archivo recién subido puede dar 404. Una vez
guardado el registro real, la resolución por entidad anda en todas.

**Impacto.** Tabla nueva, nada que migrar. Habría que reemplazar el `Map` de
`uploadClaims` por lecturas/escrituras a esta tabla y agregar la purga de
vencidos al barrido que ya existe.

**Riesgo.** Bajo, pero es más código y una escritura extra por upload. **Sólo
vale la pena cuando la API corra en más de una instancia.** Hoy corre en una
(`pm2 cms3`), así que el límite es teórico.

---

## 4. Corte inmediato de access tokens en todas las instancias — no recomendado por ahora

**El problema.** Al cambiar una contraseña se revocan los refresh tokens (eso
sí vale para todas las instancias) y se bajan las sesiones vivas del proceso
que atendió el pedido. Un access token ya emitido **en otra instancia** sigue
sirviendo hasta vencer: **15 minutos como máximo**. La baja y la suspensión
no tienen ese problema — las detecta `enforceLiveTenantSession` releyendo la
membership en cada request.

**Qué haría falta.** Una marca por usuario del estilo `credentialsChangedAt`
en `User`, comparada contra el momento de emisión de cada sesión.

**Por qué no ahora.** Obliga a guardar la fecha de emisión en la sesión y a
comparar en cada request, y hay que tener cuidado de no echar a la gente cada
vez que edita su propio perfil. Con una sola instancia el agujero no existe
(el `Map` es el mismo), y aun con varias son 15 minutos con la contraseña ya
cambiada. Conviene resolverlo junto con el punto 3, si se pasa a varias
instancias.

---

## Fuera de esquema, pero para decidir: `capa-service.ts`

`createCapaInternal` toma un advisory lock así:

```ts
await prisma.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
```

Verificado contra la base el 2026-09-09: **esa llamada siempre falla**.
`pg_advisory_xact_lock()` devuelve `void` y el adaptador de Prisma no sabe
deserializar esa columna ("Failed to deserialize column of type 'void'"). Como
está envuelta en un `try/catch` que tolera motores sin advisory locks, el error
se traga y **el lock nunca se tomó**: el anti-duplicado de CAPA depende sólo
del `findFirst`, que es exactamente la carrera que el lock venía a evitar.

El arreglo es de una línea — usar el helper nuevo:

```ts
import { takeAdvisoryXactLock } from "../../common/advisory-lock";
await takeAdvisoryXactLock(prisma, `${input.tenantId}|${input.sourceType}|${input.sourceId}`);
```

No se aplicó porque CAPA es un módulo dormante y estaba fuera del alcance de
esta auditoría: activar un lock que hoy no existe cambia el comportamiento de
concurrencia de un módulo que no se pidió tocar.

---

# Segunda tanda — correcciones de repuestos, conexión y frontend (2026-09-09)

Lo que sigue se agregó al revisar los hallazgos de stock, permisos, conexión y
caché. **Tampoco está aplicado nada de esto.**

---

## 5. Una sola reserva ACTIVA por línea de solicitud — recomendado

```sql
-- Índice único parcial: Prisma no lo expresa en el schema, va como migración.
CREATE UNIQUE INDEX "StockReservation_one_active_per_item"
    ON "StockReservation" ("requestItemId")
 WHERE "status" = 'ACTIVE';
```

**Por qué.** `createReservationsForRequest` ya no puede crear dos reservas para
la misma línea: reclama el ítem en estado `PENDING` con un `updateMany`
condicionado y el que pierde la carrera cuenta 0. Eso alcanza mientras todas las
escrituras pasen por esa función. El índice lo vuelve una regla de la base:
ningún script de carga, corrección manual ni código futuro puede violarlo.

**Impacto.** Ninguno en el código actual. **Antes de crearlo hay que verificar
que no existan ya duplicados** (los pudo haber dejado el bug):

```sql
SELECT "requestItemId", COUNT(*)
  FROM "StockReservation" WHERE "status" = 'ACTIVE'
 GROUP BY 1 HAVING COUNT(*) > 1;
```

Si devuelve filas, hay que decidir qué hacer con ellas (liberar las sobrantes es
una decisión de negocio, no se toca sin pedido). Con la consulta vacía, el
índice se crea en caliente con `CREATE UNIQUE INDEX CONCURRENTLY`.

**Riesgo.** Bajo si la consulta de arriba no devuelve nada. Si devuelve, la
creación del índice falla — no rompe nada, pero no entra hasta limpiarlo.

> **Verificado en producción el 2026-09-09, después del deploy:** la consulta
> devuelve **0 filas** — el bug no llegó a dejar reservas duplicadas. El índice
> se puede crear sin limpiar nada. Volver a correrla igual antes de aplicarlo,
> porque el dato puede cambiar.

---

## 6. Índice de apoyo para el cálculo de existencias — sólo con medición

```prisma
model StockMovement {
  @@index([spareId, movementType])   // ← evaluar
}
```

**Por qué.** El cálculo de stock pasó de traer todos los movimientos a un
`GROUP BY "spareId", "movementType"`. El índice `@@index([spareId])` que ya
existe alcanza para filtrar; este otro permitiría además agrupar sin ordenar.

**Por qué no ahora.** No está medido. Con el volumen actual el planificador
probablemente elija el índice que ya hay. **Correr `EXPLAIN ANALYZE` de la
consulta agregada antes de agregarlo**: un índice que no se usa igual se
mantiene en cada escritura de movimiento, que es la operación más frecuente del
módulo.

---

## 7. Sesiones compartidas entre instancias (CONC-002) — no aplicar todavía

**El problema.** Los access tokens son opacos y viven en un `Map` del proceso
(`session-store.ts`). Un token emitido por la instancia A no existe en la B: sin
afinidad de sesión, la misma persona recibiría 401 alternando instancias, con
renovaciones repetidas y cierres de sesión.

**Hoy no pasa.** El despliegue corre **una sola instancia**: `railway.toml`
arranca `pnpm start:api` como un proceso y el VPS lo corre con `pm2` sin modo
cluster. El riesgo es de escalabilidad, no un defecto activo.

**Qué NO se hizo, y por qué.** No se migró a JWT ni a tokens autofirmados. Sería
la salida rápida, y rompe lo que hoy funciona bien: con el `Map` más la
revalidación en vivo (`live-session-guard.ts`), dar de baja a alguien o cambiarle
los permisos vale **en el request siguiente**. Un JWT es válido hasta vencer por
definición; recuperar la revocación inmediata exige una lista de revocados, o
sea el mismo almacén compartido que se quería evitar. Cambiar el esquema de
autenticación de un PMS con auditorías encima no es una corrección de auditoría.

**Propuesta concreta, para cuando se pase a varias instancias.**

Almacén compartido de sesiones, conservando el token opaco:

- *Opción A — Redis (recomendada).* `SETEX sess:<token> 900 <json>` al loguear,
  `GET` en `getTenantAccessSession`, `DEL` al revocar. Encaja tal cual con las
  cuatro funciones que ya existen; el `Map` queda como caché de proceso con TTL
  corto (5–10s) para no ir a Redis en cada request. Cuesta una dependencia de
  infraestructura nueva.
- *Opción B — tabla en Postgres.* Sin infraestructura nueva, reusando la purga
  periódica que ya corre. Una lectura indexada por request; hay que medir contra
  el resto de la carga antes de elegirla.

En los dos casos hay que tocar `session-store.ts` entero (las funciones pasan a
ser asíncronas) y todos sus llamadores, incluidos los routers. **Es un cambio
grande y necesita su propia tanda, con pruebas de login/refresh/logout/revocación
en las dos instancias.** Mientras tanto, si hiciera falta escalar ya, la afinidad
de sesión en el balanceador lo sostiene como medida transitoria.

---

## 8. Para decidir (negocio, no código): repuestos dados de baja

La pantalla de Solicitudes sólo ofrece repuestos con `status = ACTIVE`. La
validación nueva del backend comprueba empresa, buque y borrado lógico, pero
**no** el estado: rechazar `OBSOLETE` es una decisión de negocio y bloquearía
solicitudes viejas sobre repuestos dados de baja después.

Falta definir: ¿se puede pedir un repuesto marcado OBSOLETE? Si la respuesta es
que no, es una línea en `spare-request-scope.ts` (`assertSpareLinkable`).
