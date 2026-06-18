# Reglas SQL de finanzas (v1)

## Fuente de verdad
Módulo: `backend/utils/finanzasSql.js`

## Universo de ventas
Solo se incluyen documentos con:
- `estado = 'Facturada'`
- `tipo_doc IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO')`

## Fecha de referencia
`DATE(COALESCE(fecha_fiscal, fecha))`

## Signo por tipo de documento
- `NOTA_CREDITO`: factor `-1`
- `FACTURA` / `NOTA_DEBITO`: factor `+1`

Expresión base de total neto:
`(CASE WHEN tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * total`

## Ganancia por línea de venta
1. Si `productos.costo > 0`: `(precio - costo) * cantidad * signo`
2. Si no hay costo: `precio * cantidad * 0.25 * signo` (estimación)

## Doble conteo de fondos
En ingresos/egresos manuales:
- `movimiento_fondos` con `referencia_id IS NOT NULL` representa movimientos automáticos ligados a ventas/compras.
- Los listados manuales deben filtrar `referencia_id IS NULL` para no duplicar ventas ya contabilizadas.

## Capa DB
- Lecturas/paginación: `pool.query` vía `legacyAdapter.query` y `connectionQuery.query`.
- Prepared statements (`execute`) solo para operaciones puntuales que lo requieran.

## Índices recomendados
Ver `backend/migrations/20250616_reportes_indexes.sql`.

## Validación
- `backend/tests/db.pagination.test.js`
- `backend/tests/finanzas.consistency.test.js`
