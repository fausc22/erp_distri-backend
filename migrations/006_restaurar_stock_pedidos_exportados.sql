-- One-time: restaura stock descontado por la regla vieja (pedido Exportado ya restaba stock_actual).
-- Ejecutar UNA sola vez ANTES del deploy del nuevo código (descuento recién en facturación).
-- Si no se ejecuta, al facturar pedidos Exportados existentes se descontaría dos veces.

UPDATE productos p
JOIN (
  SELECT pc.producto_id, SUM(pc.cantidad) AS cantidad_a_restaurar
  FROM pedidos_cont pc
  JOIN pedidos ped ON ped.id = pc.pedido_id
  WHERE ped.estado = 'Exportado'
  GROUP BY pc.producto_id
) r ON r.producto_id = p.id
SET p.stock_actual = p.stock_actual + r.cantidad_a_restaurar;
