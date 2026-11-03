-- No inferir autoridad de los cálculos en sombra ya existentes.
SET @sql := IF(EXISTS(SELECT 1 FROM information_schema.columns
 WHERE table_schema=DATABASE() AND table_name='venta_calculos' AND column_name='aplicacion'),
 'SELECT 1',
 "ALTER TABLE venta_calculos ADD COLUMN aplicacion ENUM('SOMBRA','AUTORITATIVO') NOT NULL DEFAULT 'SOMBRA'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
