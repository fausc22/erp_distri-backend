-- Kardex de movimientos de stock. Ejecutar en producción antes del deploy del backend que registra movimientos.

CREATE TABLE IF NOT EXISTS movimiento_stock (
  id            INT NOT NULL AUTO_INCREMENT,
  producto_id   INT NOT NULL,
  delta         DECIMAL(10,1) NOT NULL,
  stock_antes   DECIMAL(10,1) NOT NULL,
  stock_despues DECIMAL(10,1) NOT NULL,
  tipo_operacion ENUM(
    'PEDIDO_NUEVO',
    'PEDIDO_ITEM_AGREGADO',
    'PEDIDO_ITEM_MODIFICADO',
    'PEDIDO_ITEM_ELIMINADO',
    'PEDIDO_ANULADO',
    'PEDIDO_REACTIVADO',
    'VENTA_DIRECTA',
    'COMPRA',
    'NOTA_CREDITO',
    'AJUSTE_MANUAL'
  ) NOT NULL,
  referencia_tipo VARCHAR(50)  NOT NULL,
  referencia_id   INT          DEFAULT NULL,
  usuario_id      INT          DEFAULT NULL,
  usuario_nombre  VARCHAR(100) DEFAULT NULL,
  observaciones   VARCHAR(500) DEFAULT NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ms_producto   (producto_id),
  KEY idx_ms_tipo_ref   (tipo_operacion, referencia_id),
  KEY idx_ms_created_at (created_at),
  CONSTRAINT fk_ms_producto FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
