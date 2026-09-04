-- =============================================================================
--  SCRIPT 1: NORMALIZACIÓN DE CATEGORÍAS DE PRODUCTOS
--  Base de datos : erp_distri
--  Fecha         : Septiembre 2026
--  Autor         : Generado por análisis de 988 productos en PRODUCTOS VARIOS
--
--  QUÉ HACE:
--    1. Crea 6 categorías nuevas (no toca las existentes)
--    2. Reclasifica ~650 productos desde PRODUCTOS VARIOS a la categoría correcta
--    3. También corrije algunos productos mal puestos en PRODUCTOS EN AEROSOL
--    4. NO modifica nombre, precio, stock ni unidad_medida. Solo categoria_id.
--
--  CÓMO EJECUTAR (MySQL Workbench / DBeaver):
--    1. Conectarse a erp_distri en localhost
--    2. Copiar y pegar el script completo
--    3. Ejecutar la VERIFICACIÓN INICIAL (SELECT) para ver el punto de partida
--    4. Ejecutar todo dentro de la transacción:
--         START TRANSACTION;
--         -- ... (pegar todo el cuerpo del script desde SECCIÓN 1) ...
--         -- Si el resultado del SELECT final se ve bien → COMMIT;
--         -- Si algo está mal → ROLLBACK;
--    5. Para ejecutar más seguro: ir bloque por bloque y verificar con
--         SELECT COUNT(*) FROM productos WHERE categoria_id = <id>;
-- =============================================================================


-- =============================================================================
-- VERIFICACIÓN INICIAL (ejecutar antes del START TRANSACTION para ver el estado)
-- =============================================================================
SELECT c.nombre AS categoria, COUNT(p.id) AS total_productos
FROM categorias c
LEFT JOIN productos p ON p.categoria_id = c.id
GROUP BY c.id, c.nombre
ORDER BY total_productos DESC;


-- =============================================================================
-- INICIO DE TRANSACCIÓN
-- =============================================================================
START TRANSACTION;


-- =============================================================================
-- SECCIÓN 1: CREAR LAS 6 CATEGORÍAS NUEVAS
-- INSERT IGNORE: si ya existe por alguna razón, no falla.
-- =============================================================================
INSERT IGNORE INTO categorias (nombre) VALUES
  ('INSECTICIDAS Y REPELENTES'),  -- Raid, espirales, OFF, hormiguicida, tabletas
  ('HIGIENE PERSONAL'),           -- Shampoo, dentífrico, talcos, prestobarba, toallas fem.
  ('ALIMENTOS Y BEBIDAS'),        -- Tés, cafés, especias, sopas, conservas, condimentos
  ('ALIMENTOS MASCOTAS'),         -- Dogui, Sabrocito, Pedigree, Whiskas, Gati
  ('BOLSAS Y DESCARTABLES'),      -- Bolsas de residuos, DOTTI, freezer, herméticas
  ('BAZAR Y UTENSILLOS');         -- Utensillos cocina, cestos, macetas, mate, termos, velas


-- =============================================================================
-- SECCIÓN 2: MOVER A CATEGORÍAS EXISTENTES (desde PRODUCTOS VARIOS = id 10)
-- Orden: de más específico a más general para evitar solapamientos.
-- =============================================================================

-- 2.1  LAVANDINA (id 13)
--      Lavandinas de todas las marcas/tamaños
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'LAVANDINA')
WHERE categoria_id = 10
  AND LOWER(nombre) LIKE '%lavandina%';

-- 2.2  DETERGENTES (id 6)
--      Magistral, CIF vajilla, lavavajilla, Finish detergente, Ayudin vajilla
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'DETERGENTES')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) REGEXP '^det[\\.\\s]'          -- DET. / DET MAGISTRAL al inicio
    OR LOWER(nombre) LIKE '%magistral%'
    OR LOWER(nombre) LIKE '%lavavajilla%'
    OR (LOWER(nombre) LIKE '%finish%'  AND LOWER(nombre) LIKE '%detergente%')
    OR (LOWER(nombre) LIKE '%ayudin%'  AND LOWER(nombre) NOT LIKE '%toalla%')
  );

-- 2.3  CERAS (id 17)
--      Autobrillo, ceramicol, echo, brillo resistente, blem crema, restaurador
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'CERAS')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%autobrillo%'
    OR LOWER(nombre) LIKE '%ceramicol%'
    OR LOWER(nombre) LIKE 'echo%'
    OR LOWER(nombre) LIKE '%brillo resistente%'
    OR LOWER(nombre) LIKE '%blem en crema%'
    OR LOWER(nombre) LIKE '%restaurador de muebles%'
    OR LOWER(nombre) LIKE '%limpiatecho%'
  );

