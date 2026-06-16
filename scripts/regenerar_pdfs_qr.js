/**
 * Regenera PDFs en disco para facturas con CAE (QR actualizado desde BD).
 *
 * Uso:
 *   node backend/scripts/regenerar_pdfs_qr.js
 *   node backend/scripts/regenerar_pdfs_qr.js --tipo B
 *   node backend/scripts/regenerar_pdfs_qr.js --ids 2661,2513
 *
 * Requiere: .env con DB_* y ARCA_MICROSERVICE_URL (opcional; fallback QR local).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const pdfGenerator = require('../utils/pdfGenerator');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'erp_distri',
  port: process.env.DB_PORT ? Number(String(process.env.DB_PORT).trim()) : 3306,
  charset: 'utf8mb4'
};

const OUT_DIR = path.join(__dirname, 'output', 'pdfs_regenerados');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { tipo: null, ids: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tipo' && args[i + 1]) opts.tipo = args[++i].toUpperCase();
    if (args[i] === '--ids' && args[i + 1]) {
      opts.ids = args[++i].split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    }
  }
  return opts;
}

async function fetchVentas(connection, opts) {
  if (opts.ids?.length) {
    const placeholders = opts.ids.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT * FROM ventas WHERE id IN (${placeholders}) AND cae_id IS NOT NULL ORDER BY id`,
      opts.ids
    );
    return rows;
  }

  let sql = `
    SELECT * FROM ventas
    WHERE cae_id IS NOT NULL
      AND tipo_doc = 'FACTURA'
  `;
  const params = [];
  if (opts.tipo) {
    sql += ' AND tipo_f = ?';
    params.push(opts.tipo);
  } else {
    sql += " AND (tipo_f = 'B' OR id = 2661)";
  }
  sql += ' ORDER BY id';

  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function main() {
  const opts = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const connection = await mysql.createConnection(dbConfig);
  const ventas = await fetchVentas(connection, opts);

  if (!ventas.length) {
    console.log('No hay ventas para regenerar.');
    await connection.end();
    return;
  }

  console.log(`Regenerando ${ventas.length} PDF(s) → ${OUT_DIR}`);

  let ok = 0;
  let fail = 0;

  for (const venta of ventas) {
    try {
      const [productos] = await connection.execute(
        'SELECT *, descuento_porcentaje FROM ventas_cont WHERE venta_id = ?',
        [venta.id]
      );
      if (!productos.length) {
        console.warn(`  ⚠ venta ${venta.id}: sin productos, omitida`);
        fail++;
        continue;
      }

      const esNota = venta.tipo_doc === 'NOTA_DEBITO' || venta.tipo_doc === 'NOTA_CREDITO';
      const pdfBuffer = esNota
        ? await pdfGenerator.generarNota(venta, productos)
        : await pdfGenerator.generarFactura(venta, productos);

      const safeName = (venta.numero_factura || `venta_${venta.id}`)
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '_');
      const outPath = path.join(OUT_DIR, `${safeName}_id${venta.id}.pdf`);
      fs.writeFileSync(outPath, pdfBuffer);
      console.log(`  ✓ ${venta.id} → ${path.basename(outPath)}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ venta ${venta.id}: ${err.message}`);
      fail++;
    }
  }

  await connection.end();
  console.log(`Listo: ${ok} OK, ${fail} error(es).`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
