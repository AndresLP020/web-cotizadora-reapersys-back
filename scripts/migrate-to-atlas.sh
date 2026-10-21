#!/usr/bin/env sh
# Copia la configuración y el catálogo de la base local (Docker, puerto 27018) a MongoDB Atlas.
# NO copia datos de prueba: clientes, prospectos, cotizaciones, contratos, auditoría, sesiones,
# folios ni usuarios (el admin de producción se crea con `user:create`).
#
# Uso (desde la raíz del repo, con `npm run db:up` activo):
#   ATLAS_URI='mongodb+srv://usuario:clave@cluster.mongodb.net/' sh backend/scripts/migrate-to-atlas.sh
#
# Las colecciones copiadas se reemplazan en Atlas (--drop); las demás no se tocan.
set -eu

: "${ATLAS_URI:?Define ATLAS_URI con la cadena de conexión de Atlas}"
DB="${MONGODB_DB_NAME:-reapersys}"
COLLECTIONS="business_settings categories industries components component_prices compatibility_rules packages package_prices operating_costs suppliers testimonials"

INCLUDE=""
for c in $COLLECTIONS; do INCLUDE="$INCLUDE --nsInclude=$DB.$c"; done

BACKUP="respaldo-local-$(date +%Y%m%d-%H%M%S).archive"
echo "Respaldando la base local en $BACKUP ..."
# mongodump no filtra varias colecciones; el filtro se aplica al restaurar (--nsInclude).
docker compose exec -T mongo mongodump --quiet --port 27018 --db "$DB" --archive > "$BACKUP"

echo "Cargando en Atlas (base $DB) ..."
# shellcheck disable=SC2086
docker compose exec -T -e ATLAS_URI="$ATLAS_URI" mongo sh -c "mongorestore --uri \"\$ATLAS_URI\" --archive --drop $INCLUDE" < "$BACKUP"

echo "Listo. Siguiente paso en producción: db:indexes y user:create. El respaldo quedó en $BACKUP."