-- También desde AEROSOL (id 9): blem aerosol y lustra muebles son ceras
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'CERAS')
WHERE categoria_id = 9
  AND (
       LOWER(nombre) LIKE '%blem%'
    OR LOWER(nombre) LIKE '%lustra muebles%'
  );

-- 2.4  ESPONJAS (id 15)
--      Estropajo de acero, lana de acero
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'ESPONJAS')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%estropajo%'
    OR LOWER(nombre) LIKE '%lana de acero%'
  );

-- 2.5  REJILLAS-PAÑOS-FRANELAS (id 20)
--      Repasadores, paño esponja/microfibra, toallita multiusos
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'REJILLAS-PAÑOS-FRANELAS')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%repasador%'
    OR (LOWER(nombre) LIKE '%paño%' AND LOWER(nombre) LIKE '%esponja%')
    OR (LOWER(nombre) LIKE '%paño%' AND LOWER(nombre) LIKE '%microfibra%')
    OR LOWER(nombre) LIKE '%toallita varios%'
    OR (LOWER(nombre) LIKE '%guante%' AND LOWER(nombre) LIKE '%microfibra%')
  );

-- 2.6  ESCOBAS-ESCOBILLONES-PLUMEROS (id 3)
--      Barrehojas, palas de limpieza, rastrillo
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'ESCOBAS-ESCOBILLONES-PLUMEROS')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%barrehojas%'
    OR LOWER(nombre) LIKE '%pala plastica%'
    OR LOWER(nombre) LIKE '%pala medialuna%'
    OR LOWER(nombre) LIKE '%pala rebatible%'
    OR LOWER(nombre) LIKE '%pala con cabo%'
    OR LOWER(nombre) LIKE '%rastrillo de alambre%'
  );

-- 2.7  LYSOFORM (id 14)
--      Procenex, Odex, Mr. Músculo, Harpic, CIF limpiador, sanitizante, antigrasa,
--      limpiavidrios, guantes goma (para limpieza), fluido Manchester, brasso
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'LYSOFORM')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%procenex%'
    OR LOWER(nombre) LIKE '%odex%'
    OR LOWER(nombre) LIKE '%mr. musculo%'
    OR LOWER(nombre) LIKE '%mr.musculo%'
    OR LOWER(nombre) LIKE '%harpic%'
    OR (LOWER(nombre) LIKE '%cif%'        AND LOWER(nombre) NOT LIKE '%lavavajilla%')
    OR LOWER(nombre) LIKE '%limpiador cremoso%'
    OR LOWER(nombre) LIKE '%limpiador polvo%'
    OR LOWER(nombre) LIKE '%limpiahornos%'
    OR LOWER(nombre) LIKE '%limpiavidrio%'
    OR (LOWER(nombre) LIKE '%sanitizante%' AND LOWER(nombre) NOT LIKE '%make x 200%')
    OR (LOWER(nombre) LIKE '%antigrasa%'   AND LOWER(nombre) NOT LIKE '%magistral%')
    OR LOWER(nombre) LIKE '%zorro cocina%'
    OR LOWER(nombre) LIKE '%gel limpiador pato%'
    OR LOWER(nombre) LIKE '%limpia metales%'
    OR LOWER(nombre) LIKE '%limpia vidrios%'
    OR LOWER(nombre) LIKE '%brasso%'
    OR LOWER(nombre) LIKE '%fluido manchester%'
    OR (LOWER(nombre) LIKE '%guante goma%')
    OR (LOWER(nombre) LIKE '%guantes goma%')
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%5 litros%'
        AND LOWER(nombre) NOT LIKE '%quemar%')
  );

-- También desde AEROSOL: desinfectantes y limpiadores en aerosol son Lysoform
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'LYSOFORM')
WHERE categoria_id = 9
  AND (
       LOWER(nombre) LIKE '%desinfectante ayudin%'
    OR LOWER(nombre) LIKE '%smell fresh%'
    OR LOWER(nombre) LIKE '%limpia horno%'
    OR LOWER(nombre) LIKE '%mr.musculo limpiavidrio%'
    OR LOWER(nombre) LIKE '%mr. musculo limpiavidrio%'
  );

-- 2.8  SODA CAUSTICA - CAUCHET (id 21)
--      Soda, decapante, floc, power floc, corrector pH, solución alcalina, hipoclorito puro
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'SODA CAUSTICA - CAUCHET')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%soda liquida%'
    OR LOWER(nombre) LIKE 'soda x %'
    OR LOWER(nombre) LIKE '%decapante%'
    OR LOWER(nombre) LIKE 'floc x%'
    OR LOWER(nombre) LIKE '%power floc%'
    OR LOWER(nombre) LIKE 'dab x%'
    OR LOWER(nombre) LIKE '%corrector de ph%'
    OR LOWER(nombre) LIKE '%solucion alcalina%'
    OR LOWER(nombre) LIKE '%hipoclorito de sodio%'
  );

