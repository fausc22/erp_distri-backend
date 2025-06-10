const fs = require('fs');
const mysql = require('mysql2/promise');
const pdf = require('pdf-parse');
const path = require('path');


// Configuración de la base de datos
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '251199',
    database: 'erp_distri',
    charset: 'utf8mb4'
};

// Mapeo de categorías del PDF a IDs de la base de datos
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

class ProductImporter {
    constructor() {
        this.connection = null;
        this.currentCategoryId = null;
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

    // Función para limpiar y normalizar nombres
    cleanProductName(name) {
        return name
            .replace(/^>+/, '') // Quitar >> del inicio
            .trim()
            .replace(/\s+/g, ' '); // Normalizar espacios
    }

    // Función para determinar si una línea es una categoría
    isCategory(line) {
        const cleanLine = this.cleanProductName(line);
        
        // Buscar coincidencias exactas primero
        for (const [categoryName, categoryId] of Object.entries(categoriaMapping)) {
            if (cleanLine.toUpperCase().includes(categoryName.toUpperCase())) {
                return { isCategory: true, categoryId, categoryName };
            }
        }

        // Verificar patrones específicos de categorías
        const categoryPatterns = [
            /^(TODOS LOS PRODUCTOS|ACIDO|AGUA|CERAS|CLORO|DESODORANTES|DETERGENTES|ESCOBAS|ESPONJAS|JABONES|LA VIRGINIA|LAMPAZOS|LAVANDINA|LYSOFORM|PAPEL HIGIENICO|PASTILLAS|PRODUCTOS|REJILLAS|SODA|SUAVIZANTES|TRAPOS)/i
        ];

        for (const pattern of categoryPatterns) {
            if (pattern.test(cleanLine)) {
                // Buscar la categoría más específica que coincida
                let bestMatch = null;
                let bestMatchLength = 0;

                for (const [categoryName, categoryId] of Object.entries(categoriaMapping)) {
                    if (cleanLine.toUpperCase().includes(categoryName.toUpperCase()) && 
                        categoryName.length > bestMatchLength) {
                        bestMatch = { categoryId, categoryName };
                        bestMatchLength = categoryName.length;
                    }
                }

                if (bestMatch) {
                    return { isCategory: true, ...bestMatch };
                }
            }
        }

        return { isCategory: false };
    }

    // Función para extraer datos de producto de una línea
    parseProductLine(line) {
        try {
            // Patrón para capturar: Nombre + Unidad + Costo + Precio
            const pattern = /^(.*?)\s+(Kilogramos|Litros|Unidades)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/;
            const match = line.match(pattern);

            if (!match) {
                return null;
            }

            const [, nombre, unidadMedida, costoStr, precioStr] = match;

            const cleanNombre = this.cleanProductName(nombre);
            const costo = parseFloat(costoStr.replace(/,/g, ''));
            const precio = parseFloat(precioStr.replace(/,/g, ''));

            // Validar que los valores sean números válidos
            if (isNaN(costo) || isNaN(precio)) {
                return null;
            }

            return {
                nombre: cleanNombre,
                unidadMedida: unidadMedida,
                costo: costo,
                precio: precio,
                categoriaId: this.currentCategoryId
            };
        } catch (error) {
            console.warn('⚠️ Error al parsear línea:', line, error.message);
            return null;
        }
    }

    // Función para insertar producto en la base de datos
    async insertProduct(product) {
        try {
            // Verificar si el producto ya existe
            const [existing] = await this.connection.execute(
                'SELECT id FROM productos WHERE nombre = ? AND categoria_id = ?',
                [product.nombre, product.categoriaId]
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

            console.log(`✅ Insertado: ${product.nombre} - $${product.precio}`);
            return true;
        } catch (error) {
            console.error(`❌ Error al insertar ${product.nombre}:`, error.message);
            return false;
        }
    }

    // Función principal para procesar el PDF
    async processPDF(pdfPath) {
        try {
            console.log('📖 Leyendo archivo PDF...');
            
            const dataBuffer = fs.readFileSync(pdfPath);
            const pdfData = await pdf(dataBuffer);
            
            console.log('📄 PDF leído exitosamente');
            console.log('📊 Procesando contenido...');

            const lines = pdfData.text.split('\n');
            let productsInserted = 0;
            let productsSkipped = 0;
            let categoriesFound = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                if (!line || line.length < 10) continue;

                // Verificar si es una categoría
                const categoryCheck = this.isCategory(line);
                
                if (categoryCheck.isCategory) {
                    this.currentCategoryId = categoryCheck.categoryId;
                    categoriesFound++;
                    console.log(`📁 Categoría encontrada: ${categoryCheck.categoryName} (ID: ${categoryCheck.categoryId})`);
                    continue;
                }

                // Si tenemos una categoría actual, intentar parsear como producto
                if (this.currentCategoryId) {
                    const product = this.parseProductLine(line);
                    
                    if (product) {
                        const inserted = await this.insertProduct(product);
                        if (inserted) {
                            productsInserted++;
                        } else {
                            productsSkipped++;
                        }
                    }
                }
            }

            console.log('\n📊 RESUMEN DEL PROCESO:');
            console.log(`📁 Categorías procesadas: ${categoriesFound}`);
            console.log(`✅ Productos insertados: ${productsInserted}`);
            console.log(`⚠️ Productos omitidos: ${productsSkipped}`);

        } catch (error) {
            console.error('❌ Error al procesar PDF:', error.message);
            throw error;
        }
    }
}

// Función principal
async function main() {
    const importer = new ProductImporter();
    
    try {
        // Verificar que el archivo PDF existe
        const pdfPath = './productos.pdf'; // Cambia esta ruta por la de tu archivo

        if (!fs.existsSync(pdfPath)) {
            console.error('❌ Archivo PDF no encontrado:', pdfPath);
            console.log('💡 Asegúrate de que el archivo existe y la ruta es correcta');
            return;
        }

        console.log('🚀 Iniciando importación de productos...');
        
        await importer.connect();
        await importer.processPDF(pdfPath);
        
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

module.exports = ProductImporter;