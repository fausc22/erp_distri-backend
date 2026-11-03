const {
  PCT_ESCALA,
  toBigInt,
  halfUpDiv,
  lineaNeta,
  serializeBigInts,
} = require('../decimal');

const ALICUOTAS = new Map([
  [3, 0n],
  [4, 1050n],
  [5, 2100n],
  [6, 2700n],
]);

function error(code, detalle = {}) {
  return { ok: false, code, ...detalle };
}

function keyLinea(linea) {
  const raw = linea.linea_id ?? linea.id;
  if (raw === undefined || raw === null || raw === '') return '';
  return String(raw);
}

function compareLineaId(a, b) {
  return String(a.linea_id).localeCompare(String(b.linea_id), 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

function tasaAlicuota(alicuotaId) {
  const id = Number(alicuotaId);
  if (!ALICUOTAS.has(id)) {
    throw new Error(`alicuota_id inválida: ${alicuotaId}`);
  }
  return ALICUOTAS.get(id);
}

function readPct(value, field) {
  const pct = toBigInt(value ?? 0n, field);
  if (pct < 0n || pct > PCT_ESCALA) {
    throw new Error(`${field} debe estar entre 0 y 10000`);
  }
  return pct;
}

function readCentavos(value, field) {
  const cents = toBigInt(value ?? 0n, field);
  if (cents < 0n) {
    throw new Error(`${field} no puede ser negativo`);
  }
  return cents;
}

function distributeByLargestRemainder(total, items, weightKey, amountKey) {
  const amount = toBigInt(total, 'total_distribucion');
  if (amount === 0n || items.length === 0) {
    return new Map(items.map((item) => [item.linea_id, 0n]));
  }

  const weights = items.map((item) => ({
    item,
    weight: toBigInt(item[weightKey], weightKey),
  }));
  const totalWeight = weights.reduce((acc, entry) => acc + entry.weight, 0n);
  if (totalWeight <= 0n) {
    return new Map(items.map((item) => [item.linea_id, 0n]));
  }

  const rows = weights.map(({ item, weight }) => {
    const numerator = amount * weight;
    const base = numerator / totalWeight;
    return {
      item,
      base,
      remainder: numerator % totalWeight,
    };
  });

  let assigned = rows.reduce((acc, row) => acc + row.base, 0n);
  let remaining = amount - assigned;
  rows.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return compareLineaId(a.item, b.item);
  });

  for (const row of rows) {
    row[amountKey] = row.base;
  }
  for (let index = 0; remaining > 0n && rows.length > 0; index += 1) {
    rows[index % rows.length][amountKey] += 1n;
    remaining -= 1n;
  }

  return new Map(rows.map((row) => [row.item.linea_id, row[amountKey]]));
}

function groupByAlicuota(lineas) {
  const grupos = new Map();
  for (const linea of lineas) {
    const key = linea.alicuota_id;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(linea);
  }
  return grupos;
}

function sumar(lineas, key) {
  return lineas.reduce((acc, linea) => acc + toBigInt(linea[key] ?? 0n, key), 0n);
}

function normalizarLineas(inputLineas) {
  if (!Array.isArray(inputLineas) || inputLineas.length === 0) {
    throw new Error('lineas debe tener al menos una línea');
  }

  return inputLineas.map((linea, index) => {
    const lineaId = keyLinea(linea) || String(index + 1);
    const precioInt = toBigInt(linea.precio_int, `lineas[${index}].precio_int`);
    const cantidadInt = toBigInt(linea.cantidad_int, `lineas[${index}].cantidad_int`);
    const alicuotaId = Number(linea.alicuota_id ?? linea.alicuota ?? 5);
    const dPct = readPct(
      linea.descuento_linea_pct ?? linea.descuento_pct ?? 0n,
      `lineas[${index}].descuento_linea_pct`
    );
    const tasa = tasaAlicuota(alicuotaId);
    const netoBruto = lineaNeta(precioInt, cantidadInt);
    const descuentoLinea = halfUpDiv(netoBruto * dPct, PCT_ESCALA);
    const netoDespuesLinea = netoBruto - descuentoLinea;

    if (precioInt < 0n || cantidadInt < 0n || netoDespuesLinea < 0n) {
      throw new Error('TOTAL_NEGATIVO');
    }

    return {
      linea_id: lineaId,
      alicuota_id: alicuotaId,
      tasa,
      precio_int: precioInt,
      cantidad_int: cantidadInt,
      descuento_linea_pct: dPct,
      neto_bruto: netoBruto,
      descuento_linea: descuentoLinea,
      descuento_global_pct: 0n,
      descuento_global_fijo_final: 0n,
      neto: netoDespuesLinea,
      iva: 0n,
      total: 0n,
    };
  });
}

function aplicarDescuentoGlobalPct(lineas, pct) {
  if (pct === 0n) return 0n;

  const base = sumar(lineas, 'neto');
  const descuento = halfUpDiv(base * pct, PCT_ESCALA);
  const asignaciones = distributeByLargestRemainder(descuento, lineas, 'neto', 'asignado');

  for (const linea of lineas) {
    const asignado = asignaciones.get(linea.linea_id) ?? 0n;
    linea.descuento_global_pct = asignado;
    linea.neto -= asignado;
    if (linea.neto < 0n) throw new Error('TOTAL_NEGATIVO');
  }

  return descuento;
}

function calcularFinalesProvisorios(lineas) {
  for (const linea of lineas) {
    linea.iva_provisorio = halfUpDiv(linea.neto * linea.tasa, PCT_ESCALA);
    linea.final_provisorio = linea.neto + linea.iva_provisorio;
  }
}

