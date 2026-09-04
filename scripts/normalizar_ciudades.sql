-- =============================================================================
--  SCRIPT 2: NORMALIZACIÓN DE CIUDADES EN CLIENTES Y VENTAS
--  Base de datos : erp_distri
--  Fecha         : Septiembre 2026
--  Autor         : Generado tras análisis de 316 clientes sin ciudad y 135+
--                  ventas con ciudad vacía en la tabla ventas
--
--  QUÉ HACE:
--    PARTE A — clientes.ciudad
--      1. Normaliza variantes escritas de la misma ciudad (PICO → GENERAL PICO,
--         Colonia baron → COLONIA BARON, etc.)
--      2. Para los 316 clientes con ciudad NULL: intenta extraer la ciudad desde
--         el campo "direccion" usando patrones LIKE con ~35 localidades conocidas
--      3. Para los que no se puede determinar, asigna 'GENERAL PICO' por defecto
--
--    PARTE B — ventas.cliente_ciudad
--      1. Normaliza variantes escritas (igual que en clientes)
--      2. Para registros con ciudad NULL o vacía: primero toma la ciudad del
--         cliente ya normalizado (JOIN con clientes), y solo como último recurso
--         asigna 'GENERAL PICO'
--
--  IMPORTANTE: NO modifica rutas de entrega, nombres de clientes, IDs, precios,
--              ni ningún otro campo. Solo el campo ciudad/cliente_ciudad.
--
--  CÓMO EJECUTAR:
--    1. Conectarse a erp_distri en localhost
--    2. Ejecutar primero los SELECTs de VERIFICACIÓN para revisar qué va a cambiar
--    3. Ejecutar dentro de transacción:
--         START TRANSACTION;
--         -- (pegar el cuerpo del script)
--         -- Si el resultado final se ve bien → COMMIT;
--         -- Si algo está mal             → ROLLBACK;
--
--  RECOMENDACIÓN: Revisar los resultados del SELECT de PREVISUALIZACIÓN antes
--  de ejecutar las partes con UPDATE, especialmente los clientes marcados como
--  'GENERAL PICO (default)' para confirmar que son realmente de General Pico.
-- =============================================================================


-- =============================================================================
-- VERIFICACIÓN INICIAL
-- =============================================================================

-- ¿Cuántos clientes por ciudad?
SELECT ciudad,
       COUNT(*) AS total
FROM clientes
GROUP BY ciudad
ORDER BY total DESC;

-- ¿Cuántas ventas por ciudad en ventas?
SELECT cliente_ciudad,
       COUNT(*) AS total
FROM ventas
GROUP BY cliente_ciudad
ORDER BY total DESC;


