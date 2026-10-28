-- Venta #5337 (Factura A 0004-00001710)
-- Alinea el detalle y la cabecera al importe ya autorizado por ARCA (importe_afip).
-- El 10% del café se había descontado en el sistema, pero el CAE se autorizó
-- con el precio de lista. Este script quita ese descuento para que el PDF
-- coincida con el comprobante fiscal.
--
-- Aplicar a mano, dentro de una transacción. Revisar el SELECT final antes de COMMIT.
-- Después de commitear, regenerar el PDF:
--   node backend/scripts/regenerar_pdfs_qr.js --ids 5337

START TRANSACTION;

-- 1. Estado previo
SELECT id, numero_factura, total, subtotal, iva_total, importe_afip
FROM ventas
WHERE id = 5337;

SELECT id, producto_nombre, cantidad, precio, subtotal, iva, porcentaje_iva, descuento_porcentaje
FROM ventas_cont
WHERE venta_id = 5337;

-- 2. Quitar el descuento: el subtotal pasa a ser precio × cantidad (base que usó ARCA)
UPDATE ventas_cont
SET
  subtotal = ROUND(precio * cantidad, 2),
  iva = ROUND(precio * cantidad * (porcentaje_iva / 100), 2),
  descuento_porcentaje = 0
WHERE venta_id = 5337
  AND descuento_porcentaje > 0;

-- 3. Recalcular la cabecera desde el detalle
UPDATE ventas v
SET
  v.subtotal = (
    SELECT ROUND(SUM(vc.subtotal), 2)
    FROM ventas_cont vc
    WHERE vc.venta_id = v.id
  ),
  v.iva_total = (
    SELECT ROUND(SUM(vc.iva), 2)
    FROM ventas_cont vc
    WHERE vc.venta_id = v.id
  ),
  v.total = (
    SELECT ROUND(SUM(vc.subtotal + vc.iva), 2)
    FROM ventas_cont vc
    WHERE vc.venta_id = v.id
  )
WHERE v.id = 5337;

-- 4. Control: total debe quedar igual a importe_afip (212850.76)
SELECT id, numero_factura, total, subtotal, iva_total, importe_afip
FROM ventas
WHERE id = 5337;

-- Si total = importe_afip, confirmar. Si no, ROLLBACK y no regenerar el PDF.
-- COMMIT;
-- ROLLBACK;
