-- Completa componentes fiscales canónicos usados por proyección/libro/recuperación.
-- Idempotente: agrega columnas solo si faltan.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name='arca_autorizaciones_canonicas' AND column_name='cbte_fch'),
    'SELECT 1',
    'ALTER TABLE arca_autorizaciones_canonicas ADD COLUMN cbte_fch VARCHAR(8) NULL COMMENT ''YYYYMMDD fiscal ARCA'' AFTER cae_vencimiento'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name='arca_autorizaciones_canonicas' AND column_name='cae_vto'),
    'SELECT 1',
    'ALTER TABLE arca_autorizaciones_canonicas ADD COLUMN cae_vto DATE NULL AFTER cbte_fch'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name='arca_autorizaciones_canonicas' AND column_name='imp_neto'),
    'SELECT 1',
    'ALTER TABLE arca_autorizaciones_canonicas ADD COLUMN imp_neto DECIMAL(15,2) NULL AFTER imp_total'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name='arca_autorizaciones_canonicas' AND column_name='imp_iva'),
    'SELECT 1',
    'ALTER TABLE arca_autorizaciones_canonicas ADD COLUMN imp_iva DECIMAL(15,2) NULL AFTER imp_neto'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name='arca_autorizaciones_canonicas' AND column_name='iva_alicuotas'),
    'SELECT 1',
    'ALTER TABLE arca_autorizaciones_canonicas ADD COLUMN iva_alicuotas JSON NULL AFTER imp_iva'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name='arca_autorizaciones_canonicas' AND column_name='calidad'),
    'SELECT 1',
    'ALTER TABLE arca_autorizaciones_canonicas ADD COLUMN calidad VARCHAR(40) NULL DEFAULT ''RESPUESTA_DIRECTA'' AFTER iva_alicuotas'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Backfill derivable: fecha_emision → cbte_fch; cae_vencimiento → cae_vto
UPDATE arca_autorizaciones_canonicas
SET cbte_fch = COALESCE(cbte_fch, DATE_FORMAT(fecha_emision, '%Y%m%d'))
WHERE cbte_fch IS NULL AND fecha_emision IS NOT NULL;

UPDATE arca_autorizaciones_canonicas
SET cae_vto = COALESCE(cae_vto, cae_vencimiento)
WHERE cae_vto IS NULL AND cae_vencimiento IS NOT NULL;
