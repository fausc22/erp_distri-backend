-- Recuperación manual del pedido que no persistió (POST /pedidos/registrar-pedido 2026-10-14 21:23:17 UTC)
-- Cliente 306454 MARCANTONIO CARLOS DAMIAN · Empleado 13 Miguel · hash ped_knr985_20261014
-- Replica exactamente lo que hace pedidosService.nuevoPedido (cabecera redondeada con roundFacturacion, líneas sin redondear).
-- NO toca stock (el alta de pedido no descuenta stock; eso ocurre al facturar).

-- =====================================================================
-- PASO 0 · DIAGNÓSTICO (solo lectura). Ejecutar y revisar ANTES de insertar.
-- =====================================================================

-- 0.a ¿Ya existe? (si devuelve fila, NO insertar)
SELECT id, fecha, cliente_nombre, total, estado, hash_pedido
FROM pedidos
WHERE hash_pedido = 'ped_knr985_20261014'
   OR (cliente_id = 306454 AND DATE(fecha) = '2026-10-14');

-- 0.b Motivo real del fallo: el catch de nuevoPedido audita el error pero no lo imprime en consola.
SELECT id, fecha_hora, usuario_nombre, accion, estado, detalles_adicionales, tiempo_procesamiento
FROM auditoria
WHERE endpoint LIKE '%registrar-pedido%'
  AND fecha_hora >= '2026-10-14 00:00:00'
ORDER BY id DESC
LIMIT 20;

-- 0.c Estado de los productos del pedido (activo = 0 o inexistente => causa del rollback)
SELECT id, nombre, activo, stock_actual
FROM productos
WHERE id IN (484, 1480, 1307, 649, 1398, 843, 594, 440, 1429, 846, 858, 1257, 1286, 1159, 204, 1250, 206, 39,
             1408, 996, 716, 717, 960, 1532, 947, 930, 931, 932, 1288, 364, 335, 326, 325, 324, 516, 154, 155)
  AND (activo = 0 OR stock_actual < 0);
-- Debe haber 37 ids existentes:
SELECT COUNT(*) AS existentes
FROM productos
WHERE id IN (484, 1480, 1307, 649, 1398, 843, 594, 440, 1429, 846, 858, 1257, 1286, 1159, 204, 1250, 206, 39,
             1408, 996, 716, 717, 960, 1532, 947, 930, 931, 932, 1288, 364, 335, 326, 325, 324, 516, 154, 155);

-- 0.d Zona horaria: para elegir @fecha. Comparar con la fecha del otro pedido del mismo cliente.
SELECT @@global.time_zone, @@session.time_zone, @@system_time_zone, NOW(), UTC_TIMESTAMP();

-- =====================================================================
-- PASO 1 · INSERT (en transacción)
-- =====================================================================

-- Hora original del POST: 21:23:17 UTC = 18:23:17 Argentina.
-- Si NOW() del paso 0.d coincide con hora argentina, dejar 18:23:17; si coincide con UTC, usar 21:23:17.
SET @fecha := '2026-10-14 18:23:17';

START TRANSACTION;

INSERT INTO pedidos
  (fecha, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ciudad,
   cliente_provincia, cliente_condicion, cliente_cuit, subtotal, iva_total, exento, total,
   estado, observaciones, empleado_id, empleado_nombre, hash_pedido)
VALUES
  (@fecha, 306454, 'MARCANTONIO CARLOS DAMIAN', '', ' NICOLAS DE OLAVARRIA 0', 'FORTIN OLAVARRIA',
   'BUENOS AIRES', 'Responsable Inscripto', '20214031605', 748789, 157246, 0, 906035,
   'Exportado', CONCAT('Aceite surtidos', CHAR(10), '6 papaya'), 13, 'Miguel', 'ped_knr985_20261014');

SET @pid := LAST_INSERT_ID();

