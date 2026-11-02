const { randomUUID } = require('crypto');
function createSnapshotStore({
  ttl = 30 * 60 * 1000,
  maxBytes = 64 * 1024 * 1024,
  maxEntries = 50,
  now = Date.now,
} = {}) {
  const entries = new Map();
  let bytes = 0;
  const remove = (id) => {
    const item = entries.get(id);
    if (item) bytes -= item.bytes;
    entries.delete(id);
  };
  const purge = () => {
    for (const [id, item] of entries) if (item.expires <= now()) remove(id);
  };
  return {
    put(owner, report) {
      purge();
      const id = randomUUID();
      const expires = now() + ttl;
      const data = {
        ...report,
        snapshot_id: id,
        expira_en: new Date(expires).toISOString(),
      };
      const json = JSON.stringify(data);
      const size = Buffer.byteLength(json);
      if (size > maxBytes) {
        const e = new Error(
          'El reporte supera el tamaño disponible. Seleccione un período menor.'
        );
        e.status = 413;
        throw e;
      }
      while (
        entries.size &&
        (bytes + size > maxBytes || entries.size >= maxEntries)
      )
        remove(entries.keys().next().value);
      entries.set(id, { owner: String(owner), expires, json, bytes: size });
      bytes += size;
      return JSON.parse(json);
    },
    get(owner, id) {
      purge();
      const entry = entries.get(id);
      if (!entry || entry.owner !== String(owner)) {
        const e = new Error(
          'La versión del reporte venció o no está disponible. Actualice la pantalla y descargue nuevamente.'
        );
        e.status = 410;
        throw e;
      }
      return JSON.parse(entry.json);
    },
  };
}
module.exports = { createSnapshotStore };