function aplicarDescuentoGlobalFijo(lineas, descuentoFijo) {
  if (descuentoFijo === 0n) return { descuento: 0n };

  calcularFinalesProvisorios(lineas);
  const totalFinal = sumar(lineas, 'final_provisorio');
  if (descuentoFijo > totalFinal) throw new Error('TOTAL_NEGATIVO');

  const asignaciones = distributeByLargestRemainder(
    descuentoFijo,
    lineas,
    'final_provisorio',
    'asignado'
  );
  for (const linea of lineas) {
    linea.descuento_global_fijo_final = asignaciones.get(linea.linea_id) ?? 0n;
  }

  const grupos = groupByAlicuota(lineas);
  for (const [alicuotaId, grupo] of grupos.entries()) {
    const tasa = tasaAlicuota(alicuotaId);
    const oldBase = sumar(grupo, 'neto');
    const oldFinal = sumar(grupo, 'final_provisorio');
    const descuentoGrupo = sumar(grupo, 'descuento_global_fijo_final');
    const targetFinal = oldFinal - descuentoGrupo;
    if (targetFinal < 0n) throw new Error('TOTAL_NEGATIVO');

    const newBase = halfUpDiv(targetFinal * PCT_ESCALA, PCT_ESCALA + tasa);
    const newIva = halfUpDiv(newBase * tasa, PCT_ESCALA);
    const representableFinal = newBase + newIva;
    const diferencia = targetFinal - representableFinal;
    if (diferencia !== 0n) {
      return {
        error: error('COMBINACION_NO_REPRESENTABLE', {
          diferencia_no_representable: diferencia,
          alicuota_id: alicuotaId,
        }),
      };
    }

    const reduccionBase = oldBase - newBase;
    const reducciones = distributeByLargestRemainder(reduccionBase, grupo, 'neto', 'asignado');
    for (const linea of grupo) {
      const reduccion = reducciones.get(linea.linea_id) ?? 0n;
      linea.neto -= reduccion;
      if (linea.neto < 0n) throw new Error('TOTAL_NEGATIVO');
    }
  }

  return { descuento: descuentoFijo };
}

function calcularIvaAgregado(lineas) {
  const porAlicuota = [];
  for (const [alicuotaId, grupo] of groupByAlicuota(lineas).entries()) {
    const tasa = tasaAlicuota(alicuotaId);
    const neto = sumar(grupo, 'neto');
    const iva = halfUpDiv(neto * tasa, PCT_ESCALA);
    const asignaciones = distributeByLargestRemainder(iva, grupo, 'neto', 'iva_asignado');

    for (const linea of grupo) {
      linea.iva = asignaciones.get(linea.linea_id) ?? 0n;
      linea.total = linea.neto + linea.iva;
    }

    porAlicuota.push({
      alicuota_id: alicuotaId,
      tasa,
      neto,
      iva,
      total: neto + iva,
    });
  }

  porAlicuota.sort((a, b) => a.alicuota_id - b.alicuota_id);
  return porAlicuota;
}

function calcular(input = {}) {
  try {
    if (input.tratamiento_exento && !input.acreditado) {
      return error('HABILITACION_NO_DISPONIBLE');
    }

    const lineas = normalizarLineas(input.lineas);
    if (new Set(lineas.map(l => l.linea_id)).size !== lineas.length) return error('LINEA_ID_DUPLICADA');
    const descuentoGlobalPct = readPct(
      input.descuento_global_pct ?? input.descuento_pct_global ?? 0n,
      'descuento_global_pct'
    );
    const descuentoGlobalFijo = readCentavos(
      input.descuento_global_fijo_centavos ?? input.descuento_fijo_centavos ?? 0n,
      'descuento_global_fijo_centavos'
    );

    const totalLineas = sumar(lineas, 'neto_bruto');
    const totalDescuentoLineas = sumar(lineas, 'descuento_linea');
    const totalDescuentoPct = aplicarDescuentoGlobalPct(lineas, descuentoGlobalPct);
    const fijo = aplicarDescuentoGlobalFijo(lineas, descuentoGlobalFijo);
    if (fijo.error) return fijo.error;

    const porAlicuota = calcularIvaAgregado(lineas);
    const neto = sumar(lineas, 'neto');
    const iva = sumar(lineas, 'iva');
    const total = neto + iva;

    if (neto < 0n || iva < 0n || total < 0n) {
      return error('TOTAL_NEGATIVO');
    }

    return {
      ok: true,
      regla_version: 'v1',
      lineas: lineas
        .slice()
        .sort(compareLineaId)
        .map((linea) => ({
          linea_id: linea.linea_id,
          alicuota_id: linea.alicuota_id,
          tasa: linea.tasa,
          precio_int: linea.precio_int,
          cantidad_int: linea.cantidad_int,
          neto_bruto: linea.neto_bruto,
          descuento_linea: linea.descuento_linea,
          descuento_global_pct: linea.descuento_global_pct,
          descuento_global_fijo_final: linea.descuento_global_fijo_final,
          neto: linea.neto,
          iva: linea.iva,
          total: linea.total,
        })),
      totales: {
        neto,
        iva,
        total,
        bruto_lineas: totalLineas,
        descuentos: {
          lineas: totalDescuentoLineas,
          global_pct: totalDescuentoPct,
          global_fijo_final: fijo.descuento,
        },
        por_alicuota: porAlicuota,
      },
    };
  } catch (err) {
    if (err.message === 'TOTAL_NEGATIVO') return error('TOTAL_NEGATIVO');
    if (/descuento/i.test(err.message)) {
      return error('DESCUENTO_INVALIDO', { detalle: err.message });
    }
    return error('CALCULO_INVALIDO', { detalle: err.message });
  }
}

module.exports = {
  ALICUOTAS,
  calcular,
  serializeBigInts,
};