-- =============================================================================
-- PREVISUALIZACIÓN: Clientes con ciudad NULL y la ciudad que se va a detectar
-- Ejecutar ANTES del UPDATE para revisar el resultado esperado.
-- =============================================================================
SELECT
  id,
  nombre,
  direccion,
  CASE
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VICTORICA%'         THEN 'VICTORICA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%TRENEL%'            THEN 'TRENEL'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%EDUARDO CASTEX%'    THEN 'EDUARDO CASTEX'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ED. CASTEX%'        THEN 'EDUARDO CASTEX'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%LA MARUJA%'         THEN 'LA MARUJA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%BUENA ESPERANZA%'   THEN 'BUENA ESPERANZA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ING. LUIGGI%'       THEN 'INGENIERO LUIGGI'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%INGENIERO LUIGGI%'  THEN 'INGENIERO LUIGGI'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%PARERA%'            THEN 'PARERA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%CALEUFU%'           THEN 'CALEUFU'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%COLONIA BARON%'     THEN 'COLONIA BARON'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%QUEMU QUEMU%'       THEN 'QUEMU QUEMU'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%GONZALEZ MORENO%'   THEN 'GONZALEZ MORENO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ALTA ITALIA%'       THEN 'ALTA ITALIA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%REALICO%'           THEN 'REALICO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%TELEN%'             THEN 'TELEN'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%RIVADAVIA%'         THEN 'RIVADAVIA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%HUINCA RENANCO%'    THEN 'HUINCA RENANCO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%SPELUZZI%'          THEN 'SPELUZZI'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%CONHELO%'           THEN 'CONHELO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%FORTIN OLAVARRIA%'  THEN 'FORTIN OLAVARRIA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%BERNARDO LARROUDE%' THEN 'BERNARDO LARROUDE'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%AGUSTONI%'          THEN 'AGUSTONI'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%RANCUL%'            THEN 'RANCUL'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%SANTA ROSA%'        THEN 'SANTA ROSA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ARIZONA%'           THEN 'ARIZONA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%NUEVA GALIA%'       THEN 'NUEVA GALIA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VILLA HUIDOBRO%'    THEN 'VILLA HUIDOBRO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%METILEO%'           THEN 'METILEO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%LUAN TORO%'         THEN 'LUAN TORO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%DORILA%'            THEN 'DORILA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VILLA MIRASOL%'     THEN 'VILLA MIRASOL'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%PICHI HUINCA%'      THEN 'PICHI HUINCA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%RUCANELO%'          THEN 'RUCANELO'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%CEBALLOS%'          THEN 'CEBALLOS'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VERTIZ%'            THEN 'VERTIZ'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ARATA%'             THEN 'ARATA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ANCHORENA%'         THEN 'ANCHORENA'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%INTENDENTE ALVEAR%' THEN 'INTENDENTE ALVEAR'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%-  ALVEAR%'         THEN 'INTENDENTE ALVEAR'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%- ALVEAR%'          THEN 'INTENDENTE ALVEAR'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VILLA SAUZE%'       THEN 'VILLA SAUZE'
    WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VICTORICA%'         THEN 'VICTORICA'  -- repetido para captura simple "VICTORICA" en dirección
    ELSE 'GENERAL PICO (default)'
  END AS ciudad_que_se_asignaria
FROM clientes
WHERE ciudad IS NULL OR TRIM(ciudad) = ''
ORDER BY ciudad_que_se_asignaria, nombre;


-- =============================================================================
-- INICIO DE TRANSACCIÓN
-- =============================================================================
START TRANSACTION;


-- =============================================================================
-- PARTE A: NORMALIZACIÓN DE clientes.ciudad
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A.1 Corregir variantes tipográficas conocidas (ciudades con ciudad ≠ NULL)
-- ─────────────────────────────────────────────────────────────────────────────

-- "PICO" → "GENERAL PICO"
UPDATE clientes
SET ciudad = 'GENERAL PICO'
WHERE TRIM(UPPER(ciudad)) = 'PICO';

-- Normalizaciones de caso / espacios / abreviaciones
UPDATE clientes
SET ciudad = 'GENERAL PICO'
WHERE TRIM(ciudad) = '';

UPDATE clientes
SET ciudad = 'COLONIA BARON'
WHERE LOWER(TRIM(ciudad)) IN ('colonia baron', 'baron', 'col. baron', 'col baron');

UPDATE clientes
SET ciudad = 'VILLA MIRASOL'
WHERE LOWER(TRIM(ciudad)) IN ('villa mirasol', 'mirasol', 'v. mirasol');

UPDATE clientes
SET ciudad = 'INGENIERO LUIGGI'
WHERE LOWER(TRIM(ciudad)) IN ('luiggi', 'ing. luiggi', 'ing luiggi', 'ingeniero luiggi');

UPDATE clientes
SET ciudad = 'INTENDENTE ALVEAR'
WHERE LOWER(TRIM(ciudad)) IN ('alvear', 'int. alvear', 'int alvear', 'intendente alvear');

UPDATE clientes
SET ciudad = 'EDUARDO CASTEX'
WHERE LOWER(TRIM(ciudad)) IN ('castex', 'ed. castex', 'ed castex', 'eduardo castex');

UPDATE clientes
SET ciudad = 'TRENEL'
WHERE LOWER(TRIM(ciudad)) = 'trenel';

UPDATE clientes
SET ciudad = UPPER(TRIM(ciudad))
WHERE ciudad IS NOT NULL AND ciudad != UPPER(TRIM(ciudad));