-- 2.9  SUAVIZANTES (id 22)
--      Camellito, apresto, Vanish, quitamanchas Trenet
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'SUAVIZANTES')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%camellito%'
    OR LOWER(nombre) LIKE '%apresto%'
    OR LOWER(nombre) LIKE '%vanish%'
    OR LOWER(nombre) LIKE '%quita mancha trenet%'
    OR LOWER(nombre) LIKE '%quitamancha trenet%'
  );

-- 2.10 DESODORANTES (id 5)
--      Nivea roll-on, Odorono, Kevin, antitranspirante
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'DESODORANTES')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%antitranspirante%'
    OR LOWER(nombre) LIKE '%des.odorono%'
    OR LOWER(nombre) LIKE '%desororante%'
    OR LOWER(nombre) LIKE '%odorono%'
    OR LOWER(nombre) LIKE '%desodoran%'
    OR (LOWER(nombre) LIKE '%kevin%'  AND LOWER(nombre) LIKE '%cc%')
    OR (LOWER(nombre) LIKE '%nivea%'  AND (LOWER(nombre) LIKE '%roll%' OR LOWER(nombre) LIKE '%atp%'))
  );

-- También desde AEROSOL: poett y aromatizante son desodorantes de ambiente
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'DESODORANTES')
WHERE categoria_id = 9
  AND (
       LOWER(nombre) LIKE '%poett%'
    OR LOWER(nombre) LIKE '%aromatizante%'
  );

-- 2.11 PASTILLAS DE DESODORANTE (id 8)
--      Naftalina, canasta inodoro Glade, pato bloque, aparatos Glade,
--      glade automático, difusor de varilla
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'PASTILLAS DE DESODORANTE')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%naftalina%'
    OR LOWER(nombre) LIKE '%canasta para inodoro%'
    OR LOWER(nombre) LIKE '%repuesto canasta%inodoro%'
    OR LOWER(nombre) LIKE '%pato bloque%'
    OR LOWER(nombre) LIKE '%pato purific%'
    OR LOWER(nombre) LIKE '%glade automatico%'
    OR LOWER(nombre) LIKE '%repuesto glade toque%'
    OR LOWER(nombre) LIKE '%aceites glade naturales%'
    OR LOWER(nombre) LIKE '%aparato natural aceite glade%'
    OR LOWER(nombre) LIKE '%aparato toque full glade%'
    OR LOWER(nombre) LIKE '%glade mini gel%'
    OR LOWER(nombre) LIKE '%difusor vidrio de varilla%'
  );

-- 2.12 PAPEL HIGIENICO - ROLLO DE COCINA (id 7)
--      Bobinas de papel, carilina, toalla de papel intercalada, papel higeniol
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'PAPEL HIGIENICO - ROLLO DE COCINA')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%bobina de papel%'
    OR LOWER(nombre) LIKE '%carilina%'
    OR LOWER(nombre) LIKE '%toalla de papel%'
    OR LOWER(nombre) LIKE '%papel higeniol%'
  );


-- =============================================================================
-- SECCIÓN 3: MOVER A NUEVAS CATEGORÍAS (aún desde id 10, o también desde id 9)
-- =============================================================================

-- 3.1  ALIMENTOS MASCOTAS
--      Dogui, Sabrocito, Pedigree, Whiskas, Gati, Dog Chow, alimentos pet
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'ALIMENTOS MASCOTAS')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%dogui%'
    OR LOWER(nombre) LIKE '%sabrocito%'
    OR LOWER(nombre) LIKE 'pedigree%'
    OR LOWER(nombre) LIKE '%pedrigue%'
    OR LOWER(nombre) LIKE '%whiskas%'
    OR LOWER(nombre) LIKE '%matute gato%'
    OR LOWER(nombre) LIKE '%dog chow%'
    OR LOWER(nombre) LIKE 'gati %'
    OR LOWER(nombre) LIKE '%alimento para gato%'
    OR LOWER(nombre) LIKE '%alimento para perro%'
    OR (LOWER(nombre) LIKE '%pedritas%' AND LOWER(nombre) LIKE '%kilo%')
  );

