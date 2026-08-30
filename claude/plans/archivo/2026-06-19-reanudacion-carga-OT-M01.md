# Reanuación: Generación de OTs M01

**Estado:** Token expiró después de 2 de 183 OTs. Script pausado e idempotente.

## Qué pasó
- Ejecutó 2 OTs (M01-MP-BR-09, M01-MA-ER-11) correctamente
- Token se expiró en mitad de la ejecución (sesiones en memoria del server)
- Script detectó 401, abortó limpio, guardó progreso en `wo_results.json`

## Para reanudar (una sola línea)

1. Obtén un token vigente:
   - Abrí https://mercurio.cms3.shipcms.cloud logueado
   - DevTools (F12) → Console → `copy(localStorage.getItem('gpms_token'))`
   - Copiá el valor

2. Ejecutá:
```bash
GPMS_TOKEN=<pega-aqui-el-token> npx tsx scripts/simulate-wo-history.ts --live
```

El script:
- Detectará las 2 OTs ya existentes (dedupe automático)
- Reanudará desde la OT #3
- Continuará hasta terminar todas 183

**Estimado:** 10-15 minutos (≈915 llamadas × 0.3s sleep cada una)

## Después de terminar el --live
1. Copiá `wo_results.json` al VPS:
   ```bash
   scp wo_results.json gpms-vps:/app-cms3/
   ```

2. En el VPS, backdatea timestamps (retro-fecha openDate/aprobadoAt/etc al día simulado):
   ```bash
   ssh gpms-vps
   cd /app-cms3
   export DATABASE_URL="postgresql://..."  # prod URL
   npx tsx scripts/backdate-wos-bulk.ts wo_results.json
   ```
   (La DATABASE_URL está en el VPS en archivo .env o 1password)

## Si algo sale mal
- El script es **idempotente**: reintentá con token nuevo, no duplica.
- Verificá el estado con: `jq .ok wo_results.json | wc -l` (cuántas OTs OK)
- Logs completos en la consola — reportalos si hay errores reales (no auth).
