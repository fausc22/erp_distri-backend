-- Fase 4: Campo para registrar que el cliente fue validado contra AFIP.
-- Ejecutar una sola vez en la base de datos.

ALTER TABLE clientes
ADD COLUMN validado_afip_at DATETIME NULL DEFAULT NULL
COMMENT 'Fecha/hora en que se validaron los datos del cliente contra AFIP'
AFTER email;
