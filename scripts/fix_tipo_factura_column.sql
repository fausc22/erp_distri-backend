-- Script para aumentar el tamaño de la columna tipo_factura
-- para soportar valores como 'NOTA_DEBITO_A', 'NOTA_CREDITO_B', etc.
-- 
-- IMPORTANTE: Este cambio es compatible con el código existente que usa 'A', 'B', 'X'
-- ya que VARCHAR(20) puede almacenar valores de 1 carácter sin problemas.

-- Modificar la columna para soportar hasta 20 caracteres
ALTER TABLE control_numeracion_facturas 
MODIFY COLUMN tipo_factura VARCHAR(20) NOT NULL COMMENT 'A, B, X, NOTA_DEBITO_A, NOTA_CREDITO_B, etc.';

-- Verificar el cambio
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    CHARACTER_MAXIMUM_LENGTH 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'control_numeracion_facturas' 
  AND COLUMN_NAME = 'tipo_factura';