-- ─────────────────────────────────────────────────────────────────────────────
-- A.2 Clientes con ciudad NULL: detectar desde el campo direccion
--     Si la dirección contiene el nombre de una localidad conocida, se usa esa.
--     Caso contrario: 'GENERAL PICO' como valor por defecto.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE clientes
SET ciudad = CASE
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VICTORICA%'         THEN 'VICTORICA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%TRENEL%'            THEN 'TRENEL'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%EDUARDO CASTEX%'    THEN 'EDUARDO CASTEX'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ED. CASTEX%'        THEN 'EDUARDO CASTEX'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%LA MARUJA%'         THEN 'LA MARUJA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%BUENA ESPERANZA%'   THEN 'BUENA ESPERANZA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ING. LUIGGI%'       THEN 'INGENIERO LUIGGI'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%INGENIERO LUIGGI%'  THEN 'INGENIERO LUIGGI'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%PARERA%'            THEN 'PARERA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%CALEUFU%'           THEN 'CALEUFU'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%COLONIA BARON%'     THEN 'COLONIA BARON'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%QUEMU QUEMU%'       THEN 'QUEMU QUEMU'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%GONZALEZ MORENO%'   THEN 'GONZALEZ MORENO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ALTA ITALIA%'       THEN 'ALTA ITALIA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%REALICO%'           THEN 'REALICO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%TELEN%'             THEN 'TELEN'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%RIVADAVIA%'         THEN 'RIVADAVIA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%HUINCA RENANCO%'    THEN 'HUINCA RENANCO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%SPELUZZI%'          THEN 'SPELUZZI'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%CONHELO%'           THEN 'CONHELO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%FORTIN OLAVARRIA%'  THEN 'FORTIN OLAVARRIA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%BERNARDO LARROUDE%' THEN 'BERNARDO LARROUDE'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%AGUSTONI%'          THEN 'AGUSTONI'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%RANCUL%'            THEN 'RANCUL'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%SANTA ROSA%'        THEN 'SANTA ROSA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ARIZONA%'           THEN 'ARIZONA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%NUEVA GALIA%'       THEN 'NUEVA GALIA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VILLA HUIDOBRO%'    THEN 'VILLA HUIDOBRO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%METILEO%'           THEN 'METILEO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%LUAN TORO%'         THEN 'LUAN TORO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%-LUAN TORO%'        THEN 'LUAN TORO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%DORILA%'            THEN 'DORILA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VILLA MIRASOL%'     THEN 'VILLA MIRASOL'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%PICHI HUINCA%'      THEN 'PICHI HUINCA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%RUCANELO%'          THEN 'RUCANELO'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%CEBALLOS%'          THEN 'CEBALLOS'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VERTIZ%'            THEN 'VERTIZ'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ARATA%'             THEN 'ARATA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%ANCHORENA%'         THEN 'ANCHORENA'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%INTENDENTE ALVEAR%' THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%-  ALVEAR%'         THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%- ALVEAR%'          THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VILLA SAUZE%'       THEN 'VILLA SAUZE'
  -- Nota: VICTORICA se evalúa al final para no solapar con otros patrones
  WHEN UPPER(TRIM(IFNULL(direccion, ''))) LIKE '%VICTORICA%'         THEN 'VICTORICA'
  ELSE 'GENERAL PICO'   -- Valor por defecto: General Pico
END
WHERE ciudad IS NULL;


-- =============================================================================
-- PARTE B: NORMALIZACIÓN DE ventas.cliente_ciudad
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- B.1 Corregir variantes tipográficas conocidas en ventas históricas
-- ─────────────────────────────────────────────────────────────────────────────

