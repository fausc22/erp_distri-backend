-- Amplía a VARCHAR(255) columnas acotadas que causaron o pueden causar ER_DATA_TOO_LONG.
-- Ejecutar contra la base de uso (p. ej. DB_distri). Revisar nombre de BD si aplica.
-- Charset/collation: se mantienen los del servidor/tabla salvo que indiques lo contrario.

SET NAMES utf8mb4;

START TRANSACTION;

-- Listado explícito en conversación + campos pedidos 45 chars (cuit/condición)
ALTER TABLE `movimiento_fondos`
  MODIFY COLUMN `origen` varchar(255) DEFAULT NULL;

ALTER TABLE `remitos`
  MODIFY COLUMN `cliente_telefono` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_cuit` varchar(255) DEFAULT NULL;

ALTER TABLE `ventas`
  MODIFY COLUMN `cliente_nombre` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_telefono` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `observaciones` varchar(255) DEFAULT 'sin observaciones';

ALTER TABLE `pedidos`
  MODIFY COLUMN `cliente_nombre` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_telefono` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_direccion` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_ciudad` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_provincia` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_condicion` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `cliente_cuit` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `observaciones` varchar(255) DEFAULT 'sin observaciones';

ALTER TABLE `clientes`
  MODIFY COLUMN `nombre` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `telefono` varchar(255) DEFAULT NULL;

ALTER TABLE `detalle_remitos`
  MODIFY COLUMN `producto_nombre` varchar(255) NOT NULL;

COMMIT;
