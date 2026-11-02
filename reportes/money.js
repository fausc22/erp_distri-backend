// Reportes v2: centavos enteros; nunca reconstruir importes desde precios de catálogo.
function cents(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text))
    throw new Error(`Importe inválido en el reporte: ${text}`);
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  return (
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) *
    (text.startsWith('-') ? -1n : 1n)
  );
}
function decimal(value) {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
function roundedDivision(value, count) {
  if (!count) return null;
  const sign = value < 0n ? -1n : 1n;
  const abs = value * sign;
  return sign * ((abs + BigInt(count) / 2n) / BigInt(count));
}
const serialize = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? decimal(v) : v))
  );
module.exports = { cents, decimal, roundedDivision, serialize };
