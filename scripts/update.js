const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

// Configuración de la base de datos
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '251199',
    database: process.env.DB_DATABASE || 'erp_distri',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    charset: 'utf8mb4'
};

// Mapeo de categorías
const categoriaMapping = {
    'ACIDO': 2,
    'AGUA': 18,
    'CERAS': 17,
    'CLORO Y ACCESORIOS PARA PILETA': 4,
    'DESODORANTES': 5,
    'DETERGENTES': 6,
    'ESCOBAS-ESCOBILLONES-PLUMEROS': 3,
    'ESPONJAS': 15,
    'JABONES': 16,
    'LA VIRGINIA': 11,
    'LAMPAZOS-MOPAS': 12,
    'LAVANDINA': 13,
    'LYSOFORM': 14,
    'PAPEL HIGIENICO - ROLLO DE COCINA': 7,
    'PASTILLAS DE DESODORANTE': 8,
    'PRODUCTOS A GRANEL': 19,
    'PRODUCTOS EN AEROSOL': 9,
    'PRODUCTOS VARIOS': 10,
    'REJILLAS-PAÑOS-FRANELAS': 20,
    'SODA CAUSTICA - CAUCHET': 21,
    'SUAVIZANTES': 22,
    'TRAPOS DE PISO-SECADORES': 23
};

class ExcelProductUpdater {
    constructor() {
        this.connection = null;
    }

    async connect() {
        try {
            this.connection = await mysql.createConnection(dbConfig);
            console.log('✅ Conectado a la base de datos');
        } catch (error) {
            console.error('❌ Error al conectar a la base de datos:', error.message);
            throw error;
        }
    }

    async disconnect() {
        if (this.connection) {
            await this.connection.end();
            console.log('🔌 Desconectado de la base de datos');
        }
    }

    // Función para limpiar nombres de productos
    cleanProductName(name) {
        return name
            .replace(/^>>+/, '') // Quitar >> del inicio
            .replace(/\r\n/g, ' ') // Reemplazar saltos de línea por espacios
            .replace(/\n/g, ' ') // Reemplazar saltos de línea por espacios
            .trim()
            .replace(/\s+/g, ' '); // Normalizar espacios múltiples
    }

    // Función para determinar la categoría del producto basada en palabras clave
    determineCategory(productName) {
        const name = productName.toUpperCase();
        
        const keywordMappings = {
            'ACIDO': 2,
            'AGUA': 18,
            'CERA': 17,
            'CLORO': 4,
            'PILETA': 4,
            'DESODORANTE': 5,
            'DETERGENTE': 6,
            'ESCOBA': 3,
            'ESCOBILLON': 3,
            'PLUMERO': 3,
            'ESPONJA': 15,
            'JABON': 16,
            'VIRGINIA': 11,
            'LAMPAZO': 12,
            'MOPA': 12,
            'LAVANDINA': 13,
            'LYSOFORM': 14,
            'PAPEL HIGIENICO': 7,
            'ROLLO': 7,
            'PASTILLA': 8,
            'GRANEL': 19,
            'AEROSOL': 9,
            'REJILLA': 20,
            'PAÑO': 20,
            'FRANELA': 20,
            'SODA CAUSTICA': 21,
            'CAUCHET': 21,
            'SUAVIZANTE': 22,
            'TRAPO': 23,
            'SECADOR': 23
        };

        for (const [keyword, categoryId] of Object.entries(keywordMappings)) {
            if (name.includes(keyword)) {
                return categoryId;
            }
        }

        return 10; // PRODUCTOS VARIOS por defecto
    }

    // Función para insertar un nuevo producto
    async insertProduct(product) {
        try {
            const query = `
                INSERT INTO productos 
                (nombre, unidad_medida, costo, precio, categoria_id, iva, ganancia, descuento, stock_actual)
                VALUES (?, ?, ?, ?, ?, 21.00, 0.00, 0.00, 100)
            `;

            await this.connection.execute(query, [
                product.nombre,
                product.unidadMedida,
                product.costo,
                product.precio,
                product.categoriaId
            ]);

            console.log(`➕ NUEVO PRODUCTO: ${product.nombre} - ${product.precio} (Cat: ${product.categoriaId})`);
            return 'inserted';
        } catch (error) {
            console.error(`❌ Error al insertar ${product.nombre}:`, error.message);
            return false;
        }
    }

    // Función para actualizar el precio de un producto existente
    async updateProductPrice(productId, newPrice, productName, oldPrice) {
        try {
            const query = 'UPDATE productos SET precio = ? WHERE id = ?';
            await this.connection.execute(query, [newPrice, productId]);
            
            console.log(`🔄 PRECIO ACTUALIZADO: ${productName}`);
            console.log(`   Precio anterior: ${oldPrice} → Precio nuevo: ${newPrice}`);
            return 'updated';
        } catch (error) {
            console.error(`❌ Error al actualizar precio de ${productName}:`, error.message);
            return false;
        }
    }

