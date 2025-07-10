const fs = require('fs');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

// Configuración de la base de datos
const dbConfig = {
    host: '31.97.251.186',
    user: 'remote_user',
    password: 'remoteuser251199',
    database: 'DB_distri',
    charset: 'utf8mb4'
};

// Mapeo de categorías - mismas que en tu algoritmo original
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

class ExcelProductImporter {
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
        
        // Mapeos específicos por palabras clave
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

        // Buscar coincidencias
        for (const [keyword, categoryId] of Object.entries(keywordMappings)) {
            if (name.includes(keyword)) {
                return categoryId;
            }
        }

        // Si no se encuentra una categoría específica, usar "PRODUCTOS VARIOS"
        return 10;
    }

    // Función para insertar producto en la base de datos
    async insertProduct(product) {
        try {
            // Verificar si el producto ya existe
            const [existing] = await this.connection.execute(
                'SELECT id FROM productos WHERE nombre = ?',
                [product.nombre]
            );

            if (existing.length > 0) {
                console.log(`⚠️ Producto ya existe: ${product.nombre}`);
                return false;
            }

            // Insertar nuevo producto
            const query = `
                INSERT INTO productos 
                (nombre, unidad_medida, costo, precio, categoria_id, iva, ganancia, descuento, stock_actual)
                VALUES (?, ?, ?, ?, ?, 21.00, 0.00, 0.00, 0)
            `;

            await this.connection.execute(query, [
                product.nombre,
                product.unidadMedida,
                product.costo,
                product.precio,
                product.categoriaId
            ]);

            console.log(`✅ Insertado: ${product.nombre} - $${product.precio} (Cat: ${product.categoriaId})`);
            return true;
        } catch (error) {
            console.error(`❌ Error al insertar ${product.nombre}:`, error.message);
            return false;
        }
    }

    // Función principal para procesar el Excel
    async processExcel(excelPath) {
        try {
            console.log('📖 Leyendo archivo Excel...');
            
            // Leer el archivo Excel
            const workbook = XLSX.readFile(excelPath);
            const sheetName = workbook.SheetNames[0]; // Usar la primera hoja
            const worksheet = workbook.Sheets[sheetName];
            
            // Convertir a JSON
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`📊 Productos encontrados: ${data.length}`);
            console.log('🔧 Procesando productos...');

            let productsInserted = 0;
            let productsSkipped = 0;
            let processedCount = 0;

            for (const row of data) {
                processedCount++;
                
                // Extraer datos del Excel
                const rawNombre = row['Producto'] || '';
                const unidadMedida = row['Unidad'] || 'Unidades';
                const precio = parseFloat(row['Precio Venta']) || 0;

                // Validar que tengamos datos válidos
                if (!rawNombre || precio <= 0) {
                    console.log(`⚠️ Fila ${processedCount}: Datos incompletos - ${rawNombre}`);
                    productsSkipped++;
                    continue;
                }

                // Limpiar el nombre del producto
                const nombreLimpio = this.cleanProductName(rawNombre);
                
                // Determinar la categoría
                const categoriaId = this.determineCategory(nombreLimpio);

                // Crear objeto producto
                const product = {
                    nombre: nombreLimpio,
                    unidadMedida: unidadMedida,
                    costo: 0, // No tenemos costo en el Excel, usar 0
                    precio: precio,
                    categoriaId: categoriaId
                };

                // Mostrar progreso cada 100 productos
                if (processedCount % 100 === 0) {
                    console.log(`📋 Procesando... ${processedCount}/${data.length}`);
                }

                // Insertar en la base de datos
                const inserted = await this.insertProduct(product);
                if (inserted) {
                    productsInserted++;
                } else {
                    productsSkipped++;
                }
            }

            console.log('\n📊 RESUMEN DEL PROCESO:');
            console.log(`📝 Productos procesados: ${processedCount}`);
            console.log(`✅ Productos insertados: ${productsInserted}`);
            console.log(`⚠️ Productos omitidos: ${productsSkipped}`);

        } catch (error) {
            console.error('❌ Error al procesar Excel:', error.message);
            throw error;
        }
    }
}

// Función principal
async function main() {
    const importer = new ExcelProductImporter();
    
    try {
        // Ruta al archivo Excel
        const excelPath = './productosnuevos.xlsx'; // Cambia esta ruta por la de tu archivo

        if (!fs.existsSync(excelPath)) {
            console.error('❌ Archivo Excel no encontrado:', excelPath);
            console.log('💡 Asegúrate de que el archivo existe y la ruta es correcta');
            return;
        }

        console.log('🚀 Iniciando importación de productos desde Excel...');
        
        await importer.connect();
        await importer.processExcel(excelPath);
        
        console.log('🎉 Importación completada exitosamente!');
        
    } catch (error) {
        console.error('💥 Error durante la importación:', error.message);
    } finally {
        await importer.disconnect();
    }
}

// Ejecutar el script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = ExcelProductImporter;