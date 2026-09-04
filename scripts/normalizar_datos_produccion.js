/**
 * normalizar_datos_produccion.js
 *
 * Script ÚNICO de normalización para producción.
 * Incluye:
 *   1) Categorías nuevas + reclasificación de productos (desde PRODUCTOS VARIOS / AEROSOL)
 *   2) Ajuste fino de productos dudosos
 *   3) Normalización de ciudades (variantes, NULL desde dirección, ciudades "sucias")
 *   4) Propagación de ciudad a ventas
 *
 * Idempotente: si ya se corrió, los UPDATEs afectan 0 filas (seguro re-ejecutar).
 * Solo modifica categoria_id / ciudad / cliente_ciudad. No toca precios, stock ni nombres.
 *
 * MODO PREVIEW (sin --apply): START TRANSACTION + ROLLBACK. BD intacta.
 * MODO APPLY   (con --apply): START TRANSACTION + COMMIT.
 *
 * USO (producción):
 *   cd backend
 *   # 1) Verificar que .env apunta a la BD de producción
 *   # 2) Preview obligatorio
 *   node scripts/normalizar_datos_produccion.js
 *   # 3) Si el output se ve bien:
 *   node scripts/normalizar_datos_produccion.js --apply
 */

'use strict';

const mysql = require('mysql2/promise');
const path  = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');

const DB = {
  host    : process.env.DB_HOST     || 'localhost',
  port    : parseInt(process.env.DB_PORT) || 3306,
  user    : process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'erp_distri',
  multipleStatements: false,
};

// ─── helpers de consola ─────────────────────────────────────────────────────
const SEP  = '─'.repeat(70);
const SSEP = '·'.repeat(70);
const log  = console.log;
const h1   = (t) => { log('\n' + SEP); log('  ' + t); log(SEP); };
const h2   = (t) => { log('\n' + SSEP); log('  ' + t); log(SSEP); };

function table(rows, cols) {
  if (!rows.length) { log('    (sin resultados)'); return; }
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const fmt = (r) => cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  │  ');
  log('    ' + cols.map((c, i) => c.padEnd(widths[i])).join('  │  '));
  log('    ' + widths.map(w => '─'.repeat(w)).join('──┼──'));
  rows.forEach(r => log('    ' + fmt(r)));
}

// ─── operaciones de productos ─────────────────────────────────────────────────
const VARIANTES_CIUDADES = {
  'GENERAL PICO': [
    `TRIM(UPPER(ciudad)) = 'PICO'`,
    `TRIM(ciudad) = ''`,
  ],
  'COLONIA BARON': [
    `LOWER(TRIM(ciudad)) IN ('colonia baron','baron','col. baron','col baron')`,
  ],
  'VILLA MIRASOL': [
    `LOWER(TRIM(ciudad)) IN ('villa mirasol','mirasol','v. mirasol')`,
  ],
  'INGENIERO LUIGGI': [
    `LOWER(TRIM(ciudad)) IN ('luiggi','ing. luiggi','ing luiggi','ingeniero luiggi')`,
  ],
  'INTENDENTE ALVEAR': [
    `LOWER(TRIM(ciudad)) IN ('alvear','int. alvear','int alvear','intendente alvear')`,
  ],
  'EDUARDO CASTEX': [
    `LOWER(TRIM(ciudad)) IN ('castex','ed. castex','ed castex','eduardo castex')`,
  ],
};

// CASE WHEN para detectar ciudad desde dirección
const CIUDAD_DESDE_DIRECCION = `CASE
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%VICTORICA%'         THEN 'VICTORICA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%TRENEL%'            THEN 'TRENEL'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%EDUARDO CASTEX%'    THEN 'EDUARDO CASTEX'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%ED. CASTEX%'        THEN 'EDUARDO CASTEX'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%LA MARUJA%'         THEN 'LA MARUJA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%BUENA ESPERANZA%'   THEN 'BUENA ESPERANZA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%ING. LUIGGI%'       THEN 'INGENIERO LUIGGI'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%INGENIERO LUIGGI%'  THEN 'INGENIERO LUIGGI'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%PARERA%'            THEN 'PARERA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%CALEUFU%'           THEN 'CALEUFU'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%COLONIA BARON%'     THEN 'COLONIA BARON'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%QUEMU QUEMU%'       THEN 'QUEMU QUEMU'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%GONZALEZ MORENO%'   THEN 'GONZALEZ MORENO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%ALTA ITALIA%'       THEN 'ALTA ITALIA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%REALICO%'           THEN 'REALICO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%TELEN%'             THEN 'TELEN'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%RIVADAVIA%'         THEN 'RIVADAVIA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%HUINCA RENANCO%'    THEN 'HUINCA RENANCO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%SPELUZZI%'          THEN 'SPELUZZI'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%CONHELO%'           THEN 'CONHELO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%FORTIN OLAVARRIA%'  THEN 'FORTIN OLAVARRIA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%BERNARDO LARROUDE%' THEN 'BERNARDO LARROUDE'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%AGUSTONI%'          THEN 'AGUSTONI'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%RANCUL%'            THEN 'RANCUL'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%SANTA ROSA%'        THEN 'SANTA ROSA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%ARIZONA%'           THEN 'ARIZONA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%NUEVA GALIA%'       THEN 'NUEVA GALIA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%VILLA HUIDOBRO%'    THEN 'VILLA HUIDOBRO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%METILEO%'           THEN 'METILEO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%LUAN TORO%'         THEN 'LUAN TORO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%-LUAN TORO%'        THEN 'LUAN TORO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%DORILA%'            THEN 'DORILA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%VILLA MIRASOL%'     THEN 'VILLA MIRASOL'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%PICHI HUINCA%'      THEN 'PICHI HUINCA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%RUCANELO%'          THEN 'RUCANELO'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%CEBALLOS%'          THEN 'CEBALLOS'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%VERTIZ%'            THEN 'VERTIZ'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%ARATA%'             THEN 'ARATA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%ANCHORENA%'         THEN 'ANCHORENA'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%INTENDENTE ALVEAR%' THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%-  ALVEAR%'         THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%- ALVEAR%'          THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%VILLA SAUZE%'       THEN 'VILLA SAUZE'
  WHEN UPPER(TRIM(IFNULL(direccion,''))) LIKE '%VICTORICA%'         THEN 'VICTORICA'
  ELSE 'GENERAL PICO'
END`;

