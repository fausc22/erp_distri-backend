const PRECIO_ESCALA = 10n ** 6n;
const CANTIDAD_ESCALA = 10n ** 3n;
const DIVISOR_CENTAVOS = 10n ** 7n;
const PCT_ESCALA = 10000n;

function toBigInt(value, field = 'valor') {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${field} debe ser un entero seguro`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new Error(`${field} debe ser un entero`);
}

function absBigInt(value) {
  return value < 0n ? -value : value;
}

function halfUpDiv(numerator, denominator) {
  const n = toBigInt(numerator, 'numerador');
  const d = toBigInt(denominator, 'denominador');
  if (d <= 0n) throw new Error('denominador debe ser positivo');

  const sign = n < 0n ? -1n : 1n;
  const abs = absBigInt(n);
  return sign * ((abs + d / 2n) / d);
}

function centsToString(cents) {
  const value = toBigInt(cents, 'centavos');
  const sign = value < 0n ? '-' : '';
  const abs = absBigInt(value);
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function centsToNumber(cents) {
  return Number(centsToString(cents));
}

function parseCentavos(value, field = 'centavos') {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${field} inválido`);
    return halfUpDiv(BigInt(Math.round(value * 100)), 1n);
  }
  const text = String(value ?? '').trim();
  if (/^-?\d+$/.test(text)) return BigInt(text);
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`${field} inválido`);
  }
  const sign = text.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  return sign * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

function lineaNeta(precioInt, cantidadInt) {
  const precio = toBigInt(precioInt, 'precio_int');
  const cantidad = toBigInt(cantidadInt, 'cantidad_int');
  return halfUpDiv(precio * cantidad, DIVISOR_CENTAVOS);
}

function serializeBigInts(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)])
    );
  }
  return value;
}

module.exports = {
  PRECIO_ESCALA,
  CANTIDAD_ESCALA,
  DIVISOR_CENTAVOS,
  PCT_ESCALA,
  toBigInt,
  halfUpDiv,
  centsToNumber,
  centsToString,
  parseCentavos,
  lineaNeta,
  serializeBigInts,
};
