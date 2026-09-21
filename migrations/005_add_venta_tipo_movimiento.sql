-- Agrega PEDIDO_FACTURADO al kardex: el stock físico se descuenta al facturar, no al crear el pedido.
-- Ejecutar en producción ANTES del deploy del backend que descuenta stock en facturarPedido.

ALTER TABLE movimiento_stock
MODIFY COLUMN tipo_operacion ENUM(
  'PEDIDO_NUEVO',
  'PEDIDO_ITEM_AGREGADO',
  'PEDIDO_ITEM_MODIFICADO',
  'PEDIDO_ITEM_ELIMINADO',
  'PEDIDO_ANULADO',
  'PEDIDO_REACTIVADO',
  'PEDIDO_FACTURADO',
  'VENTA_DIRECTA',
  'COMPRA',
  'NOTA_CREDITO',
  'AJUSTE_MANUAL'
) NOT NULL;
