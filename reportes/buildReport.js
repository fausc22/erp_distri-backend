const { cents, roundedDivision, serialize } = require('./money');
const norm = (value) =>
  String(value ?? '')
    .trim()
    .toUpperCase();
const docType = (value) => norm(value).replace(/\s+/g, '_');
const inRange = (date, p) => date && date >= p.desde && date <= p.hasta;
const types = ['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO'];
const eligible = (row) =>
  norm(row.estado) === 'FACTURADA' && types.includes(docType(row.tipo_doc));
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0n);
const text = (s, fallback) => String(s ?? '').trim() || fallback;
function segment(row) {
  if (Number(row.fletes) > 0) return 'flete';
  if (docType(row.tipo_doc) !== 'FACTURA') {
    if (
      !row.referencia_id ||
      !Number(row.referencia_lineas) ||
      Number(row.referencia_sin_nombre)
    )
      return 'pendiente';
    return Number(row.referencia_fletes) > 0 ? 'flete' : 'normal';
  }
  return !Number(row.lineas) || Number(row.sin_nombre) ? 'pendiente' : 'normal';
}
function document(row) {
  const tipo = docType(row.tipo_doc);
  const sign = tipo === 'NOTA_CREDITO' ? -1n : 1n;
  const isNote = tipo !== 'FACTURA';
  const alerts = [];
  const total = cents(row.total) * sign;
  const neto = cents(row.subtotal) * sign;
  const iva = cents(row.iva_total) * sign;
  const lineTotal =
    (cents(row.neto_lineas ?? '0') + cents(row.iva_lineas ?? '0')) * sign;
  if (!Number(row.lineas)) alerts.push('SIN_DETALLE');
  if (Number(row.sin_nombre)) alerts.push('LINEA_SIN_NOMBRE');
  if (lineTotal !== total) alerts.push('DIFERENCIA_CABECERA_LINEAS');
  if (isNote && !row.referencia_id) alerts.push('NOTA_SIN_REFERENCIA');
  if (segment(row) === 'pendiente') alerts.push('CLASIFICACION_PENDIENTE');
  if (
    row.cae_resultado &&
    norm(row.cae_resultado) !== 'A' &&
    ['A', 'B'].includes(norm(row.tipo_f))
  )
    alerts.push('REVISAR_RESULTADO_FISCAL');
  const sellerId =
    isNote && row.referencia_id ? row.referencia_empleado_id : row.empleado_id;
  const seller =
    isNote && row.referencia_id
      ? row.referencia_empleado_nombre
      : row.empleado_nombre;
  if (
    segment(row) === 'flete' &&
    !norm(seller)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .includes('MARTIN')
  )
    alerts.push('FLETE_REVISAR_VENDEDOR');
  return {
    id: row.id,
    numero: row.numero_factura || `ID ${row.id}`,
    fecha: row.fecha_fiscal,
    fecha_comercial: row.fecha_comercial,
    tipo,
    fiscal: norm(row.tipo_f) || 'SIN_TIPO',
    segmento: segment(row),
    vendedor_id: sellerId ?? null,
    vendedor: text(seller, 'Sin vendedor'),
    vendedor_emisor: text(row.empleado_nombre, 'Sin vendedor'),
    cliente_id: row.cliente_id,
    cliente: text(row.cliente_nombre, 'Sin cliente'),
    ciudad: text(row.cliente_ciudad, 'Sin ciudad'),
    provincia: text(row.cliente_provincia, 'Sin provincia'),
    cuenta_id: row.cuenta_id,
    referencia_id: row.referencia_id,
    total,
    neto,
    iva,
    exento: cents(row.exento ?? '0') * sign,
    ajuste_lineas: total - lineTotal,
    alertas: alerts,
  };
}
function summary(rows) {
  const facturas = rows.filter((r) => r.tipo === 'FACTURA');
  return {
    total: sum(rows, 'total'),
    normal: sum(
      rows.filter((r) => r.segmento === 'normal'),
      'total'
    ),
    flete: sum(
      rows.filter((r) => r.segmento === 'flete'),
      'total'
    ),
    pendiente: sum(
      rows.filter((r) => r.segmento === 'pendiente'),
      'total'
    ),
    documentos_pendientes: rows.filter((r) => r.segmento === 'pendiente')
      .length,
    ab: sum(
      rows.filter((r) => ['A', 'B'].includes(r.fiscal)),
      'total'
    ),
    x: sum(
      rows.filter((r) => r.fiscal === 'X'),
      'total'
    ),
    otros: sum(
      rows.filter((r) => !['A', 'B', 'X'].includes(r.fiscal)),
      'total'
    ),
    neto: sum(rows, 'neto'),
    iva: sum(rows, 'iva'),
    documentos: rows.length,
    facturas: facturas.length,
    notas_credito: rows.filter((r) => r.tipo === 'NOTA_CREDITO').length,
    notas_debito: rows.filter((r) => r.tipo === 'NOTA_DEBITO').length,
    creditos: sum(
      rows.filter((r) => r.tipo === 'NOTA_CREDITO'),
      'total'
    ),
    ticket_factura: roundedDivision(sum(facturas, 'total'), facturas.length),
    clientes: new Set(
      rows.filter((r) => r.cliente_id != null).map((r) => r.cliente_id)
    ).size,
  };
}
function grouped(rows, key, label) {
  const total = sum(rows, 'total');
  const groups = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return [...groups]
    .map(([id, values]) => {
      const aggregate = summary(values);
      return {
        id,
        nombre: label(values[0]),
        ...aggregate,
        porcentaje_total:
          total > 0n ? decimalPercent(aggregate.total, total) : null,
      };
    })
    .sort((a, b) =>
      a.total === b.total
        ? String(a.id).localeCompare(String(b.id))
        : a.total > b.total
          ? -1
          : 1
    );
}
function buildReport(
  raw,
  p,
  generatedAt = raw.capturado_en || new Date().toISOString()
) {
  const current = raw.documents
    .filter((r) => eligible(r) && inRange(r.fecha_fiscal, p))
    .map(document);
  const previous = raw.documents
    .filter((r) => eligible(r) && inRange(r.fecha_fiscal, p.anterior))
    .map(document);
  const s = summary(current);
  const before = summary(previous);
  const todayParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Cordoba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(generatedAt))
      .map((r) => [r.type, r.value])
  );
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const comparable = p.hasta < today;
  const byId = new Map(current.map((r) => [r.id, r]));
  const lines = raw.lines
    .filter((r) => byId.has(r.venta_id))
    .map((r) => {
      const parent = byId.get(r.venta_id);
      const sign = parent.tipo === 'NOTA_CREDITO' ? -1n : 1n;
      // La BD guarda cantidad DECIMAL(10,1): acumulamos décimos enteros, no floats.
      const tenths = Number(String(r.cantidad).replace(/\.0$/, '')) * 10;
      if (
        !Number.isSafeInteger(Math.round(tenths)) ||
        Math.abs(tenths - Math.round(tenths)) > 0.00001
      )
        throw new Error('Cantidad inválida');
      return {
        id: r.id,
        documento_id: parent.id,
        numero: parent.numero,
        fecha: parent.fecha,
        producto_id: r.producto_id,
        producto: text(r.producto_nombre, 'Sin nombre'),
        unidad: text(r.producto_um, 'Sin unidad'),
        cantidad_decimos: Math.round(tenths) * Number(sign),
        neto: cents(r.subtotal) * sign,
        iva: cents(r.iva) * sign,
        total_linea: (cents(r.subtotal) + cents(r.iva)) * sign,
        es_flete: norm(r.producto_nombre).includes('FLETE'),
        segmento: parent.segmento,
        cliente: parent.cliente,
        vendedor: parent.vendedor,
      };
    });
  const products = new Map();
  for (const line of lines) {
    const key = `${line.producto_id ?? `nombre:${line.producto}`}|${line.unidad}`;
    if (!products.has(key))
      products.set(key, {
        id: key,
        nombre: line.producto,
        unidad: line.unidad,
        cantidad_decimos: 0,
        neto: 0n,
        iva: 0n,
        total_linea: 0n,
        documentos: new Set(),
      });
    const group = products.get(key);
    group.cantidad_decimos += line.cantidad_decimos;
    group.neto += line.neto;
    group.iva += line.iva;
    group.total_linea += line.total_linea;
    group.documentos.add(line.documento_id);
  }
  const productRows = [...products.values()]
    .map((r) => ({
      ...r,
      cantidad: (r.cantidad_decimos / 10).toFixed(1),
      documentos: r.documentos.size,
    }))
    .sort(
      (a, b) =>
        b.cantidad_decimos - a.cantidad_decimos || a.id.localeCompare(b.id)
    );
  const monthly = grouped(
    current,
    (r) => r.fecha.slice(0, 7),
    (r) => r.fecha.slice(0, 7)
  ).sort((a, b) => a.id.localeCompare(b.id));
  const sellers = grouped(
    current,
    (r) => String(r.vendedor_id ?? 'sin-vendedor'),
    (r) => r.vendedor
  );
  const cities = grouped(
    current,
    (r) => JSON.stringify([r.ciudad, r.provincia]),
    (r) => `${r.ciudad}, ${r.provincia}`
  );
  // Conciliación de los criterios del libro y listado existentes, sin modificarlos.
  const fiscalRows = raw.documents.filter(
    (r) => inRange(r.fecha_fiscal, p) && ['A', 'B'].includes(norm(r.tipo_f))
  );
  const ivaTotal = fiscalRows.reduce(
    (n, r) =>
      n + cents(r.total) * (docType(r.tipo_doc) === 'NOTA_CREDITO' ? -1n : 1n),
    0n
  );
  const reconciliation = raw.documents
    .filter((r) => inRange(r.fecha_fiscal, p) || inRange(r.fecha_comercial, p))
    .map((r) => {
      const type = norm(r.tipo_doc ?? 'FACTURA');
      const sign = type === 'NOTA_CREDITO' ? -1n : 1n;
      const reportAmount = byId.has(r.id) ? byId.get(r.id).total : 0n;
      const inBook =
        inRange(r.fecha_fiscal, p) && ['A', 'B'].includes(norm(r.tipo_f));
      const inCommercial =
        inRange(r.fecha_comercial, p) &&
        ['FACTURADA', 'FACTURADO'].includes(norm(r.estado ?? 'FACTURADA')) &&
        types.includes(type) &&
        (type === 'FACTURA'
          ? r.empleado_id != null
          : r.referencia_empleado_id != null);
      const reasons = [];
      if (!eligible(r)) reasons.push('Estado/tipo fuera del reporte');
      if (r.fecha_fiscal !== r.fecha_comercial)
        reasons.push('Fecha fiscal distinta de comercial');
      if (!['A', 'B'].includes(norm(r.tipo_f)))
        reasons.push('Fuera del libro IVA A/B');
      if (['A', 'B'].includes(norm(r.tipo_f)))
        reasons.push('Listado comercial usa subtotal sin IVA');
      if (type !== 'FACTURA')
        reasons.push(
          r.referencia_id
            ? 'Vendedor imputado de factura original'
            : 'Nota sin referencia válida'
        );
      return {
        id: r.id,
        numero: r.numero_factura || `ID ${r.id}`,
        fecha: r.fecha_fiscal,
        fecha_comercial: r.fecha_comercial,
        en_reporte: byId.has(r.id),
        en_libro: !!inBook,
        en_listado: !!inCommercial,
        reporte: reportAmount,
        libro: inBook ? cents(r.total) * sign : 0n,
        comercial: inCommercial
          ? cents(['A', 'B'].includes(norm(r.tipo_f)) ? r.subtotal : r.total) *
            sign
          : 0n,
        vendedor_id:
          type === 'FACTURA' ? r.empleado_id : r.referencia_empleado_id,
        vendedor:
          type === 'FACTURA'
            ? text(r.empleado_nombre, 'Sin vendedor')
            : text(r.referencia_empleado_nombre, 'Sin vendedor'),
        razones: reasons,
      };
    });
  const commercialGroups = new Map();
  for (const r of reconciliation.filter((r) => r.en_listado)) {
    const id = String(r.vendedor_id);
    if (!commercialGroups.has(id))
      commercialGroups.set(id, {
        id,
        nombre: r.vendedor,
        total: 0n,
        documentos: 0,
      });
    const item = commercialGroups.get(id);
    item.total += r.comercial;
    item.documentos++;
  }
  const movements = raw.movements.map((r) => ({
    ...r,
    monto: cents(r.monto),
    transferencia: norm(r.origen) === 'TRANSFERENCIA',
  }));
  const accounts = new Map();
  for (const r of movements) {
    const id = String(r.cuenta_id);
    if (!accounts.has(id))
      accounts.set(id, {
        id,
        nombre: r.cuenta,
        ingresos: 0n,
        egresos: 0n,
        transferencias_entrada: 0n,
        transferencias_salida: 0n,
        variacion: 0n,
        movimientos: 0,
      });
    const item = accounts.get(id);
    const incoming = r.tipo === 'INGRESO';
    item[
      r.transferencia
        ? incoming
          ? 'transferencias_entrada'
          : 'transferencias_salida'
        : incoming
          ? 'ingresos'
          : 'egresos'
    ] += r.monto;
    item.variacion += incoming ? r.monto : -r.monto;
    item.movimientos++;
  }
  const purchases = raw.purchases.map((r) => ({ ...r, total: cents(r.total) }));
  const expenses = raw.expenses.map((r) => ({ ...r, monto: cents(r.monto) }));
  const purchaseTotal = sum(
    purchases.filter((r) => ['Registrada', 'Confirmada'].includes(r.estado)),
    'total'
  );
  const expenseTotal = sum(expenses, 'monto');
  const accountRows = [...accounts.values()];
  const descriptions = {
    SIN_DETALLE: 'Comprobante sin detalle de productos',
    LINEA_SIN_NOMBRE: 'Línea sin descripción',
    DIFERENCIA_CABECERA_LINEAS:
      'Ajuste entre total final y líneas (descuento, redondeo u otra diferencia)',
    NOTA_SIN_REFERENCIA: 'Nota sin factura de referencia válida',
    CLASIFICACION_PENDIENTE: 'Clasificación de flete pendiente',
    REVISAR_RESULTADO_FISCAL: 'Revisar resultado de autorización fiscal',
    FLETE_REVISAR_VENDEDOR:
      'Documento con flete imputado a un vendedor distinto de Martín',
  };
  const quality = current
    .flatMap((r) =>
      r.alertas.map((code) => ({
        documento_id: r.id,
        numero: r.numero,
        codigo: code,
        descripcion: descriptions[code],
        nivel:
          code === 'DIFERENCIA_CABECERA_LINEAS' &&
          r.ajuste_lineas >= -100n &&
          r.ajuste_lineas <= 100n
            ? 'Informativo: diferencia de hasta $1'
            : 'Revisar',
        importe: r.total,
        diferencia: r.ajuste_lineas,
      }))
    )
    .sort(
      (a, b) =>
        Number(b.nivel === 'Revisar') - Number(a.nivel === 'Revisar') ||
        a.documento_id - b.documento_id
    );
  const qualitySummary = [...new Set(quality.map((r) => r.codigo))].map(
    (code) => ({
      codigo: code,
      descripcion: descriptions[code],
      cantidad: quality.filter((r) => r.codigo === code).length,
    })
  );
  const insights = [];
  if (!current.length)
    insights.push('No hay comprobantes elegibles en este período.');
  if (s.documentos_pendientes)
    insights.push(
      `${s.documentos_pendientes} comprobantes requieren clasificación. El total los incluye; no se certifica todavía la separación normales/fletes.`
    );
  if (quality.some((r) => r.codigo === 'DIFERENCIA_CABECERA_LINEAS'))
    insights.push(
      'Hay diferencias entre cabeceras y líneas. La facturación usa el importe final guardado; el detalle de productos no distribuye ajustes globales.'
    );
  if (s.flete < 0n)
    insights.push(
      'El importe neto de fletes es negativo. Revisar las notas de crédito del período, que pueden corresponder a ventas anteriores.'
    );
  if (s.notas_credito)
    insights.push(
      `El período incluye ${s.notas_credito} notas de crédito, descontadas de la facturación.`
    );
  if (sellers.length)
    insights.push(
      `Mayor facturación neta por vendedor: ${sellers[0].nombre}. Este orden no mide ganancia ni cobranzas.`
    );
  if (s.total > 0n && sellers[0]?.total > 0n)
    insights.push(
      `El vendedor con mayor facturación representa ${sellers[0].porcentaje_total}% del total neto del período. Las devoluciones pueden alterar esta participación.`
    );
  if (s.total > 0n && cities[0]?.total > 0n)
    insights.push(
      `La ciudad con mayor facturación es ${cities[0].nombre}, con ${cities[0].porcentaje_total}% del total neto.`
    );
  if (s.ab !== ivaTotal)
    insights.push(
      'El segmento A/B difiere del libro IVA por el universo de documentos. Consultar conciliación por comprobante.'
    );
  const checks = {
    particion: s.total === s.normal + s.flete + s.pendiente,
    meses: s.total === sum(monthly, 'total'),
    vendedores: s.total === sum(sellers, 'total'),
    ciudades: s.total === sum(cities, 'total'),
    lineas:
      s.total === sum(lines, 'total_linea') + sum(current, 'ajuste_lineas'),
  };
  if (Object.values(checks).some((v) => !v))
    throw new Error('No se pudo conciliar internamente el reporte.');
  return serialize({
    version: '2.0',
    generado_en: generatedAt,
    periodo: p,
    resumen: s,
    comparacion: {
      periodo: p.anterior,
      resumen: before,
      comparable,
      diferencia: comparable ? s.total - before.total : null,
      porcentaje:
        comparable && before.total > 0n
          ? decimalPercent(s.total - before.total, before.total)
          : null,
      criterio: comparable
        ? 'Período inmediatamente anterior de igual cantidad de días; ambos períodos cerrados.'
        : 'Período abierto o futuro: se muestra la referencia anterior, pero no se informa variación hasta que cierre el período seleccionado.',
    },
    meses: monthly,
    vendedores: sellers,
    ciudades: cities,
    documentos: current,
    productos: productRows,
    lineas: lines.map((r) => ({
      ...r,
      cantidad: (r.cantidad_decimos / 10).toFixed(1),
    })),
    productos_totales: {
      neto: sum(lines, 'neto'),
      iva: sum(lines, 'iva'),
      total_lineas: sum(lines, 'total_linea'),
      ajuste_cabeceras: sum(current, 'ajuste_lineas'),
    },
    conciliacion: {
      controles: checks,
      clasificacion_completa: s.documentos_pendientes === 0,
      libro_iva: ivaTotal,
      diferencia_iva: s.ab - ivaTotal,
      comercial: sum(reconciliation, 'comercial'),
      vendedores_comerciales: [...commercialGroups.values()],
      documentos: reconciliation,
    },
    compras: purchases,
    gastos: expenses,
    resultado: {
      compras: purchaseTotal,
      gastos: expenseTotal,
      diferencia: s.total - purchaseTotal - expenseTotal,
      ganancia: null,
      motivo:
        'Sin costos históricos verificables. Facturación menos compras/gastos no equivale a utilidad ni flujo de caja.',
    },
    caja: {
      cuentas: accountRows,
      movimientos: movements,
      ingresos: sum(accountRows, 'ingresos'),
      egresos: sum(accountRows, 'egresos'),
      transferencias_entrada: sum(accountRows, 'transferencias_entrada'),
      transferencias_salida: sum(accountRows, 'transferencias_salida'),
      variacion: sum(accountRows, 'variacion'),
      saldo_inicial: null,
      saldo_final: null,
    },
    alertas: quality,
    alertas_resumen: qualitySummary,
    comentarios: insights,
    metodologia: [
      'Importes finales guardados en ventas, con impuestos según cada comprobante. FACTURA y ND suman; NC resta. Estado elegible: Facturada. Tipos y estado se normalizan en mayúsculas, espacios extremos y separadores de tipo.',
      'Fecha fiscal con fallback a fecha comercial. A/B, X y otros tipos se muestran separados. No se deduce validez fiscal de la clasificación comercial.',
      'Flete: documento completo con una línea FLETE. Las notas sin línea FLETE heredan la clasificación de su factura referenciada si tiene detalle identificable; casos ambiguos quedan pendientes.',
      'Vendedores agrupados por ID. Notas imputadas al vendedor de la factura original cuando existe; referencias ausentes generan alerta.',
      'Ticket: importe final de FACTURAS dividido por cantidad de FACTURAS; no mezcla ND/NC. Clientes únicos con ID conocido.',
      'Productos: subtotales e IVA guardados, incluye fletes y devoluciones. Los ajustes de cabecera no se distribuyen artificialmente. Cantidades se comparan por unidad.',
      'Conciliación comercial: fecha comercial, estado Facturada/Facturado, subtotal A/B y total para otras letras; notas con vendedor de referencia. Libro IVA: A/B por fecha fiscal, sin filtro de estado, según el listado existente.',
      'Caja: fecha del movimiento y día final completo; transferencias internas separadas. Variación del período, sin afirmar saldo real ni rentabilidad.',
      'Compras: Registrada y Confirmada; Anulada excluida. Gastos: registros del período. Ganancia histórica no disponible.',
      'Una lectura consistente de la base; pantalla y PDF utilizan la misma versión temporal. Conciliación aritmética no equivale a auditoría fiscal externa.',
    ],
  });
}
function decimalPercent(delta, base) {
  const { decimal } = require('./money');
  return decimal(roundedDivision(delta * 10000n, base));
}
module.exports = { buildReport, document, segment, eligible };