-- 3.2  ALIMENTOS Y BEBIDAS
--      Tés, cafés, yerba, azúcar, sal, sopas, conservas, especias Alicante,
--      condimentos, arroz, fideos, caldos, mate cocido, filtros de papel café
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'ALIMENTOS Y BEBIDAS')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE 'te %'                     -- TE BOLDO, TE VERDE, TE CEDRON...
    OR LOWER(nombre) LIKE 'te s%'                    -- TE SABORIZADO
    OR LOWER(nombre) LIKE '%mate cocido%'
    OR LOWER(nombre) LIKE '%cafe %'
    OR (LOWER(nombre) LIKE '%cafe%'    AND LOWER(nombre) LIKE '%frasco%')
    OR (LOWER(nombre) LIKE '%cafe%'    AND LOWER(nombre) LIKE '%saquito%')
    OR (LOWER(nombre) LIKE '%cafe%'    AND LOWER(nombre) LIKE '%instantaneo%')
    OR (LOWER(nombre) LIKE '%cafe%'    AND LOWER(nombre) LIKE '%molido%')
    OR LOWER(nombre) LIKE '%cappuccino%'
    OR LOWER(nombre) LIKE '%cappuchino%'
    OR LOWER(nombre) LIKE '%yerba%'
    OR LOWER(nombre) LIKE '%azucar%'
    OR LOWER(nombre) LIKE 'sal %'
    OR LOWER(nombre) LIKE 'sal2%'
    OR (LOWER(nombre) LIKE '%arroz%'   AND LOWER(nombre) LIKE '%luchetti%')
    OR LOWER(nombre) LIKE '%lenteja en lata%'
    OR LOWER(nombre) LIKE '%garbanzos%'
    OR LOWER(nombre) LIKE '%porotos%'
    OR LOWER(nombre) LIKE '%remolacha%'
    OR LOWER(nombre) LIKE '%tomate entero%'
    OR LOWER(nombre) LIKE '%tomate perita%'
    OR LOWER(nombre) LIKE '%arvejas%'
    OR LOWER(nombre) LIKE '%choclo%'
    OR LOWER(nombre) LIKE '%jardinera%'
    OR LOWER(nombre) LIKE '%durazno mitades%'
    OR LOWER(nombre) LIKE '%coctel%frutas%'
    OR LOWER(nombre) LIKE '%pure de papa%'
    OR LOWER(nombre) LIKE '%caldo%verdura%'
    OR LOWER(nombre) LIKE '%queso rallado%'
    OR LOWER(nombre) LIKE '%pate swift%'
    OR LOWER(nombre) LIKE '%picadillo%'
    OR LOWER(nombre) LIKE 'sopa %'
    OR LOWER(nombre) LIKE '%condimento para%'
    OR LOWER(nombre) LIKE '%aji triturado%'
    OR LOWER(nombre) LIKE '%ajo triturado%'
    OR LOWER(nombre) LIKE '%albahaca%'
    OR LOWER(nombre) LIKE '%anis grano%'
    OR LOWER(nombre) LIKE '%azafran%'
    OR LOWER(nombre) LIKE '%bicarbonato%'
    OR LOWER(nombre) LIKE '%canela en rama%'
    OR LOWER(nombre) LIKE '%canela molida%'
    OR LOWER(nombre) LIKE '%cebolla deshidratada%'
    OR LOWER(nombre) LIKE '%chocolino%'
    OR LOWER(nombre) LIKE '%coco rallado%'
    OR LOWER(nombre) LIKE '%comino molido%'
    OR LOWER(nombre) LIKE '%extracto de tomate%'
    OR LOWER(nombre) LIKE '%giacomo%'
    OR LOWER(nombre) LIKE '%laurel hoja%'
    OR LOWER(nombre) LIKE '%mix a las brasas%'
    OR LOWER(nombre) LIKE '%mix criollo%'
    OR LOWER(nombre) LIKE '%mix curry%'
    OR LOWER(nombre) LIKE '%mix crocante%'
    OR LOWER(nombre) LIKE '%mix finas hierbas%'
    OR LOWER(nombre) LIKE '%mix italiano%'
    OR LOWER(nombre) LIKE '%mix oriental%'
    OR LOWER(nombre) LIKE '%mix parrilla%'
    OR LOWER(nombre) LIKE '%mix picante%'
    OR LOWER(nombre) LIKE '%molinillo pimienta%'
    OR LOWER(nombre) LIKE '%nuez moscada%'
    OR LOWER(nombre) LIKE '%oregano%'
    OR LOWER(nombre) LIKE '%perejil%'
    OR LOWER(nombre) LIKE '%pimenton%'
    OR LOWER(nombre) LIKE '%pimienta%'
    OR LOWER(nombre) LIKE '%provenzal%'
    OR LOWER(nombre) LIKE '%romero%'
    OR LOWER(nombre) LIKE '%saborizador%'
    OR LOWER(nombre) LIKE '%saborizaron%'
    OR LOWER(nombre) LIKE '%salsa%alicante%'
    OR LOWER(nombre) LIKE '%salsa blanca%'
    OR LOWER(nombre) LIKE '%salsa 4 quesos%'
    OR LOWER(nombre) LIKE '%salsa champignon%'
    OR LOWER(nombre) LIKE '%semilla%'
    OR LOWER(nombre) LIKE '%tomillo%'
    OR LOWER(nombre) LIKE 'tuy%'
    OR LOWER(nombre) LIKE '%vainilla liquida%'
    OR LOWER(nombre) LIKE '%vinagre%'
    OR LOWER(nombre) LIKE '%exhibidor saborizante%'
    OR LOWER(nombre) LIKE '%filtro de papel cafe%'
    OR LOWER(nombre) LIKE '%filtro  de  papel%'
    OR LOWER(nombre) LIKE '%especies surtida%'
    OR LOWER(nombre) LIKE '%especias%'
  );

