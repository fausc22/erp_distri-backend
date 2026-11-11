const { centavos } = require('../dominio/calculo/documento');
const norm = (value) => String(value ?? '').trim().toUpperCase();

/** Suma monetaria exacta vía string centavos (evita Number para agregación). */
function moneyToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const n = Number(centavos(value));
    if (!Number.isSafeInteger(n)) throw new Error('Importe fuera del rango monetario seguro');
    return n;
  } catch (e) { return null; }
}

function centsToMoney(cents) {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

function sumMoneyField(rows, field) {
  let total = 0;
  let unknown = 0;
  for (const row of rows) {
    const cents = moneyToCents(row[field]);
    if (cents === null) {
      unknown += 1;
      continue;
    }
    total += cents;
    if (!Number.isSafeInteger(total)) throw new Error('Total fuera del rango monetario seguro');
  }
  return { total: centsToMoney(total), total_cents: total, desconocidos: unknown };
}

const fiscales = new Set(['A', 'B']);
const estadosPendientes = new Set(['SIN_SOLICITUD', 'EN_CURSO', 'RECHAZADO', 'DESCONOCIDO']);

function totalGerencial(rows = []) {
  const acc = {
    total_cents: 0,
    ab_cents: 0,
    x_cents: 0,
    otros_cents: 0,
    documentos: 0,
    facturas: 0,
    notas_credito: 0,
    notas_debito: 0,
    desconocidos: 0
  };
  for (const row of rows) {
    const cents = moneyToCents(row.total_firmado);
    acc.documentos += 1;
    acc.facturas += norm(row.tipo_doc) === 'FACTURA' ? 1 : 0;
    acc.notas_credito += norm(row.tipo_doc) === 'NOTA_CREDITO' ? 1 : 0;
    acc.notas_debito += norm(row.tipo_doc) === 'NOTA_DEBITO' ? 1 : 0;
    if (cents === null) {
      acc.desconocidos += 1;
      continue;
    }
    acc.total_cents += cents;
    if (fiscales.has(norm(row.tipo_f))) acc.ab_cents += cents;
    else if (norm(row.tipo_f) === 'X') acc.x_cents += cents;
    else acc.otros_cents += cents;
  }
  return {
    total: Number(centsToMoney(acc.total_cents)),
    ab: Number(centsToMoney(acc.ab_cents)),
    x: Number(centsToMoney(acc.x_cents)),
    otros: Number(centsToMoney(acc.otros_cents)),
    documentos: acc.documentos,
    facturas: acc.facturas,
    notas_credito: acc.notas_credito,
    notas_debito: acc.notas_debito,
    desconocidos: acc.desconocidos
  };
}

function agrupar(rows, keyFn, labelFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) ?? 'SIN_ID';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([id, values]) => ({
      id,
      nombre: labelFn(values[0]),
      ...totalGerencial(values)
    }))
    .sort((a, b) => b.total - a.total);
}

function porVendedor(rows = []) {
  return agrupar(rows, (row) => row.vendedor_id, (row) => row.vendedor_nombre || 'Sin vendedor');
}

/**
 * Medidas del libro: cabecera persistida (subtotal/iva/total con signo).
 * Sin evidencia canónica de migraciones; CAE en ventas marca autorización.
 */
function enriquecerMedidaFiscal(row) {
  const comercialNeto = row.subtotal_firmado;
  const comercialIva = row.iva_firmado;
  const comercialTotal = row.total_firmado;

  return {
    ...row,
    importe_comercial: row.importe_comercial != null ? row.importe_comercial : row.total,
    importe_fiscal_respaldado: null,
    diferencia_comercial_fiscal: null,
    calidad_importe_fiscal: 'SIN_EVIDENCIA',
    medida_neto: comercialNeto,
    medida_iva: comercialIva,
    medida_total: comercialTotal,
    comercial_neto: comercialNeto,
    comercial_iva: comercialIva,
    comercial_total: comercialTotal,
    evidencia_incompleta: false,
    discrepante: false
  };
}

/** Fecha del libro: YYYY-MM-DD (misma que se imprime cuando viene comercial). */
function normalizarFechaLibro(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return s;
}

/** Desglosa "A 0004-00001991" o "0004-00096" para orden numérico estable. */
function parseNumeroComprobanteLibro(numero) {
  const s = String(numero || '').trim();
  let match = s.match(/^[A-Z]+\s+(\d{4})-(\d+)$/i);
  if (match) {
    return { ptoVta: parseInt(match[1], 10), nro: parseInt(match[2], 10) };
  }
  match = s.match(/^(\d{4})-(\d+)$/);
  if (match) {
    return { ptoVta: parseInt(match[1], 10), nro: parseInt(match[2], 10) };
  }
  match = s.match(/(\d+)\s*$/);
  return { ptoVta: 0, nro: match ? parseInt(match[1], 10) : 0 };
}