/** Extrae ciudad canónica desde valores "sucios" (dirección mezclada en el campo ciudad) */
const EXTRAER_CIUDAD_SUCIA = `CASE
  WHEN UPPER(TRIM(ciudad)) = 'GENERAL PICO' THEN 'GENERAL PICO'
  WHEN UPPER(ciudad) LIKE '%GENERAL PICO%' THEN 'GENERAL PICO'
  WHEN UPPER(ciudad) LIKE '%VICTORICA%' THEN 'VICTORICA'
  WHEN UPPER(ciudad) LIKE '%TRENEL%' THEN 'TRENEL'
  WHEN UPPER(ciudad) LIKE '%EDUARDO CASTEX%' OR UPPER(ciudad) LIKE '%ED. CASTEX%' THEN 'EDUARDO CASTEX'
  WHEN UPPER(ciudad) LIKE '%SANTA ROSA%' THEN 'SANTA ROSA'
  WHEN UPPER(ciudad) LIKE '%LA MARUJA%' THEN 'LA MARUJA'
  WHEN UPPER(ciudad) LIKE '%COLONIA BARON%' OR UPPER(TRIM(ciudad)) = 'BARON' THEN 'COLONIA BARON'
  WHEN UPPER(ciudad) LIKE '%LUAN TORO%' THEN 'LUAN TORO'
  WHEN UPPER(ciudad) LIKE '%INTENDENTE ALVEAR%' OR UPPER(ciudad) LIKE '%I.ALVEAR%' OR UPPER(ciudad) LIKE '%I. ALVEAR%' THEN 'INTENDENTE ALVEAR'
  WHEN UPPER(ciudad) LIKE '%INGENIERO LUIGGI%' OR UPPER(ciudad) LIKE '%ING. LUIGGI%' THEN 'INGENIERO LUIGGI'
  WHEN UPPER(ciudad) LIKE '%QUEMU QUEMU%' THEN 'QUEMU QUEMU'
  WHEN UPPER(ciudad) LIKE '%CORONEL HILARIO LAGOS%' THEN 'CORONEL HILARIO LAGOS'
  WHEN UPPER(ciudad) LIKE '%MIGUEL CANE%' THEN 'MIGUEL CANE'
  WHEN UPPER(ciudad) LIKE '%MIGUEL RIGLOS%' THEN 'MIGUEL RIGLOS'
  WHEN UPPER(ciudad) LIKE '%RIVADAVIA%' THEN 'RIVADAVIA'
  WHEN UPPER(ciudad) LIKE '%REALICO%' THEN 'REALICO'
  WHEN UPPER(ciudad) LIKE '%PARERA%' THEN 'PARERA'
  WHEN UPPER(ciudad) LIKE '%ARATA%' THEN 'ARATA'
  WHEN UPPER(ciudad) LIKE '%ARIZONA%' THEN 'ARIZONA'
  WHEN UPPER(ciudad) LIKE '%VERTIZ%' THEN 'VERTIZ'
  WHEN UPPER(ciudad) LIKE '%TELEN%' THEN 'TELEN'
  WHEN UPPER(ciudad) LIKE '%CALEUFU%' THEN 'CALEUFU'
  WHEN UPPER(ciudad) LIKE '%ALTA ITALIA%' THEN 'ALTA ITALIA'
  WHEN UPPER(ciudad) LIKE '%GENERAL ACHA%' THEN 'GENERAL ACHA'
  WHEN UPPER(ciudad) LIKE '%CIUDAD AUTONOMA DE BUENOS AIRES%' THEN 'CIUDAD AUTONOMA DE BUENOS AIRES'
  WHEN UPPER(ciudad) LIKE '%UNION SAN LUIS%' THEN 'UNION'
  WHEN UPPER(TRIM(ciudad)) IN ('BIS.','-','111.','20 .','403.','N = 1445') THEN 'GENERAL PICO'
  ELSE NULL
END`;

const WHERE_CIUDAD_SUCIA = `
  ciudad IS NOT NULL AND TRIM(ciudad) != ''
  AND (
    ciudad REGEXP '^[0-9=]'
    OR ciudad LIKE 'Piso:%'
    OR ciudad LIKE 'Dpto:%'
    OR ciudad LIKE 'Dir. Com.:%'
    OR ciudad LIKE 'S:%'
    OR ciudad LIKE 'BIS.%'
    OR ciudad LIKE 'N=%'
    OR ciudad LIKE 'N =%'
    OR ciudad LIKE 'ENTRE %'
    OR ciudad LIKE 'ESQ.%'
    OR ciudad LIKE 'ESQUINA %'
    OR ciudad LIKE 'DEPTO %'
    OR ciudad LIKE 'SARMIENTO %'
    OR ciudad LIKE 'MORENO %'
    OR ciudad LIKE 'MARZO %'
    OR ciudad LIKE 'INDEPENDENCIA%'
    OR ciudad LIKE 'CARETTO %'
    OR ciudad LIKE 'ALPATACOS%'
    OR ciudad LIKE 'NUESTRA %'
    OR ciudad LIKE 'yapeyu%'
    OR ciudad LIKE '% GENERAL PICO'
    OR ciudad LIKE '%. GENERAL PICO'
    OR ciudad LIKE '25 DE MAYO%'
    OR ciudad LIKE 'ARIZONA.'
    OR ciudad LIKE 'REALICO.'
    OR UPPER(TRIM(ciudad)) IN ('BIS.','-','111.','20 .','403.','N = 1445','QUEMU','LARROUDE','A. ITALIA','ITALIA','ROSA','ACHA','OLAVARRIA','PAMPA','FIERRO.','ETELVINO','AIRES')
    OR ciudad LIKE 'Piso:0%'
    OR ciudad LIKE 'Piso:02%'
    OR ciudad LIKE 'S:-%'
    OR ciudad LIKE 'S:0%'
    OR ciudad LIKE 'UNION %'
    OR ciudad LIKE 'HUINCA RENANCO CORDOBA'
    OR ciudad LIKE 'RIVADAVIA AMERICA'
    OR ciudad LIKE 'BAGUAL%'
    OR ciudad LIKE 'BARRIO %'
    OR ciudad LIKE 'A C 7%'
    OR ciudad LIKE 'AGUSTONI.%'
    OR ciudad LIKE 'FRENTE%ARIZONA%'
  )
`;

