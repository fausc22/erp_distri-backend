-- Persiste la alícuota (%) en cada línea de pedido/venta.
-- Necesario para fletes/manuales (mismo producto_id, distinto %) y para CAE mixto.
-- Ejecutar en MySQL/MariaDB de producción antes de deploy.

ALTER TABLE pedidos_cont
  ADD COLUMN porcentaje_iva DECIMAL(5,2) NULL
  COMMENT 'Alícuota IVA de la línea (0 / 10.50 / 21). NULL = histórico sin dato'
  AFTER IVA;

ALTER TABLE ventas_cont
  ADD COLUMN porcentaje_iva DECIMAL(5,2) NULL
  COMMENT 'Alícuota IVA de la línea (0 / 10.50 / 21). NULL = histórico sin dato'
  AFTER IVA;

-- Backfill aproximado desde importe IVA / subtotal (0 o ~21 o ~10.5)
UPDATE pedidos_cont
SET porcentaje_iva = CASE
  WHEN subtotal IS NULL OR subtotal = 0 THEN 21.00
  WHEN ABS(COALESCE(IVA, 0)) < 0.005 THEN 0.00
  WHEN ABS((IVA / subtotal) * 100 - 10.5) <= ABS((IVA / subtotal) * 100 - 21)
       AND ABS((IVA / subtotal) * 100 - 10.5) < 3 THEN 10.50
  WHEN ABS((IVA / subtotal) * 100) < 3 THEN 0.00
  ELSE 21.00
END
WHERE porcentaje_iva IS NULL;

UPDATE ventas_cont
SET porcentaje_iva = CASE
  WHEN subtotal IS NULL OR subtotal = 0 THEN 21.00
  WHEN ABS(COALESCE(IVA, 0)) < 0.005 THEN 0.00
  WHEN ABS((IVA / subtotal) * 100 - 10.5) <= ABS((IVA / subtotal) * 100 - 21)
       AND ABS((IVA / subtotal) * 100 - 10.5) < 3 THEN 10.50
  WHEN ABS((IVA / subtotal) * 100) < 3 THEN 0.00
  ELSE 21.00
END
WHERE porcentaje_iva IS NULL;