-- Variantes de General Pico
UPDATE ventas
SET cliente_ciudad = 'GENERAL PICO'
WHERE TRIM(UPPER(cliente_ciudad)) = 'PICO'
   OR UPPER(cliente_ciudad) LIKE 'GENERAL PICO |%'
   OR UPPER(cliente_ciudad) LIKE '%| GENERAL PICO'
   OR UPPER(cliente_ciudad) LIKE '% GENERAL PICO'   -- "108 GENERAL PICO", "403 BIS. GENERAL PICO"
   OR UPPER(cliente_ciudad) LIKE 'GENERAL PICO%|%'
   OR UPPER(cliente_ciudad) LIKE '%GENERAL PICO%|%GENERAL PICO%';

-- Limpiar ciudad vacía (actualizar después con JOIN en B.2)
-- No se actualiza aquí para aprovechar el JOIN inteligente de B.2

-- Variantes de otras localidades
UPDATE ventas
SET cliente_ciudad = 'COLONIA BARON'
WHERE LOWER(TRIM(cliente_ciudad)) IN ('colonia baron', 'baron', 'col. baron',
                                       '125 colonia baron');

UPDATE ventas
SET cliente_ciudad = 'VILLA MIRASOL'
WHERE LOWER(TRIM(cliente_ciudad)) IN ('villa mirasol', 'mirasol', 'v. mirasol');

UPDATE ventas
SET cliente_ciudad = 'INGENIERO LUIGGI'
WHERE LOWER(TRIM(cliente_ciudad)) IN ('luiggi', 'ing. luiggi', 'ingeniero luiggi');

UPDATE ventas
SET cliente_ciudad = 'INTENDENTE ALVEAR'
WHERE LOWER(TRIM(cliente_ciudad)) IN ('alvear', 'int. alvear', 'intendente alvear');

-- Casos donde la dirección se guardó en el campo ciudad (dato mezclado)
UPDATE ventas
SET cliente_ciudad = 'ARIZONA'
WHERE UPPER(TRIM(cliente_ciudad)) IN ('ARIZONA.', 'FRENTE  A LA PLAZA  ARIZONA',
                                       'FRENTE A LA PLAZA ARIZONA');

UPDATE ventas
SET cliente_ciudad = 'PARERA'
WHERE UPPER(TRIM(cliente_ciudad)) IN ('INDEPENDENCIA . PARERA', 'INDEPENDENCIA. PARERA');

UPDATE ventas
SET cliente_ciudad = 'LUAN TORO'
WHERE UPPER(TRIM(cliente_ciudad)) LIKE '%LUAN TORO';

-- Normalizar a mayúsculas cualquier ciudad escrita en minúsculas/mixtas
UPDATE ventas
SET cliente_ciudad = UPPER(TRIM(cliente_ciudad))
WHERE cliente_ciudad IS NOT NULL
  AND cliente_ciudad != UPPER(TRIM(cliente_ciudad));

-- ─────────────────────────────────────────────────────────────────────────────
-- B.2 Ventas con ciudad NULL o vacía: propagar ciudad desde la tabla clientes
--     (ya normalizada en el paso A). Si el cliente tampoco tiene ciudad,
--     asignar 'GENERAL PICO' como valor por defecto.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ventas v
JOIN clientes c ON c.id = v.cliente_id
SET v.cliente_ciudad = COALESCE(NULLIF(TRIM(c.ciudad), ''), 'GENERAL PICO')
WHERE v.cliente_ciudad IS NULL
   OR TRIM(v.cliente_ciudad) = '';


-- =============================================================================
-- VERIFICACIÓN FINAL
-- =============================================================================

-- Resultado en clientes
SELECT ciudad, COUNT(*) AS total
FROM clientes
GROUP BY ciudad
ORDER BY total DESC;

-- Resultado en ventas
SELECT cliente_ciudad, COUNT(*) AS total
FROM ventas
GROUP BY cliente_ciudad
ORDER BY total DESC;

-- Confirmar que no quedaron ciudades NULL
SELECT COUNT(*) AS clientes_sin_ciudad FROM clientes WHERE ciudad IS NULL;
SELECT COUNT(*) AS ventas_sin_ciudad FROM ventas WHERE cliente_ciudad IS NULL OR TRIM(cliente_ciudad) = '';

-- Si todo se ve bien:
-- COMMIT;

-- Si algo está mal:
-- ROLLBACK;