-- 3.3  HIGIENE PERSONAL
--      Shampoo, dentífrico, talcos, prestobarba, espuma afeitar, algodón,
--      hisopos, cotonetes, cremas corporales, protectores/toallas femeninas,
--      tampones, pañales, barbijos, guantes de latex/nitrilo, quitaesmalte,
--      alcohol personal (gel, 70%, <5L), cepillos dentales
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'HIGIENE PERSONAL')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%shampoo%'
    OR LOWER(nombre) LIKE '%shampu%'
    OR LOWER(nombre) LIKE 'sha.%'
    OR LOWER(nombre) LIKE '%crema de enj%'
    OR LOWER(nombre) LIKE '%crema hinds%'
    OR LOWER(nombre) LIKE '%dentrifico%'
    OR LOWER(nombre) LIKE '%cepillo dental%'
    OR LOWER(nombre) LIKE '%cepillo de dientes%'
    OR LOWER(nombre) LIKE '%talco%'
    OR LOWER(nombre) LIKE '%prestobarba%'
    OR LOWER(nombre) LIKE '%espuma de afeitar%'
    OR LOWER(nombre) LIKE '%hisopos%'
    OR LOWER(nombre) LIKE '%cotonetes%'
    OR LOWER(nombre) LIKE '%algodon%'
    OR LOWER(nombre) LIKE '%curitas%'
    OR LOWER(nombre) LIKE '%toalla%femenina%'
    OR LOWER(nombre) LIKE '%toa.fem%'
    OR LOWER(nombre) LIKE '%protector diario%'
    OR LOWER(nombre) LIKE '%tampones%'
    OR LOWER(nombre) LIKE '%pañal%'
    OR LOWER(nombre) LIKE '%barbijos%'
    OR (LOWER(nombre) LIKE '%guante%' AND LOWER(nombre) LIKE '%latex%'
        AND LOWER(nombre) NOT LIKE '%goma%')
    OR (LOWER(nombre) LIKE '%guantes%' AND LOWER(nombre) LIKE '%latex%'
        AND LOWER(nombre) NOT LIKE '%goma%')
    OR LOWER(nombre) LIKE '%guante soft%'
    OR LOWER(nombre) LIKE '%guante nitrilo%'
    OR LOWER(nombre) LIKE '%toallitas humedas%'
    OR LOWER(nombre) LIKE '%quitaesmalte%'
    OR LOWER(nombre) LIKE '%gel lord cheseline%'
    OR LOWER(nombre) LIKE '%gel kalindys%'
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%gel%')
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%70%')
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%etilico%')
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%bialcohol%')
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%biocohol%')
    OR LOWER(nombre) LIKE '%alcohol purocol%'
    OR LOWER(nombre) LIKE '%pomada para calzado%'
    OR LOWER(nombre) LIKE '%lustra zapato%'
    OR LOWER(nombre) LIKE '%cepillo calzado%'
    OR LOWER(nombre) LIKE '%cepillo aplicador betun%'
    OR LOWER(nombre) LIKE '%betun%'
    OR LOWER(nombre) LIKE '%estopa de algodon%'
  );

-- También desde AEROSOL: alcohol aerosol es higiene personal
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'HIGIENE PERSONAL')
WHERE categoria_id = 9
  AND LOWER(nombre) LIKE '%alcohol aerosol%';

