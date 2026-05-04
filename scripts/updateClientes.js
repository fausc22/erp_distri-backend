const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('mysql2/promise');
const { validarCuit, validarDni } = require('../utils/validadoresCliente');

/** Configuración de la base de datos (mismo criterio que update.js de productos). */
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '251199',
    database: process.env.DB_DATABASE || 'erp_distri',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    charset: 'utf8mb4'
};

/** Prefijo a quitar de la columna Direccion (leído del Excel, siempre el mismo). */
const PREFIJO_DIRECCION = 'Dir. Com.: ';

/** Tipos de persona a procesar: solo estos se consideran para insertar en clientes. */
const TIPOS_PERSONA_PERMITIDOS = ['Clientes', 'Municipios'];

/** Condiciones IVA permitidas (debe coincidir con validadoresCliente). Por defecto: Consumidor Final. */
const CONDICIONES_IVA_PERMITIDAS = [
    'Responsable Inscripto',
    'Monotributo',
    'Exento',
    'Consumidor Final'
];

/** Provincias conocidas para extraer ciudad/provincia desde la dirección (último segmento). */
const PROVINCIAS_CONOCIDAS = ['LA PAMPA', 'BUENOS AIRES', 'CÓRDOBA', 'SANTA FE', 'ENTRE RÍOS', 'MENDOZA'];

/**
 * Ruta del Excel de personas: siempre en backend/scripts.
 * Si se pasa excelPath, se resuelve como nombre de archivo dentro de scripts.
 */
function resolveExcelPath(customExcelPath) {
    const scriptsDir = __dirname;
    if (customExcelPath && typeof customExcelPath === 'string' && customExcelPath.trim()) {
        const name = customExcelPath.trim();
        const candidate = path.isAbsolute(name) ? name : path.join(scriptsDir, path.basename(name));
        return candidate;
    }
    return path.join(scriptsDir, 'personas.xlsx');
}

/**
 * Normaliza el valor de "Tipos de Personas" (trim, quitar saltos de línea).
 */
function normalizarTipoPersona(valor) {
    if (valor == null) return '';
    return String(valor).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
}

/**
 * Normaliza el nombre (Denominación): trim, reemplazar saltos de línea y espacios múltiples.
 */