INSERT INTO pedidos_cont
  (pedido_id, producto_id, producto_nombre, producto_um, cantidad, precio, IVA, porcentaje_iva, subtotal, descuento_porcentaje)
VALUES
  (@pid, 484, 'ABRELATA MARIPOSA MAKE X UNID.', 'Unidades', 2, 6833, 2869.86, 21.00, 13666, 0),
  (@pid, 1480, 'COLADOR  GALVANIZADO  N =  20 ', 'Unidades', 2, 9092, 3818.64, 21.00, 18184, 0),
  (@pid, 1307, 'COLADOR GALVANIZADO N = 12', 'Unidades', 2, 2987.32, 1254.67, 21.00, 5974.64, 0),
  (@pid, 649, 'COLADOR GALVANIZADO N= 10', 'Unidades', 2, 2568.66, 1078.84, 21.00, 5137.32, 0),
  (@pid, 1398, 'ESPONJA DIAMOND X UNID.', 'Unidades', 12, 1192, 3003.84, 21.00, 14304, 0),
  (@pid, 843, 'LIMPIAVIDRIOS CIF x 450 D/P', 'Unidades', 6, 2034.99, 2564.09, 21.00, 12209.94, 0),
  (@pid, 594, 'BROCHE PLASTICO MAKE X 12 UNID.', 'Unidades', 5, 875.43, 919.2, 21.00, 4377.15, 0),
  (@pid, 440, 'ACEITES GLADE NATURALES REPUESTO X UNID.', 'Unidades', 6, 18765, 23643.9, 21.00, 112590, 0),
  (@pid, 1429, 'ESCOBILLON PERLA 7,5 CM X UNID.', 'Unidades', 6, 2548.7, 3211.36, 21.00, 15292.2, 0),
  (@pid, 846, 'MACETA ANUBIS X 22 CM X UNID.', 'Unidades', 6, 2276.39, 2868.25, 21.00, 13658.34, 0),
  (@pid, 858, 'MACETA YANI X 25 CM. X UNID.', 'Unidades', 6, 3299, 4156.74, 21.00, 19794, 0),
  (@pid, 1257, 'BOLSA DOTTI  ROLLO  45X60 X 20 UNID.', 'Unidades', 10, 969, 2034.9, 21.00, 9690, 0),
  (@pid, 1286, 'SEPARADORES PARA FREEZER X 18 UNID', 'Unidades', 6, 3003, 3783.78, 21.00, 18018, 0),
  (@pid, 1159, 'DESTAPACAÑERIAS CAUCHET X 1 LITRO.', 'Unidades', 6, 4231, 5331.06, 21.00, 25386, 0),
  (@pid, 204, 'JABON LIQUIDO NETIC X 3 LITROS.', 'Unidades', 4, 4766.9, 4004.2, 21.00, 19067.6, 0),
  (@pid, 1250, 'JABON LIQUIDO ZORRO EVOLUTION X 3 LITROS.', 'Unidades', 4, 10741.98, 9023.26, 21.00, 42967.92, 0),
  (@pid, 206, 'JABON LIQUIDO ZORRO X 3 LITROS.', 'Unidades', 4, 8901.76, 7477.48, 21.00, 35607.04, 0),
  (@pid, 39, 'AGUA DESTILADA X 10 LITROS', 'Litros', 6, 4958.68, 6247.94, 21.00, 29752.08, 0),
  (@pid, 1408, 'LYSOFORM AEROSOL  LAVANDA  X 315 CC. ALUMINIO', 'Unidades', 6, 3742.98, 4716.15, 21.00, 22457.88, 0),
  (@pid, 996, 'ROLLO FILM ADHERENTE', 'Unidades', 6, 1909.28, 2405.69, 21.00, 11455.68, 0),
  (@pid, 716, 'ENCENDEDOR MAXI BIC X UNID.', 'Unidades', 12, 1526.76, 3847.44, 21.00, 18321.12, 0),
  (@pid, 717, 'ENCENDEDORES BIC MINI X UNID.', 'Unidades', 12, 1049.65, 2645.12, 21.00, 12595.8, 0),
  (@pid, 960, 'PRESTOBARBA 3 HOJAS X UNID.', 'Unidades', 24, 1654.55, 8338.93, 21.00, 39709.2, 0),
  (@pid, 1532, 'ENCENDEDOR  COCINA  X 25 CM CON  CARGA  USB', 'Unidades', 6, 6468, 8149.68, 21.00, 38808, 0),
  (@pid, 947, 'PIZZERA MAKE ALUMINIO GRANEADA N= 35.', 'Unidades', 6, 5482, 6907.32, 21.00, 32892, 0),
  (@pid, 930, 'PAVA ALUMINIO ASA NEGRA N=16', 'Unidades', 1, 14321.32, 3007.48, 21.00, 14321.32, 0),
  (@pid, 931, 'PAVA ALUMINIO ASA NEGRA N= 12', 'Unidades', 1, 10231.32, 2148.58, 21.00, 10231.32, 0),
  (@pid, 932, 'PAVA ALUMINIO ASA NEGRA N = 14.', 'Unidades', 1, 12462.45, 2617.11, 21.00, 12462.45, 0),
  (@pid, 1288, 'PAVA SILVADORA ACERO X 2 LITROS.', 'Unidades', 2, 13090, 5497.8, 21.00, 26180, 0),
  (@pid, 364, 'TE COMUN LA VIRGINIA X 25 SAQUITOS', 'Unidades', 6, 937.45, 1181.19, 21.00, 5624.7, 0),
  (@pid, 335, 'SABORIZADOR POLVO ALBAHACA AJO ALICANTE X 7,5 G.', 'Unidades', 1, 3638.19, 764.02, 21.00, 3638.19, 0),
  (@pid, 326, 'PROVENZAL SIN TACC ALICANTE X 25 GMOS.', 'Unidades', 2, 1120, 470.4, 21.00, 2240, 0),
  (@pid, 325, 'PIMIENTA NEGRA MOLIDA ALICANTE X 25 GMOS.', 'Unidades', 2, 1128, 473.76, 21.00, 2256, 0),
  (@pid, 324, 'PIMIENTA EN GRANO NEGRO SOBRE X 25 GMOS. ALICANTE', 'Unidades', 2, 1158, 486.36, 21.00, 2316, 0),
  (@pid, 516, 'AROMATIZANTE EN AEROSOL', 'Unidades', 6, 3858, 4861.08, 21.00, 23148, 0),
  (@pid, 154, 'PLUMERO MEDIANO X UNID.', 'Unidades', 1, 25226, 5297.46, 21.00, 25226, 0),
  (@pid, 155, 'PLUMERO PATAGONIA N =1( GRANDE )', 'Unidades', 1, 29229.2, 6138.13, 21.00, 29229.2, 0);

-- Verificación dentro de la transacción: esperar 37 | 748789.09 | 157245.71
SELECT @pid AS pedido_id, COUNT(*) AS lineas, SUM(subtotal) AS subtotal, SUM(IVA) AS iva
FROM pedidos_cont
WHERE pedido_id = @pid;

-- Si los números coinciden:
COMMIT;
-- Si no coinciden, en lugar de COMMIT ejecutar:
-- ROLLBACK;

-- =====================================================================
-- PASO 2 · (opcional) Dejar rastro en auditoría
-- =====================================================================
-- INSERT INTO auditoria (usuario_id, usuario_nombre, accion, tabla_afectada, registro_id, endpoint, metodo_http, detalles_adicionales, estado)
-- VALUES (NULL, 'ADMIN (manual)', 'INSERT', 'pedidos', @pid, 'manual-sql', 'SQL',
--         'Recuperación manual pedido hash ped_knr985_20261014 (POST 2026-10-14 21:23:17 UTC no persistido)', 'EXITOSO');
