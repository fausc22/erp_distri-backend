-- Baja lógica de productos. Ejecutar en producción antes del deploy del backend que usa soft-delete.
-- DEFAULT 1 mantiene todos los productos existentes como activos.

ALTER TABLE productos
ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1,
ADD INDEX idx_productos_activo (activo);