-- 3.4  INSECTICIDAS Y REPELENTES
--      Raid (todas las formas), espirales, tabletas mosquito, OFF, fuyi,
--      mosquitrap, hormiguicida, matamoscas, cebos, repelentes, porta espirales
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'INSECTICIDAS Y REPELENTES')
WHERE categoria_id IN (9, 10)  -- desde VARIOS y desde AEROSOL
  AND (
       LOWER(nombre) LIKE '%espirales%'
    OR LOWER(nombre) LIKE '%espiral%raid%'
    OR LOWER(nombre) LIKE '%tableta%mosquito%'
    OR LOWER(nombre) LIKE '%tableta%mosq%'
    OR LOWER(nombre) LIKE 'raid %'
    OR LOWER(nombre) LIKE '%raid casa%'
    OR LOWER(nombre) LIKE '%raid cucaracha%'
    OR LOWER(nombre) LIKE '%mata cucaracha%'
    OR LOWER(nombre) LIKE '%cebo cucaracha%'
    OR LOWER(nombre) LIKE '%mosquitrap%'
    OR LOWER(nombre) LIKE '%fuyi matamosca%'
    OR LOWER(nombre) LIKE '%tableta mosquito fuyi%'
    OR LOWER(nombre) LIKE '%hormiguicida%'
    OR LOWER(nombre) LIKE '%insectisida%'
    OR LOWER(nombre) LIKE '%insecticida%'
    OR LOWER(nombre) LIKE '%matamosca%'
    OR LOWER(nombre) LIKE '%mata mosca%'
    OR LOWER(nombre) LIKE '%ultra polvo matamosca%'
    OR LOWER(nombre) LIKE '%cebo ultra%laucha%'
    OR LOWER(nombre) LIKE '%palmeta matamosca%'
    OR LOWER(nombre) LIKE '%porta espirales%'
    OR LOWER(nombre) LIKE '%aparato raid%'
    OR LOWER(nombre) LIKE '%aparato tableta%'
    OR (LOWER(nombre) LIKE '%repelente%' AND LOWER(nombre) NOT LIKE '%cable%')
    OR (LOWER(nombre) LIKE 'off %'     AND LOWER(nombre) LIKE '%crema%')
    OR (LOWER(nombre) LIKE 'off %'     AND LOWER(nombre) LIKE '%aero%')
    OR (LOWER(nombre) LIKE 'off %'     AND LOWER(nombre) LIKE '%extra duracion%')
  );

-- 3.5  BOLSAS Y DESCARTABLES
--      Bolsas residuos (MAKE, DOTTI, FLOWI), consorcio, freezer, herméticas, ecológicas
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'BOLSAS Y DESCARTABLES')
WHERE categoria_id = 10
  AND (
       LOWER(nombre) LIKE '%bolsa%residuos%'
    OR LOWER(nombre) LIKE '%bolsas%residuos%'
    OR LOWER(nombre) LIKE '%bolsa dotti%'
    OR LOWER(nombre) LIKE '%bolsas dotti%'
    OR LOWER(nombre) LIKE '%bolsa make%cierre%'
    OR LOWER(nombre) LIKE '%bolsas make%consorcio%'
    OR LOWER(nombre) LIKE '%bolsa make%consorcio%'
    OR LOWER(nombre) LIKE '%bolsas flowi%'
    OR LOWER(nombre) LIKE '%bolsa de residuos%'
    OR LOWER(nombre) LIKE '%bolsa de consorcio%'
    OR (LOWER(nombre) LIKE '%bolsa%'  AND LOWER(nombre) LIKE '%freezer%')
    OR LOWER(nombre) LIKE '%bolsa para horno%'
    OR LOWER(nombre) LIKE '%bolsa ecologica%'
    OR LOWER(nombre) LIKE '%bolsa hermetica%'
    OR LOWER(nombre) LIKE '%bolsas siliconada%'
    OR LOWER(nombre) LIKE '%bolsa de feria%'
  );