// Bloque de WHERE conditions para cada categoría objetivo
// srcIds: 10 = PRODUCTOS VARIOS, 9 = PRODUCTOS EN AEROSOL (se resuelven por nombre en runtime)
const RECLASIFICACIONES_PRODUCTOS = [

  // ── Categorías EXISTENTES ──────────────────────────────────────────────────

  { cat: 'LAVANDINA', srcIds: [10], where: `LOWER(nombre) LIKE '%lavandina%'` },

  { cat: 'DETERGENTES', srcIds: [10], where: `
       LOWER(nombre) REGEXP '^det[\\\\.\\\\s]'
    OR LOWER(nombre) LIKE '%magistral%'
    OR LOWER(nombre) LIKE '%lavavajilla%'
    OR (LOWER(nombre) LIKE '%finish%'  AND LOWER(nombre) LIKE '%detergente%')
  `},

  { cat: 'CERAS', srcIds: [10], where: `
       LOWER(nombre) LIKE '%autobrillo%'
    OR LOWER(nombre) LIKE '%ceramicol%'
    OR LOWER(nombre) LIKE 'echo%'
    OR LOWER(nombre) LIKE '%brillo resistente%'
    OR LOWER(nombre) LIKE '%blem en crema%'
    OR LOWER(nombre) LIKE '%restaurador de muebles%'
    OR LOWER(nombre) LIKE '%limpiatecho%'
  `},
  { cat: 'CERAS (desde AEROSOL)', srcIds: [9], where: `
    LOWER(nombre) LIKE '%blem%' OR LOWER(nombre) LIKE '%lustra muebles%'
  `},

  { cat: 'ESPONJAS', srcIds: [10], where: `
    LOWER(nombre) LIKE '%estropajo%' OR LOWER(nombre) LIKE '%lana de acero%'
  `},

  { cat: 'REJILLAS-PAÑOS-FRANELAS', srcIds: [10], where: `
       LOWER(nombre) LIKE '%repasador%'
    OR (LOWER(nombre) LIKE '%paño%' AND LOWER(nombre) LIKE '%esponja%')
    OR (LOWER(nombre) LIKE '%paño%' AND LOWER(nombre) LIKE '%microfibra%')
    OR LOWER(nombre) LIKE '%toallita varios%'
    OR (LOWER(nombre) LIKE '%guante%' AND LOWER(nombre) LIKE '%microfibra%')
  `},

  { cat: 'ESCOBAS-ESCOBILLONES-PLUMEROS', srcIds: [10], where: `
       LOWER(nombre) LIKE '%barrehojas%'
    OR LOWER(nombre) LIKE '%pala plastica%'
    OR LOWER(nombre) LIKE '%pala medialuna%'
    OR LOWER(nombre) LIKE '%pala rebatible%'
    OR LOWER(nombre) LIKE '%pala con cabo%'
    OR LOWER(nombre) LIKE '%rastrillo de alambre%'
    OR LOWER(nombre) LIKE '%escobilla%baño%'
    OR LOWER(nombre) LIKE '%escobilla%inodoro%'
    OR LOWER(nombre) LIKE '%escobilla%wc%'
    OR LOWER(nombre) LIKE '%cepillo piso%'
  `},

  { cat: 'LYSOFORM', srcIds: [10], where: `
       LOWER(nombre) LIKE '%procenex%'
    OR LOWER(nombre) LIKE '%odex%'
    OR LOWER(nombre) LIKE '%mr. musculo%'
    OR LOWER(nombre) LIKE '%mr.musculo%'
    OR LOWER(nombre) LIKE '%harpic%'
    OR (LOWER(nombre) LIKE '%cif%' AND LOWER(nombre) NOT LIKE '%lavavajilla%')
    OR LOWER(nombre) LIKE '%limpiador cremoso%'
    OR LOWER(nombre) LIKE '%limpiador polvo%'
    OR LOWER(nombre) LIKE '%limpiahornos%'
    OR LOWER(nombre) LIKE '%limpiavidrio%'
    OR LOWER(nombre) LIKE '%sanitizante%'
    OR (LOWER(nombre) LIKE '%antigrasa%' AND LOWER(nombre) NOT LIKE '%magistral%')
    OR LOWER(nombre) LIKE '%zorro cocina%'
    OR LOWER(nombre) LIKE '%gel limpiador pato%'
    OR LOWER(nombre) LIKE '%limpia metales%'
    OR LOWER(nombre) LIKE '%limpia vidrios%'
    OR LOWER(nombre) LIKE '%brasso%'
    OR LOWER(nombre) LIKE '%fluido manchester%'
    OR LOWER(nombre) LIKE '%guante goma%'
    OR LOWER(nombre) LIKE '%guantes goma%'
    OR (LOWER(nombre) LIKE '%poett%' AND LOWER(nombre) LIKE '%ph%')
    OR (LOWER(nombre) LIKE '%ayudin%' AND LOWER(nombre) LIKE '%toalla%')
    OR (
         LOWER(nombre) LIKE '%ayudin%'
     AND LOWER(nombre) NOT LIKE '%lavandina%'
     AND LOWER(nombre) NOT LIKE '%canasta%'
     AND LOWER(nombre) NOT LIKE '%pastilla%'
    )
    OR (LOWER(nombre) LIKE '%alcohol%' AND LOWER(nombre) LIKE '%5 litros%' AND LOWER(nombre) NOT LIKE '%quemar%')
  `},
  { cat: 'LYSOFORM (desde AEROSOL)', srcIds: [9], where: `
       LOWER(nombre) LIKE '%desinfectante ayudin%'
    OR LOWER(nombre) LIKE '%smell fresh%'
    OR LOWER(nombre) LIKE '%limpia horno%'
    OR LOWER(nombre) LIKE '%mr.musculo limpiavidrio%'
    OR LOWER(nombre) LIKE '%mr. musculo limpiavidrio%'
  `},

  { cat: 'SODA CAUSTICA - CAUCHET', srcIds: [10], where: `
       LOWER(nombre) LIKE '%soda liquida%'
    OR LOWER(nombre) LIKE 'soda x %'
    OR LOWER(nombre) LIKE '%decapante%'
    OR LOWER(nombre) LIKE 'floc x%'
    OR LOWER(nombre) LIKE '%power floc%'
    OR LOWER(nombre) LIKE 'dab x%'
    OR LOWER(nombre) LIKE '%corrector de ph%'
    OR LOWER(nombre) LIKE '%solucion alcalina%'
    OR LOWER(nombre) LIKE '%hipoclorito de sodio%'
  `},

  { cat: 'SUAVIZANTES', srcIds: [10], where: `
       LOWER(nombre) LIKE '%camellito%'
    OR LOWER(nombre) LIKE '%apresto%'
    OR LOWER(nombre) LIKE '%vanish%'
    OR LOWER(nombre) LIKE '%vanissh%'
    OR LOWER(nombre) LIKE '%quita mancha trenet%'
    OR LOWER(nombre) LIKE '%quitamancha trenet%'
    OR LOWER(nombre) LIKE '%perfumina%'
    OR LOWER(nombre) LIKE '%perffumina%'
    OR LOWER(nombre) LIKE '%perfume para ropa%'
  `},

  { cat: 'DESODORANTES', srcIds: [10], where: `
       LOWER(nombre) LIKE '%antitranspirante%'
    OR LOWER(nombre) LIKE '%des.odorono%'
    OR LOWER(nombre) LIKE '%desororante%'
    OR LOWER(nombre) LIKE '%odorono%'
    OR LOWER(nombre) LIKE '%desodoran%'
    OR (LOWER(nombre) LIKE '%kevin%' AND LOWER(nombre) LIKE '%cc%')
    OR (LOWER(nombre) LIKE '%nivea%' AND (LOWER(nombre) LIKE '%roll%' OR LOWER(nombre) LIKE '%atp%'))
  `},
  { cat: 'DESODORANTES (desde AEROSOL)', srcIds: [9], where: `
    LOWER(nombre) LIKE '%poett%' OR LOWER(nombre) LIKE '%aromatizante%'
  `},

  { cat: 'PASTILLAS DE DESODORANTE', srcIds: [10], where: `
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
    OR LOWER(nombre) LIKE '%auto sport%'
    OR LOWER(nombre) LIKE '%pinitos auto%'
  `},

  { cat: 'PAPEL HIGIENICO - ROLLO DE COCINA', srcIds: [10], where: `
       LOWER(nombre) LIKE '%bobina de papel%'
    OR LOWER(nombre) LIKE '%carilina%'
    OR LOWER(nombre) LIKE '%toalla de papel%'
    OR LOWER(nombre) LIKE '%papel higeniol%'
  `},

  // ── Categorías NUEVAS ──────────────────────────────────────────────────────

  { cat: 'ALIMENTOS MASCOTAS', srcIds: [10], where: `
       LOWER(nombre) LIKE '%dogui%'
    OR LOWER(nombre) LIKE '%sabrocito%'
    OR LOWER(nombre) LIKE 'pedigr%'
    OR LOWER(nombre) LIKE '%pedrig%'
    OR LOWER(nombre) LIKE '%whiskas%'
    OR LOWER(nombre) LIKE '%matute gato%'
    OR LOWER(nombre) LIKE '%dog chow%'
    OR LOWER(nombre) LIKE 'gati %'
    OR LOWER(nombre) LIKE '%alimento para gato%'
    OR LOWER(nombre) LIKE '%alimento para perro%'
    OR (LOWER(nombre) LIKE '%pedritas%' AND LOWER(nombre) LIKE '%kilo%')
  `},

  { cat: 'ALIMENTOS Y BEBIDAS', srcIds: [10], where: `
       LOWER(nombre) LIKE 'te %'
    OR LOWER(nombre) LIKE 'te s%'
    OR LOWER(nombre) LIKE '%mate cocido%'
    OR LOWER(nombre) LIKE '%cafe %'
    OR (LOWER(nombre) LIKE '%cafe%' AND LOWER(nombre) LIKE '%frasco%')
    OR (LOWER(nombre) LIKE '%cafe%' AND LOWER(nombre) LIKE '%saquito%')
    OR (LOWER(nombre) LIKE '%cafe%' AND LOWER(nombre) LIKE '%instantaneo%')
    OR (LOWER(nombre) LIKE '%cafe%' AND LOWER(nombre) LIKE '%molido%')
    OR LOWER(nombre) LIKE '%cappuccino%'
    OR LOWER(nombre) LIKE '%cappuchino%'
    OR (LOWER(nombre) LIKE '%yerba%' AND LOWER(nombre) NOT LIKE '%yerbera%')
    OR LOWER(nombre) LIKE '%azucar%'
    OR LOWER(nombre) LIKE 'sal %'
    OR LOWER(nombre) LIKE 'sal2%'
    OR LOWER(nombre) LIKE '%cocina en bolsa%'
    OR (LOWER(nombre) LIKE '%arroz%' AND LOWER(nombre) LIKE '%luchetti%')
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
    OR LOWER(nombre) LIKE '%condimentos para%'
    OR LOWER(nombre) LIKE '%pure%papa%'
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
  `},

  { cat: 'HIGIENE PERSONAL', srcIds: [10], where: `
       LOWER(nombre) LIKE '%shampoo%'
    OR LOWER(nombre) LIKE '%shampu%'
    OR LOWER(nombre) LIKE 'sha.%'
    OR LOWER(nombre) LIKE 'sha %'
    OR LOWER(nombre) LIKE '%crema%enj%'
    OR LOWER(nombre) LIKE '%crema hinds%'
    OR LOWER(nombre) LIKE '%dentrifico%'
    OR LOWER(nombre) LIKE '%cepillo%dental%'
    OR LOWER(nombre) LIKE '%cepillo de dientes%'
    OR LOWER(nombre) LIKE '%cepillo de uñas%'
    OR LOWER(nombre) LIKE '%talco%'
    OR LOWER(nombre) LIKE '%prestobarba%'
    OR LOWER(nombre) LIKE '%espuma%afeitar%'
    OR LOWER(nombre) LIKE '%hisopos%'
    OR LOWER(nombre) LIKE '%cotonetes%'
    OR LOWER(nombre) LIKE '%algodon%'
    OR LOWER(nombre) LIKE '%curitas%'
    OR LOWER(nombre) LIKE '%toalla%femenina%'
    OR LOWER(nombre) LIKE '%toa.fem%'
    OR LOWER(nombre) LIKE '%toalla calipso%'
    OR LOWER(nombre) LIKE '%toallita calipso%'
    OR LOWER(nombre) LIKE '%toalla doncella%'
    OR LOWER(nombre) LIKE '%toallita doncella%'
    OR LOWER(nombre) LIKE '%protector diario%'
    OR LOWER(nombre) LIKE '%protector%doncella%'
    OR LOWER(nombre) LIKE '%protector%calipso%'
    OR LOWER(nombre) LIKE '%tampones%'
    OR LOWER(nombre) LIKE '%pañal%'
    OR LOWER(nombre) LIKE '%barbijos%'
    OR (LOWER(nombre) LIKE '%guante%' AND LOWER(nombre) LIKE '%latex%' AND LOWER(nombre) NOT LIKE '%goma%')
    OR (LOWER(nombre) LIKE '%guantes%' AND LOWER(nombre) LIKE '%latex%' AND LOWER(nombre) NOT LIKE '%goma%')
    OR LOWER(nombre) LIKE '%guante soft%'
    OR LOWER(nombre) LIKE '%guantes soft%'
    OR LOWER(nombre) LIKE '%guantes moteados%'
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
    OR LOWER(nombre) LIKE '%cepillo%aplicador%betun%'
    OR LOWER(nombre) LIKE '%betun%'
    OR LOWER(nombre) LIKE '%estopa de algodon%'
    OR LOWER(nombre) LIKE '%jabon%shampy%'
  `},
  { cat: 'HIGIENE PERSONAL (desde AEROSOL)', srcIds: [9], where: `
    LOWER(nombre) LIKE '%alcohol aerosol%'
  `},

  { cat: 'INSECTICIDAS Y REPELENTES', srcIds: [9, 10], where: `
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
    OR (LOWER(nombre) LIKE 'off %' AND LOWER(nombre) LIKE '%crema%')
    OR (LOWER(nombre) LIKE 'off %' AND LOWER(nombre) LIKE '%aero%')
    OR (LOWER(nombre) LIKE 'off %' AND LOWER(nombre) LIKE '%extra duracion%')
    OR LOWER(nombre) LIKE '%insectida%'
  `},

  { cat: 'BOLSAS Y DESCARTABLES', srcIds: [10], where: `
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
    OR (LOWER(nombre) LIKE '%bolsa%' AND LOWER(nombre) LIKE '%freezer%')
    OR LOWER(nombre) LIKE '%bolsa para horno%'
    OR LOWER(nombre) LIKE '%bolsa ecologica%'
    OR LOWER(nombre) LIKE '%bolsa hermetica%'
    OR LOWER(nombre) LIKE '%bolsas siliconada%'
    OR LOWER(nombre) LIKE '%bolsa de feria%'
    OR LOWER(nombre) LIKE '%bolsa%dotti%'
  `},

  // Accesorios pileta desde VARIOS
  { cat: 'CLORO Y ACCESORIOS PARA PILETA', srcIds: [10], where: `
       LOWER(nombre) LIKE '%bichero%'
    OR LOWER(nombre) LIKE 'boya %'
    OR LOWER(nombre) LIKE '%cabo para saca bicho%'
  `},

  { cat: 'BAZAR Y UTENSILLOS', srcIds: [10], where: `
       -- MOLDES Y TARTERAS
       LOWER(nombre) LIKE '%molde %'
    OR LOWER(nombre) LIKE '%tartera%'
    OR LOWER(nombre) LIKE '%tortera%'
    OR LOWER(nombre) LIKE '%budinera%'
    OR LOWER(nombre) LIKE '%pizzera%'
    OR LOWER(nombre) LIKE '%panquequera%'
    -- FUENTES / VIDRIO / RECIPIENTES PARA HORNO
    OR LOWER(nombre) LIKE '%fuente%vidrio%'
    OR LOWER(nombre) LIKE '%fuente%horno%'
    OR LOWER(nombre) LIKE '%fuente cuadra%'
    OR LOWER(nombre) LIKE '%fuente hudson%'
    OR LOWER(nombre) LIKE '%fuente%redonda%'
    -- OLLAS, SARTENES
    OR LOWER(nombre) LIKE '%cacerola%'
    OR LOWER(nombre) LIKE '%olla%'
    OR LOWER(nombre) LIKE '%sarten%'
    OR LOWER(nombre) LIKE '%tostador%'
    -- JARRAS, VASOS, PLATOS
    OR LOWER(nombre) LIKE '%jarra%'
    OR LOWER(nombre) LIKE '%jarro%'
    OR LOWER(nombre) LIKE '%vaso%'
    OR LOWER(nombre) LIKE '%plato hondo%'
    OR LOWER(nombre) LIKE '%plato playo%'
    OR LOWER(nombre) LIKE '%plato triangular%'
    OR LOWER(nombre) LIKE '%bowl premiun%'
    -- UTENSILIOS COCINA
    OR LOWER(nombre) LIKE '%cucharon%'
    OR (LOWER(nombre) LIKE '%cuchara%'    AND LOWER(nombre) NOT LIKE '%filtro%')
    OR LOWER(nombre) LIKE '%cucharita%'
    OR LOWER(nombre) LIKE '%espatula%'
    OR LOWER(nombre) LIKE '%espumadera%'
    OR LOWER(nombre) LIKE '%espumader%'
    OR LOWER(nombre) LIKE '%colador%'
    OR LOWER(nombre) LIKE '%colapastas%'
    OR LOWER(nombre) LIKE '%batidor%'
    OR LOWER(nombre) LIKE '%destapador%'
    OR LOWER(nombre) LIKE '%pelapapa%'
    OR LOWER(nombre) LIKE '%sacacorcho%'
    OR LOWER(nombre) LIKE '%tirabuzon%'
    OR LOWER(nombre) LIKE '%sacafuente%'
    OR LOWER(nombre) LIKE '%organizador%cubiertos%'
    OR LOWER(nombre) LIKE '%escurridor%'
    OR LOWER(nombre) LIKE '%exprimidor%'
    OR LOWER(nombre) LIKE '%centrifuga%verduras%'
    OR LOWER(nombre) LIKE '%ñoquera%'
    OR LOWER(nombre) LIKE '%paleta%nylon%'
    OR LOWER(nombre) LIKE '%servidor nylon%'
    OR LOWER(nombre) LIKE '%pisa papas%'
    OR LOWER(nombre) LIKE '%pinza para fiambre%'
    OR LOWER(nombre) LIKE '%tabla plastica%'
    OR LOWER(nombre) LIKE '%tabla redonda%'
    OR LOWER(nombre) LIKE '%rallador%'
    -- TAZAS, CUBIERTOS (incluye marca CAROL)
    OR LOWER(nombre) LIKE '%taza%'
    OR LOWER(nombre) LIKE '%tenedor%'
    OR LOWER(nombre) LIKE '%cuchillo%'
    OR LOWER(nombre) LIKE '%juego%cubiertos%'
    OR LOWER(nombre) LIKE '%juego%cuchillos%'
    OR LOWER(nombre) LIKE '%juego cacerola%'
    OR LOWER(nombre) LIKE '%juego%compoteras%'
    OR LOWER(nombre) LIKE '%juego toc toc%'
    OR LOWER(nombre) LIKE '%juego%heladito%'
    OR LOWER(nombre) LIKE '%juego%tazas%'
    OR LOWER(nombre) LIKE '%carol x unid%'
    OR LOWER(nombre) LIKE 'carol x%'
    -- TAPPERS, HERMÉTICOS, CONTENEDORES
    OR LOWER(nombre) LIKE '%taper%'
    OR LOWER(nombre) LIKE '%hermetico%'
    OR LOWER(nombre) LIKE '%tarro hermetico%'
    OR LOWER(nombre) LIKE '%set%taper%'
    OR LOWER(nombre) LIKE '%set%contenedor%'
    OR (LOWER(nombre) LIKE '%contenedor%'  AND LOWER(nombre) LIKE '%color%')
    OR (LOWER(nombre) LIKE '%contenedor%'  AND LOWER(nombre) LIKE '%make%')
    OR (LOWER(nombre) LIKE '%contenedor%'  AND LOWER(nombre) LIKE '%vidrio%')
    OR LOWER(nombre) LIKE '%fiambrera%'
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
    OR LOWER(nombre) LIKE '%botella termica%'
    OR LOWER(nombre) LIKE '%bombilla%'
    OR LOWER(nombre) LIKE 'termo %'
    OR LOWER(nombre) LIKE 'termo%acero%'
    OR LOWER(nombre) LIKE 'termo x%'
    -- PAVA Y ACCESORIOS COCINA
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
    OR LOWER(nombre) LIKE '%cesto%residuos%'
    OR LOWER(nombre) LIKE '%cesto%basura%'
    OR LOWER(nombre) LIKE '%cesto%pedal%'
    OR LOWER(nombre) LIKE '%cesto%multiuso%'
    OR LOWER(nombre) LIKE '%cesto%ropa%'
    OR LOWER(nombre) LIKE '%cesto%rejilla%'
    OR LOWER(nombre) LIKE '%cesta basura%'
    OR LOWER(nombre) LIKE '%canasto calado%'
    OR LOWER(nombre) LIKE '%canasto%ropa%'
    -- ALFOMBRAS, CORTINAS, PERCHAS, TENDEDORES
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
    -- ILUMINACIÓN Y ENERGÍA
    OR LOWER(nombre) LIKE '%vela %'
    OR LOWER(nombre) LIKE '%velas%'
    OR LOWER(nombre) LIKE 'pila %'
    OR LOWER(nombre) LIKE 'pilas%'
    OR LOWER(nombre) LIKE '%lampara%'
    OR LOWER(nombre) LIKE '%encendedor%'
    OR LOWER(nombre) LIKE '%fosforos%'
    -- MENAJE Y OTROS DEL HOGAR
    OR LOWER(nombre) LIKE '%abrelata%'
    OR LOWER(nombre) LIKE '%bidon%'
    OR LOWER(nombre) LIKE '%dispenser%'
    OR LOWER(nombre) LIKE '%palillero%'
    OR LOWER(nombre) LIKE '%filtro%cafe%'
    OR LOWER(nombre) LIKE '%escalera%aluminio%'
    OR LOWER(nombre) LIKE '%carro%compras%'
    OR LOWER(nombre) LIKE '%carro%porta%elementos%'
    OR LOWER(nombre) LIKE '%botella vidrio%'
    OR LOWER(nombre) LIKE '%boligrafo%'
    OR LOWER(nombre) LIKE '%paper mate%'
    OR LOWER(nombre) LIKE '%bloque adhesivo%'
    OR LOWER(nombre) LIKE '%embudo%'
    OR LOWER(nombre) LIKE '%cubetera%'
    OR LOWER(nombre) LIKE '%porta sachet%'
    OR LOWER(nombre) LIKE '%bañadera%'
    OR LOWER(nombre) LIKE '%separadores%freezer%'
    OR LOWER(nombre) LIKE '%jabonera%'
    OR LOWER(nombre) LIKE '%vertedero%'
    OR LOWER(nombre) LIKE '%sopap%'
    OR LOWER(nombre) LIKE '%pulverizador%'
    OR LOWER(nombre) LIKE '%vertedor%'
    OR LOWER(nombre) LIKE '%limp.vidrio%'
    OR LOWER(nombre) LIKE '%limp. vidrio%'
    OR LOWER(nombre) LIKE '%quita pelusa%'
    OR LOWER(nombre) LIKE '%magic clik%'
    -- CEPILLOS DE VEHÍCULOS / CALZADO / ROPA
    OR LOWER(nombre) LIKE '%cepillo%auto%'
    OR LOWER(nombre) LIKE '%cepillo%coche%'
    OR LOWER(nombre) LIKE '%cepillo%camion%'
    OR LOWER(nombre) LIKE '%cepillo%omnibus%'
    OR LOWER(nombre) LIKE '%cepillo%zapatilla%'
    OR LOWER(nombre) LIKE '%cepillo%zapato%'
    OR LOWER(nombre) LIKE '%cepillo%calzado%'
    OR LOWER(nombre) LIKE '%cepillo%jean%'
    OR LOWER(nombre) LIKE '%cepillo%lavaespalda%'
    OR LOWER(nombre) LIKE '%cepillo%espalda%'
    OR LOWER(nombre) LIKE '%cepillo mano%'
    OR LOWER(nombre) LIKE '%cepillo oval%'
    OR LOWER(nombre) LIKE '%cepillo planchita%'
    OR LOWER(nombre) LIKE '%cepillo 5 cm%'
    OR LOWER(nombre) LIKE '%cepillo de uñas%'
    -- CABOS PARA ESCOBAS / HERRAMIENTAS
    OR LOWER(nombre) LIKE '%cabo madera%'
    OR LOWER(nombre) LIKE '%cabo de madera%'
    OR LOWER(nombre) LIKE '%cabo aluminio%'
    OR LOWER(nombre) LIKE '%cabo metalico%'
    OR LOWER(nombre) LIKE '%cabo extensible%'
    OR LOWER(nombre) LIKE '%repuesto barrendero%'
    -- PRODUCTOS CON DOBLE-ESPACIO (normalizamos con %)
    OR LOWER(nombre) LIKE '%botella%termica%'
    OR LOWER(nombre) LIKE '%mate%acero%inoxidable%'
    OR LOWER(nombre) LIKE '%filtro%rejilla%'
    OR LOWER(nombre) LIKE '%filtro%extrator%'
  `},
];

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  log('\n' + '═'.repeat(70));
  log('  NORMALIZACIÓN COMPLETA — categorías + ciudades (PRODUCCIÓN)');
  log(`  MODO: ${APPLY ? '⚠️  APPLY (los cambios quedarán guardados)' : '✅  PREVIEW / DRY-RUN (ROLLBACK al final, sin cambios)'}`);
  log('═'.repeat(70));

  const conn = await mysql.createConnection(DB);
  log(`\n  ✔ Conectado a ${DB.host}:${DB.port}/${DB.database}`);

  await conn.query('START TRANSACTION');

  try {

    // =========================================================================
    // SECCIÓN 1: PRODUCTOS — estado inicial
    // =========================================================================
    h1('SECCIÓN 1 · PRODUCTOS — estado inicial');

    const [catBefore] = await conn.query(`
      SELECT c.id, c.nombre AS categoria, COUNT(p.id) AS productos
      FROM categorias c
      LEFT JOIN productos p ON p.categoria_id = c.id
      GROUP BY c.id, c.nombre
      ORDER BY productos DESC
    `);
    table(catBefore, ['id','categoria','productos']);

    const [[catVarios]] = await conn.query(`SELECT id FROM categorias WHERE nombre = 'PRODUCTOS VARIOS' LIMIT 1`);
    const [[catAerosol]] = await conn.query(`SELECT id FROM categorias WHERE nombre = 'PRODUCTOS EN AEROSOL' LIMIT 1`);
    if (!catVarios) throw new Error("No existe la categoría 'PRODUCTOS VARIOS'");
    const idVarios = catVarios.id;
    const idAerosol = catAerosol ? catAerosol.id : -1;
    log(`\n  IDs resueltos: PRODUCTOS VARIOS=${idVarios}, PRODUCTOS EN AEROSOL=${idAerosol}`);

    // =========================================================================
    // SECCIÓN 2: CREAR CATEGORÍAS NUEVAS
    // =========================================================================
    h1('SECCIÓN 2 · CREAR 6 CATEGORÍAS NUEVAS (INSERT IGNORE — idempotente)');

    const nuevas = [
      'INSECTICIDAS Y REPELENTES',
      'HIGIENE PERSONAL',
      'ALIMENTOS Y BEBIDAS',
      'ALIMENTOS MASCOTAS',
      'BOLSAS Y DESCARTABLES',
      'BAZAR Y UTENSILLOS',
    ];
    for (const n of nuevas) {
      await conn.query(`INSERT IGNORE INTO categorias (nombre) VALUES (?)`, [n]);
      const [[row]] = await conn.query(`SELECT id FROM categorias WHERE nombre=?`, [n]);
      log(`    ${row.id.toString().padStart(3)}  ${n}`);
    }

    // =========================================================================
    // SECCIÓN 3: RECLASIFICACIÓN DE PRODUCTOS
    // =========================================================================
    h1('SECCIÓN 3 · RECLASIFICACIÓN DE PRODUCTOS');
    log('  Detalle por operación — se muestran hasta 10 productos de muestra.\n');

    let totalMovidos = 0;
    const srcMap = { 10: idVarios, 9: idAerosol };

    for (const op of RECLASIFICACIONES_PRODUCTOS) {
      const [[catRow]] = await conn.query(
        `SELECT id FROM categorias WHERE nombre LIKE ?`,
        [`${op.cat.replace(/ \(.*\)$/, '')}%`]
      );
      if (!catRow) { log(`    ⚠️  Categoría no encontrada: ${op.cat}`); continue; }

      const srcIn = op.srcIds.map(id => srcMap[id] ?? id).filter(id => id > 0).join(',');
      if (!srcIn) continue;

      const [affected] = await conn.query(
        `SELECT id, nombre FROM productos WHERE categoria_id IN (${srcIn}) AND (${op.where}) LIMIT 10`
      );
      const [[{total}]] = await conn.query(
        `SELECT COUNT(*) AS total FROM productos WHERE categoria_id IN (${srcIn}) AND (${op.where})`
      );

      if (total === 0) {
        log(`    ──  0 productos → ${op.cat}  (sin coincidencias)`);
        continue;
      }

      log(`\n  ► ${total} producto(s) → ${op.cat}`);
      affected.forEach(p => log(`       • [${p.id}] ${p.nombre}`));
      if (total > 10) log(`       ... y ${total - 10} más`);

      await conn.query(
        `UPDATE productos SET categoria_id = ? WHERE categoria_id IN (${srcIn}) AND (${op.where})`,
        [catRow.id]
      );
      totalMovidos += total;
    }

    log(`\n  TOTAL productos movidos en reclasificación: ${totalMovidos}`);

    // =========================================================================
    // SECCIÓN 4: PRODUCTOS — estado + QUÉ QUEDA EN VARIOS
    // =========================================================================
    h1('SECCIÓN 4 · PRODUCTOS — estado después de reclasificación');

    const [catAfter] = await conn.query(`
      SELECT c.id, c.nombre AS categoria, COUNT(p.id) AS productos
      FROM categorias c
      LEFT JOIN productos p ON p.categoria_id = c.id
      GROUP BY c.id, c.nombre
      ORDER BY productos DESC
    `);
    table(catAfter, ['id','categoria','productos']);

    h2('Productos que PERMANECEN en PRODUCTOS VARIOS');
    const [quedanVarios] = await conn.query(`
      SELECT id, nombre FROM productos WHERE categoria_id = ? ORDER BY nombre
    `, [idVarios]);
    if (quedanVarios.length === 0) {
      log('    (ninguno — categoría vacía)');
    } else {
      quedanVarios.forEach(p => log(`    • [${p.id}] ${p.nombre}`));
    }

    // =========================================================================
    // SECCIÓN 5: CIUDADES — estado inicial
    // =========================================================================
    h1('SECCIÓN 5 · CIUDADES — estado inicial');

    h2('clientes.ciudad — distribución actual');
    const [ciudCliAntes] = await conn.query(`
      SELECT IFNULL(ciudad,'(NULL)') AS ciudad, COUNT(*) AS total
      FROM clientes GROUP BY ciudad ORDER BY total DESC
    `);
    table(ciudCliAntes, ['ciudad','total']);

    h2('ventas.cliente_ciudad — distribución actual (top 30)');
    const [ciudVentAntes] = await conn.query(`
      SELECT IFNULL(cliente_ciudad,'(NULL)') AS ciudad, COUNT(*) AS total
      FROM ventas GROUP BY cliente_ciudad ORDER BY total DESC LIMIT 30
    `);
    table(ciudVentAntes, ['ciudad','total']);

    // =========================================================================
    // SECCIÓN 6: NORMALIZAR clientes.ciudad
    // =========================================================================
    h1('SECCIÓN 6 · NORMALIZAR clientes.ciudad');

    // 6.1 Variantes tipográficas
    h2('6.1 Correcciones de variantes tipográficas');
    for (const [ciudadFinal, condiciones] of Object.entries(VARIANTES_CIUDADES)) {
      const whereClause = condiciones.join(' OR ');
      const [[{total}]] = await conn.query(
        `SELECT COUNT(*) AS total FROM clientes WHERE ciudad IS NOT NULL AND (${whereClause})`
      );
      const [muestra] = await conn.query(
        `SELECT id, nombre, ciudad FROM clientes WHERE ciudad IS NOT NULL AND (${whereClause}) LIMIT 5`
      );
      if (total > 0) {
        log(`\n  ► ${total} cliente(s): "${muestra[0]?.ciudad}" → "${ciudadFinal}"`);
        muestra.forEach(c => log(`       • [${c.id}] ${c.nombre} (ciudad actual: "${c.ciudad}")`));
        await conn.query(
          `UPDATE clientes SET ciudad = ? WHERE ciudad IS NOT NULL AND (${whereClause})`, [ciudadFinal]
        );
      }
    }

    // TRIM y mayúsculas
    await conn.query(`UPDATE clientes SET ciudad = UPPER(TRIM(ciudad)) WHERE ciudad IS NOT NULL AND ciudad != UPPER(TRIM(ciudad))`);

    // 6.2 Clientes con ciudad NULL: detectar desde dirección
    h2('6.2 Clientes con ciudad NULL — detección desde campo dirección');
    const [nullCliDetectados] = await conn.query(`
      SELECT id, nombre, direccion, ${CIUDAD_DESDE_DIRECCION} AS ciudad_detectada
      FROM clientes
      WHERE ciudad IS NULL
      ORDER BY ciudad_detectada, nombre
    `);

    const resumenDeteccion = {};
    nullCliDetectados.forEach(r => {
      resumenDeteccion[r.ciudad_detectada] = (resumenDeteccion[r.ciudad_detectada] || 0) + 1;
    });
    log('\n  Resumen de ciudades detectadas desde dirección (para clientes sin ciudad):');
    Object.entries(resumenDeteccion)
      .sort((a,b) => b[1] - a[1])
      .forEach(([c, n]) => log(`    ${n.toString().padStart(4)}  ${c}`));

    log('\n  Detalle de los que NO son GENERAL PICO (ciudad detectada desde dirección):');
    nullCliDetectados
      .filter(r => r.ciudad_detectada !== 'GENERAL PICO')
      .forEach(r => log(`    • [${r.id}] ${r.nombre}  |  dir: "${r.direccion || ''}"  →  ${r.ciudad_detectada}`));

    // Ejecutar el UPDATE
    await conn.query(`
      UPDATE clientes SET ciudad = ${CIUDAD_DESDE_DIRECCION} WHERE ciudad IS NULL
    `);

    // 6.3 Ciudades "sucias" (dirección mezclada en el campo ciudad)
    h2('6.3 Limpiar ciudades sucias (número+ciudad, Piso/Dpto, BIS., etc.)');
    const [previewSucias] = await conn.query(`
      SELECT id, nombre, ciudad AS ciudad_actual,
             (${EXTRAER_CIUDAD_SUCIA}) AS ciudad_nueva
      FROM clientes
      WHERE ${WHERE_CIUDAD_SUCIA}
      ORDER BY ciudad_nueva, ciudad_actual
    `);
    const cambiables = previewSucias.filter(r => r.ciudad_nueva && r.ciudad_nueva !== String(r.ciudad_actual).trim().toUpperCase());
    const sinDetectar = previewSucias.filter(r => !r.ciudad_nueva);
    log(`  Candidatos: ${previewSucias.length} | Se normalizan: ${cambiables.length} | Sin detectar: ${sinDetectar.length}`);
    const resumenSucias = {};
    cambiables.forEach(r => {
      const k = `${r.ciudad_actual} → ${r.ciudad_nueva}`;
      resumenSucias[k] = (resumenSucias[k] || 0) + 1;
    });
    Object.entries(resumenSucias).sort((a,b)=>b[1]-a[1]).slice(0,40)
      .forEach(([k,n]) => log(`    ${String(n).padStart(3)}  ${k}`));

    const [updSucias] = await conn.query(`
      UPDATE clientes
      SET ciudad = (${EXTRAER_CIUDAD_SUCIA})
      WHERE ${WHERE_CIUDAD_SUCIA}
        AND (${EXTRAER_CIUDAD_SUCIA}) IS NOT NULL
        AND (${EXTRAER_CIUDAD_SUCIA}) != UPPER(TRIM(ciudad))
    `);
    log(`  UPDATE clientes sucias: ${updSucias.affectedRows}`);

    const especiales = [
      { de: ['QUEMU'], a: 'QUEMU QUEMU' },
      { de: ['LARROUDE'], a: 'BERNARDO LARROUDE' },
      { de: ['A. ITALIA', 'A. Italia', 'ITALIA'], a: 'ALTA ITALIA' },
      { de: ['ROSA'], a: 'SANTA ROSA' },
      { de: ['ACHA'], a: 'GENERAL ACHA' },
      { de: ['OLAVARRIA'], a: 'FORTIN OLAVARRIA' },
      { de: ['ARIZONA.'], a: 'ARIZONA' },
      { de: ['REALICO.'], a: 'REALICO' },
      { de: ['Anchorena', 'ANCHORENA'], a: 'ANCHORENA' },
      { de: ['La Maruja'], a: 'LA MARUJA' },
    ];
    for (const esp of especiales) {
      const ph = esp.de.map(() => '?').join(',');
      const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM clientes WHERE TRIM(ciudad) IN (${ph})`, esp.de
      );
      if (n > 0) {
        log(`  ► ${n} cliente(s): ${esp.de.join('|')} → ${esp.a}`);
        await conn.query(
          `UPDATE clientes SET ciudad = ? WHERE TRIM(ciudad) IN (${ph})`,
          [esp.a, ...esp.de]
        );
      }
    }
    const [[{ pampa }]] = await conn.query(
      `SELECT COUNT(*) AS pampa FROM clientes WHERE UPPER(TRIM(ciudad)) = 'PAMPA'`
    );
    log(`  ⚠️  Clientes con ciudad='PAMPA' (NO se tocan): ${pampa}`);

    // =========================================================================
    // SECCIÓN 7: NORMALIZAR ventas.cliente_ciudad
    // =========================================================================
    h1('SECCIÓN 7 · NORMALIZAR ventas.cliente_ciudad');

    h2('7.1 Correcciones de variantes tipográficas en ventas');
    const VENTAS_FIX = [
      { final: 'GENERAL PICO', cond: `TRIM(UPPER(cliente_ciudad)) = 'PICO' OR UPPER(cliente_ciudad) LIKE 'GENERAL PICO |%' OR UPPER(cliente_ciudad) LIKE '%| GENERAL PICO' OR UPPER(cliente_ciudad) LIKE '% GENERAL PICO' OR UPPER(cliente_ciudad) LIKE 'GENERAL PICO%|%'` },
      { final: 'COLONIA BARON', cond: `LOWER(TRIM(cliente_ciudad)) IN ('colonia baron','baron','col. baron','125 colonia baron')` },
      { final: 'VILLA MIRASOL', cond: `LOWER(TRIM(cliente_ciudad)) IN ('villa mirasol','mirasol','v. mirasol')` },
      { final: 'INGENIERO LUIGGI', cond: `LOWER(TRIM(cliente_ciudad)) IN ('luiggi','ing. luiggi','ingeniero luiggi')` },
      { final: 'INTENDENTE ALVEAR', cond: `LOWER(TRIM(cliente_ciudad)) IN ('alvear','int. alvear','intendente alvear')` },
      { final: 'ARIZONA', cond: `UPPER(TRIM(cliente_ciudad)) IN ('ARIZONA.','FRENTE  A LA PLAZA  ARIZONA','FRENTE A LA PLAZA ARIZONA')` },
      { final: 'PARERA', cond: `UPPER(TRIM(cliente_ciudad)) IN ('INDEPENDENCIA . PARERA','INDEPENDENCIA. PARERA')` },
      { final: 'LUAN TORO', cond: `UPPER(TRIM(cliente_ciudad)) LIKE '%LUAN TORO'` },
    ];
    for (const fix of VENTAS_FIX) {
      const [[{total}]] = await conn.query(
        `SELECT COUNT(*) AS total FROM ventas WHERE cliente_ciudad IS NOT NULL AND (${fix.cond})`
      );
      if (total > 0) {
        log(`  ► ${total} venta(s) → '${fix.final}'`);
        await conn.query(`UPDATE ventas SET cliente_ciudad = ? WHERE cliente_ciudad IS NOT NULL AND (${fix.cond})`, [fix.final]);
      }
    }
    await conn.query(`UPDATE ventas SET cliente_ciudad = UPPER(TRIM(cliente_ciudad)) WHERE cliente_ciudad IS NOT NULL AND cliente_ciudad != UPPER(TRIM(cliente_ciudad))`);

    h2('7.2 Limpiar ciudades sucias en ventas');
    const EXTRAER_VENTA = EXTRAER_CIUDAD_SUCIA.replace(/ciudad/g, 'cliente_ciudad');
    const [updVentSucias] = await conn.query(`
      UPDATE ventas
      SET cliente_ciudad = (${EXTRAER_VENTA})
      WHERE cliente_ciudad IS NOT NULL AND TRIM(cliente_ciudad) != ''
        AND (${EXTRAER_VENTA}) IS NOT NULL
        AND (${EXTRAER_VENTA}) != UPPER(TRIM(cliente_ciudad))
        AND (
          cliente_ciudad REGEXP '^[0-9=]'
          OR cliente_ciudad LIKE 'Piso:%'
          OR cliente_ciudad LIKE 'Dpto:%'
          OR cliente_ciudad LIKE 'Dir. Com.:%'
          OR cliente_ciudad LIKE 'BIS.%'
          OR cliente_ciudad LIKE '% GENERAL PICO'
          OR cliente_ciudad LIKE '%. GENERAL PICO'
          OR cliente_ciudad LIKE '25 DE MAYO%'
          OR cliente_ciudad LIKE 'INDEPENDENCIA%'
          OR cliente_ciudad LIKE 'FRENTE%ARIZONA%'
          OR cliente_ciudad LIKE 'ARIZONA.'
          OR UPPER(TRIM(cliente_ciudad)) IN ('BIS.','QUEMU','LARROUDE','A. ITALIA','ITALIA','ROSA','ACHA','OLAVARRIA')
        )
    `);
    log(`  UPDATE ventas sucias: ${updVentSucias.affectedRows}`);

    h2('7.3 Ventas con ciudad vacía/NULL — propagar desde clientes');
    const [[{vaciasBefore}]] = await conn.query(
      `SELECT COUNT(*) AS vaciasBefore FROM ventas WHERE cliente_ciudad IS NULL OR TRIM(cliente_ciudad) = ''`
    );
    log(`  Ventas con ciudad vacía antes: ${vaciasBefore}`);

    await conn.query(`
      UPDATE ventas v
      JOIN clientes c ON c.id = v.cliente_id
      SET v.cliente_ciudad = COALESCE(NULLIF(TRIM(c.ciudad),''), 'GENERAL PICO')
      WHERE v.cliente_ciudad IS NULL OR TRIM(v.cliente_ciudad) = ''
    `);

    const [[{vaciasAfter}]] = await conn.query(
      `SELECT COUNT(*) AS vaciasAfter FROM ventas WHERE cliente_ciudad IS NULL OR TRIM(cliente_ciudad) = ''`
    );
    log(`  Ventas con ciudad vacía después: ${vaciasAfter}`);

    // =========================================================================
    // SECCIÓN 8: CIUDADES — estado final
    // =========================================================================
    h1('SECCIÓN 8 · VERIFICACIÓN FINAL');

    h2('clientes.ciudad — top 25');
    const [ciudCliFinal] = await conn.query(`
      SELECT ciudad, COUNT(*) AS total FROM clientes GROUP BY ciudad ORDER BY total DESC LIMIT 25
    `);
    table(ciudCliFinal, ['ciudad','total']);

    h2('ventas.cliente_ciudad — top 20');
    const [ciudVentFinal] = await conn.query(`
      SELECT cliente_ciudad AS ciudad, COUNT(*) AS total
      FROM ventas GROUP BY cliente_ciudad ORDER BY total DESC LIMIT 20
    `);
    table(ciudVentFinal, ['ciudad','total']);

    h2('¿Quedan ciudades sucias típicas en clientes?');
    const [suciasRest] = await conn.query(`
      SELECT ciudad, COUNT(*) AS total FROM clientes
      WHERE ciudad REGEXP '^[0-9=]'
         OR ciudad LIKE 'Piso:%'
         OR ciudad LIKE 'Dpto:%'
         OR ciudad LIKE 'Dir. Com.:%'
         OR ciudad LIKE 'BIS.%'
         OR ciudad LIKE '% GENERAL PICO'
      GROUP BY ciudad ORDER BY total DESC LIMIT 20
    `);
    table(suciasRest, ['ciudad','total']);

    // =========================================================================
    // COMMIT o ROLLBACK
    // =========================================================================
    if (APPLY) {
      await conn.query('COMMIT');
      log('\n' + '═'.repeat(70));
      log('  ✅  COMMIT ejecutado — todos los cambios están guardados.');
      log('═'.repeat(70) + '\n');
    } else {
      await conn.query('ROLLBACK');
      log('\n' + '═'.repeat(70));
      log('  🔁  ROLLBACK ejecutado — la base de datos NO fue modificada.');
      log('  Para aplicar: node scripts/normalizar_datos_produccion.js --apply');
      log('═'.repeat(70) + '\n');
    }

  } catch (err) {
    await conn.query('ROLLBACK');
    log('\n  ❌  ERROR — se hizo ROLLBACK automático.');
    log('  Detalle: ' + err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