function ordenTipoDocLibro(tipoDoc) {
  const t = norm(tipoDoc);
  if (t === 'FACTURA' || t === '') return 0;
  if (t === 'NOTA_DEBITO' || t === 'NOTA DEBITO') return 1;
  if (t === 'NOTA_CREDITO' || t === 'NOTA CREDITO') return 2;
  return 3;
}

/**
 * Orden de presentación del Libro IVA:
 * 1) fecha comercial ASC (misma que imprime el PDF)
 * 2) tipo de comprobante (Factura → ND → NC)
 * 3) letra A/B, punto de venta y número ASC
 */
function compararFilasLibroIva(a, b) {
  const fechaA = normalizarFechaLibro(
    a.fecha_comercial || a.fecha_revision || a.fecha || a.fecha_fiscal_acreditada
  );
  const fechaB = normalizarFechaLibro(
    b.fecha_comercial || b.fecha_revision || b.fecha || b.fecha_fiscal_acreditada
  );
  if (fechaA !== fechaB) return fechaA.localeCompare(fechaB);

  const tipoCmp = ordenTipoDocLibro(a.tipo_doc) - ordenTipoDocLibro(b.tipo_doc);
  if (tipoCmp !== 0) return tipoCmp;

  const letraCmp = String(a.tipo_f || '').localeCompare(String(b.tipo_f || ''));
  if (letraCmp !== 0) return letraCmp;

  const numA = parseNumeroComprobanteLibro(a.numero_factura || a.numero);
  const numB = parseNumeroComprobanteLibro(b.numero_factura || b.numero);
  if (numA.ptoVta !== numB.ptoVta) return numA.ptoVta - numB.ptoVta;
  if (numA.nro !== numB.nro) return numA.nro - numB.nro;

  return Number(a.venta_id || a.id || 0) - Number(b.venta_id || b.id || 0);
}

function libroIvaRevision(rows = []) {
  const acreditados = [];
  const discrepantes = [];
  const seccionPendientes = [];
  const evidenciaIncompleta = [];

  for (const raw of rows) {
    if (!fiscales.has(norm(raw.tipo_f))) continue;
    const row = enriquecerMedidaFiscal(raw);
    const estadoFiscal = norm(row.estado_fiscal);

    if (estadoFiscal === 'AUTORIZADO') {
      acreditados.push({
        ...row,
        seccion: 'ACREDITADOS',
        fecha_revision: row.fecha_fiscal_acreditada || row.fecha_imputacion || row.fecha_comercial,
        neto_presentacion: row.comercial_neto,
        iva_presentacion: row.comercial_iva,
        total_presentacion: row.comercial_total,
        verificado: true
      });
    } else {
      seccionPendientes.push({
        ...row,
        seccion: 'PENDIENTES',
        fecha_revision: row.fecha_comercial,
        neto_presentacion: null,
        iva_presentacion: null,
        total_presentacion: null,
        neto_provisional: row.comercial_neto,
        iva_provisional: row.comercial_iva,
        total_provisional: row.comercial_total,
        verificado: false
      });
    }
  }

  return {
    acreditados: acreditados.sort(compararFilasLibroIva),
    discrepantes: discrepantes.sort(compararFilasLibroIva),
    evidenciaIncompleta: evidenciaIncompleta.sort(compararFilasLibroIva),
    seccionPendientes: seccionPendientes.sort(compararFilasLibroIva),
    totalesAcreditados: {
      ...sumMoneyField(acreditados.filter((r) => r.total_presentacion != null), 'total_presentacion'),
      neto: sumMoneyField(acreditados.filter((r) => r.neto_presentacion != null), 'neto_presentacion'),
      iva: sumMoneyField(acreditados.filter((r) => r.iva_presentacion != null), 'iva_presentacion'),
    },
    totalesPendientes: {
      comercial: sumMoneyField(seccionPendientes, 'total_provisional'),
    }
  };
}

function pendientesFiscales(rows = []) {
  return rows.filter((row) => fiscales.has(norm(row.tipo_f)) && estadosPendientes.has(norm(row.estado_fiscal)));
}

function xInterno(rows = []) {
  return rows.filter((row) => norm(row.tipo_f) === 'X');
}

function segmentos(rows = []) {
  return agrupar(rows, (row) => row.segmento || 'sin_segmento', (row) => row.segmento || 'sin_segmento');
}

module.exports = {
  totalGerencial,
  porVendedor,
  libroIvaRevision,
  compararFilasLibroIva,
  parseNumeroComprobanteLibro,
  normalizarFechaLibro,
  pendientesFiscales,
  xInterno,
  segmentos,
  moneyToCents,
  centsToMoney,
  sumMoneyField,
  enriquecerMedidaFiscal
};