    // Función principal para procesar cada producto (insertar o actualizar)
    async processProduct(product) {
        try {
            // Verificar si el producto ya existe
            const [existing] = await this.connection.execute(
                'SELECT id, precio, nombre FROM productos WHERE nombre = ?',
                [product.nombre]
            );

            if (existing.length > 0) {
                // El producto existe - verificar si necesita actualización de precio
                const existingProduct = existing[0];
                const currentPrice = parseFloat(existingProduct.precio);
                const newPrice = parseFloat(product.precio);

                if (Math.abs(currentPrice - newPrice) > 0.01) { // Comparar con tolerancia para decimales
                    // El precio es diferente - actualizar
                    return await this.updateProductPrice(
                        existingProduct.id, 
                        newPrice, 
                        product.nombre, 
                        currentPrice
                    );
                } else {
                    // El precio es el mismo - no hacer nada
                    console.log(`⚪ SIN CAMBIOS: ${product.nombre} - ${currentPrice}`);
                    return 'no_change';
                }
            } else {
                // El producto no existe - insertar nuevo
                return await this.insertProduct(product);
            }
        } catch (error) {
            console.error(`❌ Error al procesar ${product.nombre}:`, error.message);
            return false;
        }
    }

    // Función principal para procesar el Excel
    async processExcel(excelPath) {
        try {
            console.log('📖 Leyendo archivo Excel...');
            
            const workbook = XLSX.readFile(excelPath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`📊 Productos encontrados en Excel: ${data.length}`);
            console.log('🔧 Procesando productos...\n');

            let productsInserted = 0;
            let productsUpdated = 0;
            let productsNoChange = 0;
            let productsSkipped = 0;
            let processedCount = 0;

            for (const row of data) {
                processedCount++;
                
                const rawNombre = row['Producto'] || '';
                const unidadMedida = row['Unidad'] || 'Unidades';
                const precio = parseFloat(row['Precio Venta']) || 0;

                // Validar datos
                if (!rawNombre || precio <= 0) {
                    console.log(`⚠️ Fila ${processedCount}: Datos incompletos - ${rawNombre}`);
                    productsSkipped++;
                    continue;
                }

                const nombreLimpio = this.cleanProductName(rawNombre);
                const categoriaId = this.determineCategory(nombreLimpio);

                const product = {
                    nombre: nombreLimpio,
                    unidadMedida: unidadMedida,
                    costo: 0,
                    precio: precio,
                    categoriaId: categoriaId
                };

                // Mostrar progreso
                if (processedCount % 50 === 0) {
                    console.log(`\n📋 Progreso: ${processedCount}/${data.length} productos procesados...\n`);
                }

                // Procesar el producto (insertar o actualizar)
                const result = await this.processProduct(product);
                
                if (result === 'inserted') {
                    productsInserted++;
                } else if (result === 'updated') {
                    productsUpdated++;
                } else if (result === 'no_change') {
                    productsNoChange++;
                } else {
                    productsSkipped++;
                }

                // Pequeña pausa para no sobrecargar la base de datos
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            console.log('\n' + '='.repeat(50));
            console.log('📊 RESUMEN DEL PROCESO:');
            console.log('='.repeat(50));
            console.log(`📝 Total productos en Excel: ${data.length}`);
            console.log(`✅ Productos nuevos agregados: ${productsInserted}`);
            console.log(`🔄 Productos con precio actualizado: ${productsUpdated}`);
            console.log(`⚪ Productos sin cambios: ${productsNoChange}`);
            console.log(`⚠️ Productos omitidos (datos inválidos): ${productsSkipped}`);
            console.log('='.repeat(50));

            return {
                total: data.length,
                inserted: productsInserted,
                updated: productsUpdated,
                noChange: productsNoChange,
                skipped: productsSkipped
            };

        } catch (error) {
            console.error('❌ Error al procesar Excel:', error.message);
            throw error;
        }
    }
}

function resolveExcelPath(customExcelPath) {
    if (customExcelPath) {
        if (path.isAbsolute(customExcelPath)) {
            return customExcelPath;
        }
        return path.resolve(process.cwd(), customExcelPath);
    }

    const defaultPaths = [
        path.resolve(process.cwd(), 'scripts/productosnuevos.xlsx'),
        path.resolve(process.cwd(), 'storage/comprobantes/productosnuevos.xlsx'),
        path.resolve(__dirname, 'productosnuevos.xlsx')
    ];

    return defaultPaths.find((candidatePath) => fs.existsSync(candidatePath)) || defaultPaths[0];
}

// Función principal reutilizable (CLI + endpoint)
async function runUpdateScript(options = {}) {
    const updater = new ExcelProductUpdater();
    const excelPath = resolveExcelPath(options.excelPath);
    
    try {
        if (!fs.existsSync(excelPath)) {
            throw new Error(`Archivo Excel no encontrado: ${excelPath}`);
        }

        console.log('🚀 Iniciando actualización de productos desde Excel...');
        console.log('📌 Este script insertará productos nuevos y actualizará precios existentes\n');
        console.log(`📂 Archivo objetivo: ${excelPath}`);
        
        await updater.connect();
        const summary = await updater.processExcel(excelPath);
        
        console.log('\n🎉 Proceso completado exitosamente!');
        return {
            success: true,
            excelPath,
            summary
        };
        
    } catch (error) {
        console.error('💥 Error durante el proceso:', error.message);
        throw error;
    } finally {
        await updater.disconnect();
    }
}

// Ejecutar el script
if (require.main === module) {
    runUpdateScript().catch(console.error);
}

module.exports = {
    ExcelProductUpdater,
    runUpdateScript
};