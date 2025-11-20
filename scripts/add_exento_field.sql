-- Script para agregar campo exento a pedidos y ventas
-- Ejecutar este script en la base de datos para agregar el campo exento

-- Agregar campo exento a la tabla pedidos
ALTER TABLE pedidos 
ADD COLUMN exento DECIMAL(10,2) NOT NULL DEFAULT 0.00 
COMMENT 'Monto exento de IVA (IVA que no se cobra a clientes exentos)' 
AFTER iva_total;

-- Agregar campo exento a la tabla ventas
ALTER TABLE ventas 
ADD COLUMN exento DECIMAL(10,2) NOT NULL DEFAULT 0.00 
COMMENT 'Monto exento de IVA (IVA que no se cobra a clientes exentos)' 
AFTER iva_total;

-- Actualizar registros existentes: calcular exento para clientes exentos
-- Para pedidos
UPDATE pedidos p
INNER JOIN clientes c ON p.cliente_id = c.id
SET p.exento = CASE 
    WHEN UPPER(c.condicion_iva) = 'EXENTO' THEN 
        -- Calcular el IVA que debería haberse cobrado pero no se cobró
        ROUND(p.subtotal * 0.21, 2)  -- Asumiendo 21% de IVA estándar
    ELSE 0.00
END
WHERE UPPER(c.condicion_iva) = 'EXENTO';

-- Para ventas
UPDATE ventas v
INNER JOIN clientes c ON v.cliente_id = c.id
SET v.exento = CASE 
    WHEN UPPER(c.condicion_iva) = 'EXENTO' THEN 
        -- Calcular el IVA que debería haberse cobrado pero no se cobró
        ROUND(v.subtotal * 0.21, 2)  -- Asumiendo 21% de IVA estándar
    ELSE 0.00
END
WHERE UPPER(c.condicion_iva) = 'EXENTO';

