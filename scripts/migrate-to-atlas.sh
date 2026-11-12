#!/usr/bin/env sh
# Copia la configuración y el catálogo de la base local (contenedor Docker de MongoDB) a MongoDB Atlas.
# NO copia datos de prueba: clientes, prospectos, cotizaciones, contratos, auditoría, sesiones,
# folios ni usuarios (el admin de producción se crea con `user:create`).
#
# Uso (desde la raíz de este repo, con el contenedor local encendido: `docker start reapersys-mongo`):
#   ATLAS_URI='mongodb+srv://usuario:clave@cluster.mongodb.net/' sh scripts/migrate-to-atlas.sh
#
# Variables opcionales:
#   MONGO_CONTAINER  nombre del contenedor local (por defecto: reapersys-mongo)
#   MONGODB_DB_NAME  nombre de la base (por defecto: reapersys)
#
# Las colecciones copiadas se reemplazan en Atlas (--drop); las demás no se tocan.
set -eu

: "${ATLAS_URI:?Define ATLAS_URI con la cadena de conexión de Atlas}"
DB="${MONGODB_DB_NAME:-reapersys}"
CONTAINER="${MONGO_CONTAINER:-reapersys-mongo}"
COLLECTIONS="business_settings categories industries components component_prices compatibility_rules packages package_prices operating_costs suppliers testimonials digital_templates digital_template_images.files digital_template_images.chunks"

if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "El contenedor $CONTAINER no está encendido. Ejecuta: docker start $CONTAINER" >&2
  exit 1
fi

INCLUDE=""
for c in $COLLECTIONS; do INCLUDE="$INCLUDE --nsInclude=$DB.$c"; done

BACKUP="respaldo-local-$(date +%Y%m%d-%H%M%S).archive"
echo "Respaldando la base local en $BACKUP ..."
# Dentro del contenedor mongod escucha en 27017 (el 27018 es solo el puerto publicado en el host).
# mongodump no filtra varias colecciones; el filtro se aplica al restaurar (--nsInclude).
docker exec "$CONTAINER" mongodump --quiet --port 27017 --db "$DB" --archive > "$BACKUP"

echo "Cargando en Atlas (base $DB) ..."
# shellcheck disable=SC2086
docker exec -i -e ATLAS_URI="$ATLAS_URI" "$CONTAINER" sh -c "mongorestore --uri \"\$ATLAS_URI\" --archive --drop $INCLUDE" < "$BACKUP"

echo "Listo. Siguiente paso en producción: db:indexes y user:create. El respaldo quedó en $BACKUP."
