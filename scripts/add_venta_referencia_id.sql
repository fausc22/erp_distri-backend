-- Script para agregar columna venta_referencia_id a la tabla ventas
-- Esta columna almacenará el ID de la factura original cuando se crea una nota de débito/crédito

-- Verificar si la columna ya existe
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'ventas' 
  AND COLUMN_NAME = 'venta_referencia_id';

-- Agregar la columna si no existe
ALTER TABLE ventas 
ADD COLUMN venta_referencia_id INT NULL 
COMMENT 'ID de la venta/factura original cuando es una nota de débito o crédito' 
AFTER tipo_doc;

-- Agregar índice para mejorar búsquedas
ALTER TABLE ventas 
ADD INDEX idx_venta_referencia_id (venta_referencia_id);

-- Agregar foreign key opcional (comentado por si prefieres no tenerlo)
-- ALTER TABLE ventas 
-- ADD CONSTRAINT fk_venta_referencia 
-- FOREIGN KEY (venta_referencia_id) REFERENCES ventas(id) 
-- ON DELETE SET NULL;

