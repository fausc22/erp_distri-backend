const path = require('path');
const { runUpdateScript } = require('../scripts/update');
const { runUpdateClientesScript } = require('../scripts/updateClientes');

let isUpdateRunning = false;
let isUpdateClientesRunning = false;

const executeProductsUpdate = async (req, res) => {
    if (isUpdateRunning) {
        return res.status(409).json({
            success: false,
            message: 'Ya hay una actualización de productos en ejecución'
        });
    }

    const rawExcelPath = req.body?.excelPath;
    const excelPath = typeof rawExcelPath === 'string' && rawExcelPath.trim()
        ? path.resolve(process.cwd(), rawExcelPath.trim())
        : undefined;

    try {
        isUpdateRunning = true;

        const result = await runUpdateScript({ excelPath });

        return res.json({
            success: true,
            message: 'Script ejecutado correctamente',
            ...result
        });
    } catch (error) {
        console.error('❌ Error ejecutando script de actualización:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al ejecutar el script de actualización',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        isUpdateRunning = false;
    }
};

/**
 * Ejecuta el script de actualización de clientes desde Excel (personas.xlsx en backend/scripts).
 * Endpoint: GET o POST /scripts/update-clientes (o /update-clientes si se monta en /).
 * Body opcional (POST): { excelPath?: string } para indicar otro nombre de archivo dentro de scripts.
 * Respuesta 200: { success, message, excelPath, summary: { totalFilas, clientesFiltrados, insertados, omitidosPorExistir, omitidosPorValidacion, errores } }
 * Respuesta 409: ya hay una actualización en ejecución. 500: error del script.
 */
const executeClientesUpdate = async (req, res) => {
    if (isUpdateClientesRunning) {
        return res.status(409).json({
            success: false,
            message: 'Ya hay una actualización de clientes en ejecución'
        });
    }

    const rawExcelPath = req.body?.excelPath ?? req.query?.excelPath;
    const excelPath = typeof rawExcelPath === 'string' && rawExcelPath.trim()
        ? rawExcelPath.trim()
        : undefined;

    try {
        isUpdateClientesRunning = true;

        const result = await runUpdateClientesScript({ excelPath });

        return res.json({
            success: true,
            message: 'Script de actualización de clientes ejecutado correctamente',
            ...result
        });
    } catch (error) {
        console.error('❌ Error ejecutando script de actualización de clientes:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al ejecutar el script de actualización de clientes',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        isUpdateClientesRunning = false;
    }
};

module.exports = {
    executeProductsUpdate,
    executeClientesUpdate
};