-- 3.6  BAZAR Y UTENSILLOS (categoría más amplia — se ejecuta al final)
--      Incluye: utensilios de cocina, moldes, mate/termos, cestos, macetas,
--      alfombras/felpudos, perchas, abrelatas, velas, pilas, encendedores,
--      artículos de hogar en general que no encajan en las anteriores
UPDATE productos
SET categoria_id = (SELECT id FROM categorias WHERE nombre = 'BAZAR Y UTENSILLOS')
WHERE categoria_id = 10
  AND (
       -- MOLDES Y TARTERAS
       LOWER(nombre) LIKE '%molde %'
    OR LOWER(nombre) LIKE '%tartera%'
    OR LOWER(nombre) LIKE '%tortera%'
    OR LOWER(nombre) LIKE '%budinera%'
    OR LOWER(nombre) LIKE '%pizzera%'
    -- FUENTES / RECIPIENTES DE VIDRIO
    OR LOWER(nombre) LIKE '%fuente%vidrio%'
    OR LOWER(nombre) LIKE '%fuente para horno%'
    OR LOWER(nombre) LIKE '%fuente cuadra%'
    OR LOWER(nombre) LIKE '%fuente hudson%'
    OR LOWER(nombre) LIKE '%fuente redonda vidrio%'
    OR LOWER(nombre) LIKE '%fuente vidrio%'
    -- OLLAS, SARTENES, CACEROLAS
    OR LOWER(nombre) LIKE '%cacerola%'
    OR LOWER(nombre) LIKE '%sarten%'
    OR LOWER(nombre) LIKE '%tostador%'
    -- JARRAS, VASOS, PLATOS
    OR LOWER(nombre) LIKE '%jarra%'
    OR LOWER(nombre) LIKE '%jarro%'
    OR LOWER(nombre) LIKE '%vaso vidrio%'
    OR LOWER(nombre) LIKE '%vasos vidrio%'
    OR LOWER(nombre) LIKE '%plato hondo%'
    OR LOWER(nombre) LIKE '%plato playo%'
    OR LOWER(nombre) LIKE '%plato triangular%'
    OR LOWER(nombre) LIKE '%bowl premiun%'
    -- UTENSILIOS COCINA
    OR LOWER(nombre) LIKE '%cucharon%'
    OR (LOWER(nombre) LIKE '%cuchara%'    AND LOWER(nombre) NOT LIKE '%filtro%')
    OR LOWER(nombre) LIKE '%espatula%'
    OR LOWER(nombre) LIKE '%espumadera%'
    OR LOWER(nombre) LIKE '%colador%'
    OR LOWER(nombre) LIKE '%colapastas%'
    OR LOWER(nombre) LIKE '%batidor%'
    OR LOWER(nombre) LIKE '%destapador%'
    OR LOWER(nombre) LIKE '%pelapapa%'
    OR LOWER(nombre) LIKE '%sacacorcho%'
    OR LOWER(nombre) LIKE '%sacafuente%'
    OR LOWER(nombre) LIKE '%organizador de cubiertos%'
    OR LOWER(nombre) LIKE '%exprimidor%'
    OR LOWER(nombre) LIKE '%centrifuga para verduras%'
    OR LOWER(nombre) LIKE '%ñoquera%'
    OR LOWER(nombre) LIKE '%paleta de nylon%'
    OR LOWER(nombre) LIKE '%paleta calada nylon%'
    OR LOWER(nombre) LIKE '%servidor nylon de%'
    OR LOWER(nombre) LIKE '%pisa papas%'
    OR LOWER(nombre) LIKE '%pinza para fiambre%'
    OR LOWER(nombre) LIKE '%tabla plastica%'
    OR LOWER(nombre) LIKE '%tabla redonda%'
    -- TAZAS, CUBIERTOS
    OR LOWER(nombre) LIKE '%taza porcelana%'
    OR LOWER(nombre) LIKE '%juego%cubiertos%'
    OR LOWER(nombre) LIKE '%juego de cubiertos%'
    OR LOWER(nombre) LIKE '%juego de cuchillos%'
    OR LOWER(nombre) LIKE '%juego cacerola%'
    OR LOWER(nombre) LIKE '%juego de compoteras%'
    OR LOWER(nombre) LIKE '%juego toc toc%'
    OR LOWER(nombre) LIKE '%juego plastico para heladito%'
    OR LOWER(nombre) LIKE '%juego tazas%'
    -- TAPPERS, HERMÉTICOS, CONTENEDORES
    OR LOWER(nombre) LIKE '%taper%'
    OR LOWER(nombre) LIKE '%hermetico%'
    OR LOWER(nombre) LIKE '%tarro hermetico%'
    OR LOWER(nombre) LIKE '%set%taper%'
    OR LOWER(nombre) LIKE '%set%contenedor%'
    OR LOWER(nombre) LIKE '%set de%contenedor%'
    OR (LOWER(nombre) LIKE '%contenedor%'  AND LOWER(nombre) LIKE '%color%')
    OR (LOWER(nombre) LIKE '%contenedor%'  AND LOWER(nombre) LIKE '%make%')
    OR (LOWER(nombre) LIKE '%contenedor%'  AND LOWER(nombre) LIKE '%vidrio%')
    -- MATE Y TERMOS
    OR LOWER(nombre) LIKE '%mate acero%'
    OR LOWER(nombre) LIKE '%mate enlosado%'
    OR LOWER(nombre) LIKE '%mate listo%'
    OR LOWER(nombre) LIKE '%mate madera%'
    OR LOWER(nombre) LIKE '%mate raice%'
    OR LOWER(nombre) LIKE '%mate viajero%'
    OR LOWER(nombre) LIKE '%set matero%'
    OR LOWER(nombre) LIKE '%set 2 latas%'
    OR LOWER(nombre) LIKE '%set duo%yerbera%'
    OR LOWER(nombre) LIKE '%canasta matera%'
    OR LOWER(nombre) LIKE '%set matero%'
    OR LOWER(nombre) LIKE '%botella termica%'
    OR LOWER(nombre) LIKE '%bombilla%'
    OR LOWER(nombre) LIKE 'termo %'
    OR LOWER(nombre) LIKE 'termo%acero%'
    OR LOWER(nombre) LIKE 'termo x%'
    -- PAVA
    OR LOWER(nombre) LIKE '%pava%'
    -- ENSALADERAS Y SALEROS
    OR LOWER(nombre) LIKE '%ensaladera%'
    OR LOWER(nombre) LIKE '%especiero%'
    OR LOWER(nombre) LIKE '%salero%'
    OR LOWER(nombre) LIKE '%mostacero%'
    -- BALDES, FUENTONES, PALANGANAS, BATEAS
    OR LOWER(nombre) LIKE '%balde%'
    OR LOWER(nombre) LIKE '%fuenton%'
    OR LOWER(nombre) LIKE '%palangana%'
    OR LOWER(nombre) LIKE '%batea%'
    -- CESTOS Y CANASTOS
    OR LOWER(nombre) LIKE '%cesto residuos%'
    OR LOWER(nombre) LIKE '%cesto basura%'
    OR LOWER(nombre) LIKE '%cesto pedal%'
    OR LOWER(nombre) LIKE '%cesto con pedal%'
    OR LOWER(nombre) LIKE '%cesto multiuso%'
    OR LOWER(nombre) LIKE '%cesto para ropa%'
    OR LOWER(nombre) LIKE '%cesto rejilla%'
    OR LOWER(nombre) LIKE '%cesta basura%'
    OR LOWER(nombre) LIKE '%canasto calado%'
    OR LOWER(nombre) LIKE '%canasto%ropa%'
    -- ALFOMBRAS, CORTINAS, PERCHAS
    OR LOWER(nombre) LIKE '%alfombra%'
    OR LOWER(nombre) LIKE '%felpudo%'
    OR LOWER(nombre) LIKE '%felpudin%'
    OR LOWER(nombre) LIKE '%cortina%'
    OR LOWER(nombre) LIKE '%percha%'
    OR LOWER(nombre) LIKE '%broche%'
    OR LOWER(nombre) LIKE '%tender%'
    -- MACETAS Y JARDINERÍA
    OR LOWER(nombre) LIKE '%maceta%'
    OR LOWER(nombre) LIKE '%regadera%'
    OR LOWER(nombre) LIKE '%regador%'
    OR LOWER(nombre) LIKE '%pistola%riego%'
    OR LOWER(nombre) LIKE '%lanza%conector%'
    OR LOWER(nombre) LIKE '%jardinera x%'
    -- ILUMINACIÓN Y ENERGÍA
    OR LOWER(nombre) LIKE '%vela %'
    OR LOWER(nombre) LIKE '%velas%'
    OR LOWER(nombre) LIKE 'pila %'
    OR LOWER(nombre) LIKE 'pilas%'
    OR LOWER(nombre) LIKE '%lampara%'
    OR LOWER(nombre) LIKE '%encendedor%'
    OR LOWER(nombre) LIKE '%encendedores%'
    OR LOWER(nombre) LIKE '%fosforos%'
    -- MENAJE Y OTROS
    OR LOWER(nombre) LIKE '%abrelata%'
    OR LOWER(nombre) LIKE '%abrelatas%'
    OR LOWER(nombre) LIKE '%bidon%'
    OR LOWER(nombre) LIKE '%dispenser%'
    OR LOWER(nombre) LIKE '%palillero%'
    OR LOWER(nombre) LIKE '%filtro de cafe%'
    OR LOWER(nombre) LIKE '%filtro  de  cafe%'
    OR LOWER(nombre) LIKE '%escalera aluminio%'
    OR LOWER(nombre) LIKE '%carro para compras%'
    OR LOWER(nombre) LIKE '%carro porta elementos%'
    OR LOWER(nombre) LIKE '%botella vidrio%'
    OR LOWER(nombre) LIKE '%boligrafo%'
    OR LOWER(nombre) LIKE '%paper mate%'
    OR LOWER(nombre) LIKE '%bloque adhesivo%'
    OR LOWER(nombre) LIKE '%embudo%'
    OR LOWER(nombre) LIKE '%cubetera%'
    OR LOWER(nombre) LIKE '%porta sachet%'
    OR LOWER(nombre) LIKE '%porta espirales%'  -- los que no pasaron a INSECTICIDAS
    OR LOWER(nombre) LIKE '%bañadera%'
    OR LOWER(nombre) LIKE '%separadores para freezer%'
    OR LOWER(nombre) LIKE '%boya%'
  );


-- =============================================================================
-- VERIFICACIÓN FINAL: comparar con el resultado inicial
-- =============================================================================
SELECT c.nombre AS categoria, COUNT(p.id) AS total_productos
FROM categorias c
LEFT JOIN productos p ON p.categoria_id = c.id
GROUP BY c.id, c.nombre
ORDER BY total_productos DESC;

-- Ver qué quedó en VARIOS (debería ser solo servicios/fletes y casos reales)
SELECT id, nombre
FROM productos
WHERE categoria_id = 10
ORDER BY nombre;

-- Si todo se ve bien:
-- COMMIT;

-- Si algo está mal:
-- ROLLBACK;
