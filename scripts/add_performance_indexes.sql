-- ============================================
-- SCRIPT DE ÍNDICES PARA OPTIMIZACIÓN - FASE 1
-- ============================================
-- Este script agrega índices para mejorar el rendimiento
-- de las consultas más frecuentes sin afectar funcionalidad.
-- 
-- IMPORTANTE: Ejecutar en horario de bajo tráfico
-- Tiempo estimado: 1-5 minutos dependiendo del tamaño de las tablas
-- ============================================

-- ✅ ÍNDICES PARA TABLA productos
-- Optimiza búsquedas por nombre (muy frecuente)
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);

-- Optimiza JOINs con categorías
CREATE INDEX IF NOT EXISTS idx_productos_categoria_id ON productos(categoria_id);

-- Índice compuesto para búsquedas con filtros múltiples
CREATE INDEX IF NOT EXISTS idx_productos_nombre_categoria ON productos(nombre, categoria_id);

-- ✅ ÍNDICES PARA TABLA clientes
-- Optimiza búsquedas por nombre (muy frecuente)
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);

-- Optimiza búsquedas por ciudad (filtros frecuentes)
CREATE INDEX IF NOT EXISTS idx_clientes_ciudad ON clientes(ciudad);

-- ✅ ÍNDICES PARA TABLA pedidos
-- Optimiza consultas por fecha (muy frecuente en reportes)
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(fecha);

-- Optimiza consultas por cliente (historial de pedidos)
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id ON pedidos(cliente_id);

-- Optimiza verificación de duplicados por hash
CREATE INDEX IF NOT EXISTS idx_pedidos_hash_pedido ON pedidos(hash_pedido);

-- Índice compuesto para consultas frecuentes (fecha + cliente)
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_cliente ON pedidos(fecha DESC, cliente_id);

-- Optimiza consultas por estado
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);

-- ✅ ÍNDICES PARA TABLA ventas
-- Optimiza consultas por fecha (muy frecuente en reportes)
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);

-- Optimiza consultas por cliente (historial de ventas)
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id ON ventas(cliente_id);

-- Índice compuesto para consultas frecuentes (fecha + cliente + estado)
CREATE INDEX IF NOT EXISTS idx_ventas_fecha_cliente_estado ON ventas(fecha DESC, cliente_id, estado);

-- Optimiza consultas por estado
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);

-- ✅ ÍNDICES PARA TABLA auditoria
-- Optimiza consultas por fecha_hora (muy frecuente en filtros)
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha_hora ON auditoria(fecha_hora DESC);

-- Optimiza consultas por usuario
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_id ON auditoria(usuario_id);

-- Índice compuesto para consultas frecuentes (fecha + usuario)
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha_usuario ON auditoria(fecha_hora DESC, usuario_id);

-- Optimiza consultas por acción
CREATE INDEX IF NOT EXISTS idx_auditoria_accion ON auditoria(accion);

-- Optimiza consultas por tabla afectada
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_afectada ON auditoria(tabla_afectada);

-- ✅ VERIFICACIÓN DE ÍNDICES CREADOS
-- Ejecutar después para verificar que se crearon correctamente:
-- SHOW INDEX FROM productos;
-- SHOW INDEX FROM clientes;
-- SHOW INDEX FROM pedidos;
-- SHOW INDEX FROM ventas;
-- SHOW INDEX FROM auditoria;

-- ============================================
-- NOTAS IMPORTANTES:
-- ============================================
-- 1. Los índices mejoran SELECT pero pueden ralentizar INSERT/UPDATE ligeramente
-- 2. El impacto en INSERT/UPDATE es mínimo comparado con el beneficio en SELECT
-- 3. Los índices se actualizan automáticamente cuando cambian los datos
-- 4. Si necesitas eliminar un índice: DROP INDEX nombre_indice ON tabla;
-- ============================================

