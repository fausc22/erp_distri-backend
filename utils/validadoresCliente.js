/**
 * Validadores para datos de cliente (Fase 2).
 * CUIT: 11 dígitos + dígito verificador (módulo 11 AFIP).
 * DNI: 7 u 8 dígitos.
 * Condición IVA: Monotributo/RI exigen CUIT válido; Consumidor Final permite solo DNI.
 */

const CONDICIONES_IVA_PERMITIDAS = [
    'Responsable Inscripto',
    'Monotributo',
    'Exento',
    'Consumidor Final'
];

const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Normaliza CUIT a solo 11 dígitos (quita guiones/espacios).
 * @param {string} cuit
 * @returns {string}
 */
function normalizarCuit(cuit) {
    if (cuit == null) return '';
    return String(cuit).replace(/\D/g, '');
}

/**
 * Valida formato y dígito verificador del CUIT (algoritmo módulo 11 AFIP).
 * @param {string} cuit - Con o sin guiones
 * @returns {{ valido: boolean, mensaje?: string }}
 */
function validarCuit(cuit) {
    const numeros = normalizarCuit(cuit);
    if (numeros.length !== 11) {
        return { valido: false, mensaje: 'El CUIT debe tener 11 dígitos.' };
    }
    if (!/^\d{11}$/.test(numeros)) {
        return { valido: false, mensaje: 'El CUIT debe contener solo números.' };
    }
    let suma = 0;
    for (let i = 0; i < 10; i++) {
        suma += parseInt(numeros[i], 10) * PESOS_CUIT[i];
    }
    const resto = suma % 11;
    let digitoEsperado = 11 - resto;
    if (digitoEsperado === 11) digitoEsperado = 0;
    if (digitoEsperado === 10) digitoEsperado = 9;
    const digitoRecibido = parseInt(numeros[10], 10);
    if (digitoRecibido !== digitoEsperado) {
        return { valido: false, mensaje: 'El CUIT tiene un dígito verificador inválido.' };
    }
    return { valido: true };
}

/**
 * Valida DNI: solo números, 7 u 8 dígitos.
 * @param {string} dni
 * @returns {{ valido: boolean, mensaje?: string }}
 */
function validarDni(dni) {
    if (dni == null || String(dni).trim() === '') {
        return { valido: true };
    }
    const numeros = String(dni).replace(/\D/g, '');
    if (numeros.length < 7 || numeros.length > 8) {
        return { valido: false, mensaje: 'El DNI debe tener 7 u 8 dígitos.' };
    }
    if (!/^\d+$/.test(numeros)) {
        return { valido: false, mensaje: 'El DNI debe contener solo números.' };
    }
    return { valido: true };
}

/**
 * Valida todos los datos del cliente para crear/actualizar.
 * - nombre: obligatorio, no vacío después de trim.
 * - condicion_iva: obligatoria, valor en lista permitida.
 * - Si condicion_iva es Monotributo o Responsable Inscripto: CUIT obligatorio y válido.
 * - Si condicion_iva es Consumidor Final: CUIT opcional; si se envía, debe ser válido.
 * - DNI: si se envía, 7 u 8 dígitos.
 * - ciudad: según reglas actuales (obligatorio en front); aquí no lo hacemos obligatorio si el plan no lo exige (el plan dijo nombre obligatorio y consistencia CUIT/DNI/condicion).
 * @param {object} body - { nombre, condicion_iva, cuit, dni, ... }
 * @returns {{ valido: boolean, errores: string[] }}
 */
function validarDatosCliente(body) {
    const errores = [];
    const nombre = body.nombre != null ? String(body.nombre).trim() : '';
    const condicion_iva = body.condicion_iva != null ? String(body.condicion_iva).trim() : '';
    const cuit = body.cuit;
    const dni = body.dni;

    if (!nombre) {
        errores.push('El nombre es obligatorio.');
    } else if (nombre.length > 255) {
        errores.push('El nombre no puede superar los 255 caracteres.');
    }

    if (!condicion_iva) {
        errores.push('La condición de IVA es obligatoria.');
    } else if (!CONDICIONES_IVA_PERMITIDAS.includes(condicion_iva)) {
        errores.push(`La condición de IVA debe ser una de: ${CONDICIONES_IVA_PERMITIDAS.join(', ')}.`);
    }

    const exigeCuit = condicion_iva === 'Monotributo' || condicion_iva === 'Responsable Inscripto';
    const cuitLimpio = normalizarCuit(cuit);

    if (exigeCuit) {
        if (!cuitLimpio || cuitLimpio.length === 0) {
            errores.push('Para Monotributo o Responsable Inscripto el CUIT es obligatorio.');
        } else {
            const r = validarCuit(cuit);
            if (!r.valido) errores.push(r.mensaje);
        }
    } else if (cuitLimpio.length > 0) {
        const r = validarCuit(cuit);
        if (!r.valido) errores.push(r.mensaje);
    }

    const rDni = validarDni(dni);
    if (!rDni.valido) {
        errores.push(rDni.mensaje);
    }

    return {
        valido: errores.length === 0,
        errores
    };
}

module.exports = {
    CONDICIONES_IVA_PERMITIDAS,
    normalizarCuit,
    validarCuit,
    validarDni,
    validarDatosCliente
};