function normalizarNombre(valor) {
    if (valor == null) return '';
    return String(valor)
        .replace(/\r\n/g, ' ')
        .replace(/\n/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * Normaliza condición IVA; si no está en la lista permitida, devuelve "Consumidor Final".
 */
function normalizarCondicionIva(valor) {
    if (valor == null) return 'Consumidor Final';
    const limpio = String(valor).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
    return CONDICIONES_IVA_PERMITIDAS.includes(limpio) ? limpio : 'Consumidor Final';
}

/**
 * Extrae solo dígitos del documento (CUIT/CUIL/DNI).
 * @returns {string}
 */
function soloDigitos(valor) {
    if (valor == null) return '';
    return String(valor).replace(/\D/g, '');
}

/**
 * Parsea CUIT/CUIL/DNI por cantidad de dígitos: 11 → cuit, 7 u 8 → dni.
 * @returns {{ cuit: string|null, dni: string|null }}
 */
function parseDocumento(valor) {
    const dig = soloDigitos(valor);
    if (dig.length === 11) {
        return { cuit: dig, dni: null };
    }
    if (dig.length === 7 || dig.length === 8) {
        return { cuit: null, dni: dig };
    }
    if (dig.length === 0) {
        return { cuit: null, dni: null };
    }
    return { cuit: null, dni: null };
}

/**
 * Quita el prefijo de dirección y extrae ciudad/provincia cuando el texto lo permite.
 * Si la última línea termina en una provincia conocida, se asigna provincia y ciudad.
 * @returns {{ direccion: string, ciudad: string, provincia: string }}
 */
function parseDireccion(valor) {
    if (valor == null) return { direccion: '', ciudad: '', provincia: '' };
    let texto = String(valor).trim();
    if (texto.startsWith(PREFIJO_DIRECCION)) {
        texto = texto.slice(PREFIJO_DIRECCION.length).trim();
    }
    const lineas = texto.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lineas.length === 0) return { direccion: '', ciudad: '', provincia: '' };
    if (lineas.length === 1) {
        return { direccion: lineas[0].replace(/\s+/g, ' '), ciudad: '', provincia: '' };
    }
    const ultimaLinea = lineas[lineas.length - 1];
    let provincia = '';
    for (const p of PROVINCIAS_CONOCIDAS) {
        if (ultimaLinea.endsWith(p)) {
            provincia = p;
            break;
        }
    }
    const ciudad = provincia ? ultimaLinea.slice(0, -provincia.length).trim() : ultimaLinea;
    const direccion = lineas.slice(0, -1).join(' ').trim().replace(/\s+/g, ' ');
    return { direccion, ciudad, provincia };
}

/**
 * Valida CUIT/DNI del cliente normalizado. Si tiene CUIT se valida con validarCuit;
 * si solo tiene DNI se valida con validarDni. Sin documento no se rechaza.
 * @param {{ cuit: string|null, dni: string|null }} cliente - Objeto con cuit y dni ya parseados
 * @returns {{ valido: boolean, mensaje?: string }}
 */
function validarClienteDocumento(cliente) {
    const cuit = cliente.cuit != null && String(cliente.cuit).trim() !== '' ? cliente.cuit : null;
    const dni = cliente.dni != null && String(cliente.dni).trim() !== '' ? cliente.dni : null;

    if (cuit) {
        const r = validarCuit(cuit);
        if (!r.valido) return { valido: false, mensaje: r.mensaje };
        return { valido: true };
    }
    if (dni) {
        const r = validarDni(dni);
        if (!r.valido) return { valido: false, mensaje: r.mensaje };
        return { valido: true };
    }
    return { valido: true };
}

/**
 * Mapea una fila del Excel (ya filtrada por tipo) al objeto cliente normalizado.
 * La validación CUIT/DNI se hace con validarClienteDocumento (etapa 4).
 * @param {Object} row - Fila del sheet (Denominación, Condicion IVA, etc.)
 * @returns {{ nombre: string, condicion_iva: string, cuit: string|null, dni: string|null, direccion: string, ciudad: string, provincia: string, telefono: string, email: string }}
 */
function mapRowToCliente(row) {
    const nombre = normalizarNombre(row['Denominación']);
    const condicion_iva = normalizarCondicionIva(row['Condicion IVA']);
    const { cuit, dni } = parseDocumento(row['CUIT/CUIL/DNI']);
    const { direccion, ciudad, provincia } = parseDireccion(row['Direccion']);
    const telefono = row['Telefonos'] != null ? String(row['Telefonos']).trim() : '';
    const email = row['E-mail'] != null ? String(row['E-mail']).trim() : '';
    return {
        nombre,
        condicion_iva,
        cuit,
        dni,
        direccion,
        ciudad,
        provincia,
        telefono,
        email
    };
}

/**
 * Comprueba si el cliente ya existe en la base de datos.
 * Si tiene CUIT: busca por cuit (11 dígitos). Si no tiene CUIT: busca por nombre normalizado.
 * @param {import('mysql2/promise').Connection} connection - Conexión MySQL
 * @param {{ nombre: string, cuit: string|null, dni: string|null }} cliente - Cliente normalizado
 * @returns {Promise<boolean>}
 */
async function clienteExists(connection, cliente) {
    if (cliente.cuit) {
        const [rows] = await connection.execute(
            'SELECT id FROM clientes WHERE cuit = ? LIMIT 1',
            [cliente.cuit]
        );
        return Array.isArray(rows) && rows.length > 0;
    }
    const [rows] = await connection.execute(
        'SELECT id FROM clientes WHERE TRIM(nombre) = ? LIMIT 1',
        [cliente.nombre]
    );
    return Array.isArray(rows) && rows.length > 0;
}

/**
 * Obtiene el id de la ciudad en la tabla ciudades por nombre.
 * La tabla ciudades tiene (id, nombre, id_zona); no tiene provincia, se busca solo por nombre.
 * @param {import('mysql2/promise').Connection} connection - Conexión MySQL
 * @param {string} ciudad - Nombre de la ciudad (puede estar vacío)
 * @param {string} [provincia] - No se usa en la tabla ciudades; se deja por compatibilidad
 * @returns {Promise<number|null>} - id de la ciudad o null si no hay match o ciudad vacía
 */
async function getCiudadId(connection, ciudad, provincia) {
    const nombreCiudad = ciudad != null ? String(ciudad).trim() : '';
    if (!nombreCiudad) return null;
    const [rows] = await connection.execute(
        'SELECT id FROM ciudades WHERE TRIM(nombre) = ? LIMIT 1',
        [nombreCiudad]
    );
    if (Array.isArray(rows) && rows.length > 0 && rows[0].id != null) {
        return Number(rows[0].id);
    }
    return null;
}

/**
 * Lee el Excel y filtra filas por tipo: solo Clientes y Municipios.
 * @param {string} excelPath - Ruta al archivo personas.xlsx
 * @returns {{ totalFilas: number, clientesFiltrados: number, filas: Array }}
 */
function leerYFiltrarExcel(excelPath) {
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    const filas = data.filter((row) => {
        const tipo = normalizarTipoPersona(row['Tipos de Personas']);
        return TIPOS_PERSONA_PERMITIDOS.includes(tipo);
    });

    return {
        totalFilas: data.length,
        clientesFiltrados: filas.length,
        filas
    };
}

/**
 * Inserta un cliente en la tabla clientes.
 * @param {import('mysql2/promise').Connection} connection
 * @param {Object} cliente - Cliente normalizado con nombre, condicion_iva, cuit, dni, direccion, ciudad, provincia, telefono, email
 * @param {number|null} ciudadId - id de ciudades o null
 * @returns {Promise<boolean>} - true si se insertó correctamente
 */
async function insertarCliente(connection, cliente, ciudadId) {
    const sql = `INSERT INTO clientes (nombre, condicion_iva, cuit, dni, direccion, ciudad_id, ciudad, provincia, telefono, email)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const cuit = cliente.cuit && String(cliente.cuit).trim() !== '' ? cliente.cuit : null;
    const dni = cliente.dni && String(cliente.dni).trim() !== '' ? cliente.dni : null;
    const params = [
        cliente.nombre,
        cliente.condicion_iva,
        cuit,
        dni,
        cliente.direccion || null,
        ciudadId,
        cliente.ciudad || null,
        cliente.provincia || null,
        cliente.telefono || null,
        cliente.email || null
    ];
    await connection.execute(sql, params);
    return true;
}

/**
 * Función principal reutilizable (endpoint).
 * Etapa 6: conecta a la DB, por cada cliente válido comprueba existencia, resuelve ciudad_id e inserta si no existe.
 */
async function runUpdateClientesScript(options = {}) {
    const excelPath = resolveExcelPath(options.excelPath);

    if (!fs.existsSync(excelPath)) {
        throw new Error(`Archivo Excel no encontrado: ${excelPath}`);
    }

    const { totalFilas, clientesFiltrados, filas } = leerYFiltrarExcel(excelPath);

    // Normalizar cada fila a objeto cliente
    const clientesNormalizados = filas.map((row) => mapRowToCliente(row));

    // Etapa 4: validar CUIT/DNI; rechazar filas que no pasen
    const clientesAProcesar = [];
    let omitidosPorValidacion = 0;
    for (const cliente of clientesNormalizados) {
        const resultado = validarClienteDocumento(cliente);
        if (resultado.valido) {
            clientesAProcesar.push(cliente);
        } else {
            omitidosPorValidacion++;
        }
    }

    let insertados = 0;
    let omitidosPorExistir = 0;
    let errores = 0;
    let connection = null;

    try {
        connection = await mysql.createConnection(dbConfig);

        for (const cliente of clientesAProcesar) {
            try {
                if (!cliente.nombre || String(cliente.nombre).trim() === '') {
                    errores++;
                    continue;
                }

                const existe = await clienteExists(connection, cliente);
                if (existe) {
                    omitidosPorExistir++;
                    continue;
                }

                const ciudadId = await getCiudadId(connection, cliente.ciudad, cliente.provincia);
                await insertarCliente(connection, cliente, ciudadId);
                insertados++;
            } catch (err) {
                errores++;
                console.error(`❌ Error procesando cliente "${cliente.nombre}":`, err.message);
            }
        }
    } finally {
        if (connection) {
            await connection.end();
        }
    }

    const summary = {
        totalFilas,
        clientesFiltrados,
        insertados,
        omitidosPorExistir,
        omitidosPorValidacion,
        errores
    };

    return {
        success: true,
        excelPath,
        summary
    };
}

module.exports = {
    dbConfig,
    PREFIJO_DIRECCION,
    TIPOS_PERSONA_PERMITIDOS,
    CONDICIONES_IVA_PERMITIDAS,
    PROVINCIAS_CONOCIDAS,
    resolveExcelPath,
    normalizarTipoPersona,
    normalizarNombre,
    normalizarCondicionIva,
    soloDigitos,
    parseDocumento,
    parseDireccion,
    validarClienteDocumento,
    mapRowToCliente,
    clienteExists,
    getCiudadId,
    insertarCliente,
    leerYFiltrarExcel,
    runUpdateClientesScript
};
