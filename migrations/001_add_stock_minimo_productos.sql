-- Buffer de stock para catálogo offline (PWA). Ejecutar en producción antes del deploy del backend que usa esta columna.
-- DEFAULT 0 mantiene el comportamiento anterior hasta configurar stock_minimo por producto.

ALTER TABLE productos
ADD COLUMN stock_minimo DECIMAL(10,1) NOT NULL DEFAULT 0.0;
