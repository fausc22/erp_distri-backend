const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  const fullPath = path.join(root, rel);
  assert.ok(fs.existsSync(fullPath), `${rel} debe existir`);
  return fs.readFileSync(fullPath, 'utf8');
}

function includesAll(rel, expected) {
  const content = read(rel);
  for (const text of expected) {
    assert.ok(content.includes(text), `${rel} debe contener ${text}`);
  }
}

async function run() {
  includesAll('migrations/M003_arca_series_estado.sql', [
    'CREATE TABLE IF NOT EXISTS arca_series_estado',
    "ENUM('LIBRE','EN_CURSO','DESCONOCIDO')",
    'DEFAULT CHARSET=utf8mb4',
  ]);

  includesAll('migrations/M004_arca_autorizaciones_canonicas.sql', [
    'CREATE TABLE IF NOT EXISTS arca_autorizaciones_canonicas',
    'UNIQUE KEY uq_arca_autorizacion_identidad (emisor_cuit, entorno, cbte_tipo, pto_vta, cbte_nro)',
    'DEFAULT CHARSET=utf8mb4',
  ]);

  includesAll('migrations/M005_arca_conflictos.sql', [
    'CREATE TABLE IF NOT EXISTS arca_conflictos',
    'FK_conflicto_autorizacion',
    'information_schema.TABLE_CONSTRAINTS',
  ]);

  includesAll('migrations/M006_ventas_pedido_id.sql', [
    'COLUMN_NAME = \'pedido_id\'',
    'ADD COLUMN pedido_id INT NULL',
    'UNIQUE KEY uq_ventas_pedido_id (pedido_id)',
  ]);

  includesAll('migrations/M007_ventas_estados.sql', [
    'NO_APLICA',
    'AUTORIZADO',
    'NO_EVALUADO',
    'CONFLICTO',
    'FK_ventas_autorizacion',
  ]);

  includesAll('migrations/M008_ventas_vendedor.sql', [
    'vendedor_atribuible_id',
    'asignacion_explicita',
    'sin_atribucion',
    'usuario_emisor_id',
  ]);

  includesAll('migrations/M009_operaciones_idempotencia.sql', [
    'CREATE TABLE IF NOT EXISTS operaciones_idempotencia',
    'UNIQUE KEY uq_operacion_content (operacion_id, content_hash)',
    'DEFAULT CHARSET=utf8mb4',
  ]);

  includesAll('migrations/M010_evento_clave_efectos.sql', [
    'movimiento_fondos',
    'movimiento_stock',
    'remitos',
    'evento_clave VARCHAR(80) NULL',
    'UNIQUE KEY',
  ]);

  includesAll('migrations/M011_reportes_cortes.sql', [
    'CREATE TABLE IF NOT EXISTS reportes_cortes',
    'CREATE TABLE IF NOT EXISTS reportes_cortes_documentos',
    'cliente_nombre VARCHAR(255) NULL',
    'vendedor_nombre VARCHAR(120) NULL',
    'FK_reportes_cortes_documentos_corte',
  ]);

  includesAll('migrations/M012_arca_log_cbte_reservado.sql', [
    'cbte_nro_reservado INT NULL',
    'serie_clave VARCHAR(100) NULL',
    'information_schema.COLUMNS',
  ]);

  includesAll('scripts/auditoria/backfill_e2.js', [
    'REPORTES_TEST_SOCKET',
    'REPORTES_COPY_DATABASE',
    '--apply',
    'dry-run',
    'NO_APLICA',
    'AUTORIZADO',
    'DESCONOCIDO',
    'sin_atribucion',
  ]);

  console.log('✅ e2_schema.test.js OK');
}

run().catch((error) => {
  console.error('❌ e2_schema.test.js FAIL', error);
  process.exit(1);
});
