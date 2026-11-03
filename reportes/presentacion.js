const { cents, decimal } = require('./money');

/** Absorbe el balde "pendiente" en "normales" solo para presentación gerencial. */
function absorverPendienteResumen(resumen) {
  if (!resumen) return resumen;
  const normal = cents(resumen.normal) + cents(resumen.pendiente || '0.00');
  return {
    ...resumen,
    normal: decimal(normal),
    pendiente: '0.00',
    documentos_pendientes: 0,
  };
}

function absorverPendienteGrupo(row) {
  if (!row) return row;
  const normal = cents(row.normal) + cents(row.pendiente || '0.00');
  return {
    ...row,
    normal: decimal(normal),
    pendiente: '0.00',
    documentos_pendientes: 0,
  };
}

const NOMBRES_MES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** Completa los 12 meses del año calendario (ceros si no hubo actividad). */
function padMesesAnuales(meses, anio) {
  const byId = new Map((meses || []).map((m) => [m.id, m]));
  const out = [];
  for (let i = 1; i <= 12; i += 1) {
    const id = `${anio}-${String(i).padStart(2, '0')}`;
    const existing = byId.get(id);
    if (existing) {
      out.push({
        ...absorverPendienteGrupo(existing),
        nombre: `${NOMBRES_MES[i - 1]} ${anio}`,
      });
    } else {
      out.push({
        id,
        nombre: `${NOMBRES_MES[i - 1]} ${anio}`,
        total: '0.00',
        normal: '0.00',
        flete: '0.00',
        pendiente: '0.00',
        facturas: 0,
        notas_debito: 0,
        notas_credito: 0,
        documentos: 0,
      });
    }
  }
  return out;
}

function topClientes(documentos, limit = 10) {
  const groups = new Map();
  for (const doc of documentos || []) {
    const id =
      doc.cliente_id != null ? String(doc.cliente_id) : `nombre:${doc.cliente}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        nombre: doc.cliente || 'Sin cliente',
        documentos: 0,
        total: 0n,
      });
    }
    const g = groups.get(id);
    g.documentos += 1;
    g.total += cents(doc.total);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, total: decimal(g.total) }))
    .sort((a, b) =>
      cents(a.total) === cents(b.total)
        ? String(a.id).localeCompare(String(b.id))
        : cents(a.total) > cents(b.total)
          ? -1
          : 1
    )
    .slice(0, limit);
}

function etiquetaMes(yyyyMm) {
  const [y, m] = String(yyyyMm).split('-');
  const idx = Number(m) - 1;
  return `${NOMBRES_MES[idx] || m} ${y}`;
}

module.exports = {
  absorverPendienteResumen,
  absorverPendienteGrupo,
  padMesesAnuales,
  topClientes,
  etiquetaMes,
  NOMBRES_MES,
};
