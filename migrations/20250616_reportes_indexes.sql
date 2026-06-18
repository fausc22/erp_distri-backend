-- Índices orientados a reportes financieros y listados paginados.
-- Ejecutar manualmente en entornos locales/staging antes de producción.

-- Ventas: filtros de reportes por estado, tipo, fecha fiscal/real
CREATE INDEX IF NOT EXISTS idx_ventas_reportes
  ON ventas (estado, tipo_doc, fecha_fiscal, fecha);

CREATE INDEX IF NOT EXISTS idx_ventas_empleado_fecha
  ON ventas (empleado_id, fecha_fiscal, fecha);

CREATE INDEX IF NOT EXISTS idx_ventas_cliente_fecha
  ON ventas (cliente_id, fecha_fiscal, fecha);

-- Detalle de ventas
CREATE INDEX IF NOT EXISTS idx_ventas_cont_venta_producto
  ON ventas_cont (venta_id, producto_id);

-- Pedidos: listado por fecha
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_id
  ON pedidos (fecha, id);

-- Clientes: búsqueda paginada
CREATE INDEX IF NOT EXISTS idx_clientes_busqueda
  ON clientes (nombre, cuit, ciudad);
