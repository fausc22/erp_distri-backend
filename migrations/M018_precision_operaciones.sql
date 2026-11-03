-- Ampliación de precisión: no recalcula ni redondea registros históricos.
-- Requiere backup. No reducir estas escalas después de registrar operaciones nuevas.
ALTER TABLE ventas_cont MODIFY cantidad DECIMAL(14,3) NOT NULL, MODIFY precio DECIMAL(18,6) NOT NULL;
ALTER TABLE pedidos_cont MODIFY cantidad DECIMAL(14,3) NOT NULL, MODIFY precio DECIMAL(18,6) NOT NULL;
ALTER TABLE detalle_remitos MODIFY cantidad DECIMAL(14,3) NOT NULL;
ALTER TABLE productos MODIFY stock_actual DECIMAL(14,3) NOT NULL DEFAULT 0,
  MODIFY stock_minimo DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE movimiento_stock MODIFY delta DECIMAL(14,3) NOT NULL,
  MODIFY stock_antes DECIMAL(14,3) NOT NULL, MODIFY stock_despues DECIMAL(14,3) NOT NULL;
