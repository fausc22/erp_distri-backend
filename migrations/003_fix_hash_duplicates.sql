-- Limpieza previa a UNIQUE(hash_pedido).
-- Conserva el pedido más antiguo de cada hash duplicado (MIN(id)) y pone NULL en el resto.
-- InnoDB permite varios NULL en un UNIQUE: los pedidos históricos sin hash no se ven afectados.
-- No borra pedidos ni líneas. Solo limpia hash_pedido en las copias.
-- Ejecutar manualmente contra la base, ANTES de 002_unique_hash_pedido.sql.
-- No se corre automáticamente.

-- =====================================================================
-- PASO 0 · DIAGNÓSTICO (solo lectura). Revisar antes de la transacción.
-- =====================================================================

-- Hashes no nulos repetidos y cuál fila se conserva.
SELECT
  p.hash_pedido,
  COUNT(*) AS filas,
  MIN(p.id) AS id_que_se_conserva,
  GROUP_CONCAT(p.id ORDER BY p.id) AS ids
FROM pedidos p
WHERE p.hash_pedido IS NOT NULL
  AND p.hash_pedido <> ''
GROUP BY p.hash_pedido
HAVING COUNT(*) > 1;

-- Cadenas vacías: UNIQUE las trata como valor y también bloquean el índice.
SELECT id, fecha, cliente_nombre, hash_pedido
FROM pedidos
WHERE hash_pedido = '';

-- =====================================================================
-- PASO 1 · LIMPIEZA (transacción)
-- Si el SELECT de verificación del final devuelve filas, ejecutar ROLLBACK
-- en lugar de COMMIT.
-- =====================================================================

START TRANSACTION;

-- Copias: se queda el id menor de cada hash; el resto queda sin hash.
UPDATE pedidos p
INNER JOIN (
  SELECT hash_pedido, MIN(id) AS keep_id
  FROM pedidos
  WHERE hash_pedido IS NOT NULL
    AND hash_pedido <> ''
  GROUP BY hash_pedido
  HAVING COUNT(*) > 1
) d ON p.hash_pedido = d.hash_pedido AND p.id <> d.keep_id
SET p.hash_pedido = NULL;

-- '' no es NULL: varias filas vacías impedirían crear el UNIQUE.
UPDATE pedidos
SET hash_pedido = NULL
WHERE hash_pedido = '';

-- Debe devolver 0 filas.
SELECT hash_pedido, COUNT(*) AS filas
FROM pedidos
WHERE hash_pedido IS NOT NULL
  AND hash_pedido <> ''
GROUP BY hash_pedido
HAVING COUNT(*) > 1;

-- Si el SELECT anterior no devolvió filas:
COMMIT;
-- Si devolvió filas, no confirmar:
-- ROLLBACK;
