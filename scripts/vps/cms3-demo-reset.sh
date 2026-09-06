#!/bin/bash
# Reseteo de la instancia de PRACTICA (demo.cms3.shipcms.cloud).
#
# Deja la demo exactamente como quedo el dia que se armo: borra la base de
# practica entera, la rehace desde la plantilla y devuelve los adjuntos a su
# estado original. Lo que la gente cargo practicando desaparece.
#
# NO PUEDE TOCAR PRODUCCION: solo nombra cms3demo, y antes de borrar verifica
# que ese nombre no sea el de la base real que usa la app.
#
# Uso:  cms3-demo-reset.sh          (lo llama el cron todas las noches)
set -euo pipefail

DEMO_DB="cms3demo"
DEMO_APP="cms3-demo"
PLANTILLA="/root/backups-cms3/demo/plantilla.dump"
UPLOADS_PLANTILLA="/root/backups-cms3/demo/uploads-plantilla/"
UPLOADS_VIVO="/app-cms3-demo/apps/api/uploads/"
LOG="/var/log/cms3-demo-reset.log"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# ── Guarda: la base de la app real NO puede llamarse igual que la de practica ──
PROD_DB=$(sed -n 's|^DATABASE_URL=.*/\([^?]*\).*|\1|p' /app-cms3/.env)
if [ "$PROD_DB" = "$DEMO_DB" ]; then
  log "ABORTADO: la base de produccion se llama '$PROD_DB', igual que la de practica."
  exit 1
fi

[ -f "$PLANTILLA" ] || { log "ABORTADO: falta la plantilla $PLANTILLA"; exit 1; }
[ -d "$UPLOADS_PLANTILLA" ] || { log "ABORTADO: falta la plantilla de adjuntos"; exit 1; }

DEMO_PASS=$(cat /root/.cms3demo-dbpass)

log "=== reseteo de la demo ==="

log "1/5 parando la app de practica"
pm2 stop "$DEMO_APP" >/dev/null

log "2/5 rehaciendo la base $DEMO_DB"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DROP DATABASE IF EXISTS ${DEMO_DB} WITH (FORCE);
CREATE DATABASE ${DEMO_DB} OWNER ${DEMO_DB};
GRANT ALL ON DATABASE ${DEMO_DB} TO ${DEMO_DB};
REVOKE ALL ON DATABASE ${DEMO_DB} FROM PUBLIC;
SQL

log "3/5 restaurando la plantilla"
PGPASSWORD="$DEMO_PASS" pg_restore -h 127.0.0.1 -U "$DEMO_DB" -d "$DEMO_DB" \
  --no-owner --no-privileges "$PLANTILLA" >>"$LOG" 2>&1

TABLAS=$(PGPASSWORD="$DEMO_PASS" psql -h 127.0.0.1 -U "$DEMO_DB" -d "$DEMO_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema()")
if [ "$TABLAS" -lt 50 ]; then
  log "ABORTADO: la restauracion dejo solo $TABLAS tablas (se esperaban ~100)"
  pm2 start "$DEMO_APP" >/dev/null
  exit 1
fi
log "    $TABLAS tablas restauradas"

log "4/5 devolviendo los adjuntos a su estado original"
rsync -a --delete "$UPLOADS_PLANTILLA" "$UPLOADS_VIVO"

log "5/5 levantando la app de practica"
pm2 start "$DEMO_APP" >/dev/null
sleep 8
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3107/app/health || echo 000)
if [ "$CODIGO" = "200" ]; then
  log "=== demo reseteada y en linea ==="
else
  log "!!! la demo NO respondio despues del reseteo (HTTP $CODIGO) — revisar pm2 logs $DEMO_APP"
  exit 1
fi
