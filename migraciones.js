/**
 * migraciones.js
 *
 * Aplica M001–M018 en orden sobre la BD del .env actual.
 * No hardcodea credenciales. No imprime passwords.
 * Salta migraciones ya registradas en schema_migrations.
 *
 * USO (en el servidor, desde backend/, después del backup):
 *   # 1) Ver qué se aplicaría (no escribe)
 *   node migraciones.js
 *
 *   # 2) Aplicar de verdad
 *   node migraciones.js --apply
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const APPLY = process.argv.includes('--apply');
const MIG_DIR = path.join(__dirname, 'migrations');

const DB = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306', 10) || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_DATABASE || process.env.MYSQL_DATABASE || process.env.DB_NAME || '',
  multipleStatements: true,
  charset: 'utf8mb4',
};

function versionKey(filename) {
  const m = String(filename).match(/^(M\d+)/i);
  return m ? m[1].toUpperCase() : filename;
}

function checksum(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => /^M\d+.*\.sql$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/^M(\d+)/i)[1], 10);
      const nb = parseInt(b.match(/^M(\d+)/i)[1], 10);
      return na - nb;
    })
    .map((f) => path.join(MIG_DIR, f));
}

async function ensureSchemaMigrations(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(14) NOT NULL,
      nombre VARCHAR(255) NOT NULL,
      aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64) NULL,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function alreadyApplied(conn, ver) {
  const [rows] = await conn.query(
    'SELECT version FROM schema_migrations WHERE version = ? LIMIT 1',
    [ver]
  );
  return rows.length > 0;
}

async function markApplied(conn, ver, nombre, hash) {
  await conn.query(
    `INSERT IGNORE INTO schema_migrations (version, nombre, checksum)
     VALUES (?, ?, ?)`,
    [ver, nombre, hash]
  );
}

async function main() {
  if (!DB.database) {
    console.error('ERROR: falta DB_DATABASE (o MYSQL_DATABASE) en .env');
    process.exit(1);
  }
  if (!DB.user) {
    console.error('ERROR: falta DB_USER en .env');
    process.exit(1);
  }

  console.log('────────────────────────────────────────────');
  console.log(' Migraciones ERP Distri');
  console.log('────────────────────────────────────────────');
  console.log(` Destino : ${DB.host}:${DB.port} / ${DB.database}`);
  console.log(` Usuario : ${DB.user}`);
  console.log(` Modo    : ${APPLY ? 'APPLY (escribe en BD)' : 'PREVIEW (no escribe)'}`);
  console.log('────────────────────────────────────────────');

  if (!APPLY) {
    console.log('Preview. Para aplicar: node migraciones.js --apply');
  }

  const files = listMigrationFiles();
  if (files.length === 0) {
    console.error('No se encontraron archivos M*.sql en migrations/');
    process.exit(1);
  }

  const conn = await mysql.createConnection(DB);
  let aplicadas = 0;
  let omitidas = 0;

  try {
    await ensureSchemaMigrations(conn);

    for (const file of files) {
      const nombre = path.basename(file);
      const ver = versionKey(nombre);
      const hash = checksum(file);

      if (await alreadyApplied(conn, ver)) {
        console.log(`SKIP  ${nombre}`);
        omitidas += 1;
        continue;
      }

      if (!APPLY) {
        console.log(`WOULD ${nombre}`);
        aplicadas += 1;
        continue;
      }

      console.log(`APPLY ${nombre} ...`);
      const sql = fs.readFileSync(file, 'utf8');
      try {
        await conn.query(sql);
        await markApplied(conn, ver, nombre, hash);
        console.log(`OK    ${nombre}`);
        aplicadas += 1;
      } catch (err) {
        console.error(`FAIL  ${nombre}`);
        console.error(err.message);
        console.error('Detenido. Restaurá el backup si hace falta antes de reintentar.');
        process.exitCode = 1;
        return;
      }
    }

    console.log('────────────────────────────────────────────');
    console.log(` Resumen: ${APPLY ? 'aplicadas' : 'pendientes'}=${aplicadas} omitidas=${omitidas}`);
    console.log(APPLY ? 'Listo.' : 'Nada escrito. Corré con --apply cuando el backup esté hecho.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('ERROR fatal:', err.message);
  process.exit(1);
});
