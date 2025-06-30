const puppeteer = require('puppeteer');

/**
 * Configuración de Puppeteer optimizada para producción
 * Soluciona problemas en contenedores Docker y Railway
 */
class PuppeteerManager {
    constructor() {
        this.isProduction = process.env.NODE_ENV === 'production';
        this.browser = null;
    }

    /**
     * Obtiene la configuración de launch para Puppeteer
     */
    getLaunchOptions() {
        const baseOptions = {
            headless: 'new', // Usar nuevo modo headless
            timeout: 30000,  // 30 segundos timeout
        };

        if (this.isProduction) {
            // ✅ Configuración específica para producción/contenedores
            return {
                ...baseOptions,
                args: [
                    '--no-sandbox',                    // ✅ CRÍTICO: Necesario para contenedores
                    '--disable-setuid-sandbox',       // ✅ CRÍTICO: Seguridad en contenedores
                    '--disable-dev-shm-usage',        // ✅ Evita problemas de memoria compartida
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',               // ✅ CRÍTICO: Evita problemas de procesos múltiples
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-extensions',
                    '--disable-plugins',
                    '--disable-images',              // ✅ Optimización: No cargar imágenes
                    '--disable-javascript',          // ✅ Solo si no necesitas JS en el PDF
                    '--virtual-time-budget=5000',    // ✅ Límite de tiempo virtual
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            };
        } else {
            // Configuración para desarrollo
            return {
                ...baseOptions,
                args: [
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ],
                devtools: false,
            };
        }
    }

    /**
     * Lanza una nueva instancia de browser o reutiliza la existente
     */
    async getBrowser() {
        try {
            // Verificar si el browser existente sigue funcionando
            if (this.browser && this.browser.isConnected()) {
                return this.browser;
            }

            console.log('🚀 Lanzando nueva instancia de Puppeteer...');
            
            const options = this.getLaunchOptions();
            
            if (this.isProduction) {
                console.log('🐳 Configuración para producción:', {
                    headless: options.headless,
                    argsCount: options.args.length,
                    executablePath: options.executablePath || 'default'
                });
            }

            this.browser = await puppeteer.launch(options);
            
            console.log('✅ Puppeteer lanzado exitosamente');
            return this.browser;

        } catch (error) {
            console.error('❌ Error lanzando Puppeteer:', error.message);
            
            // Intentar con configuración mínima como fallback
            if (this.isProduction && !error.message.includes('--no-sandbox')) {
                console.log('🔄 Intentando con configuración mínima...');
                
                try {
                    this.browser = await puppeteer.launch({
                        headless: 'new',
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process'],
                        timeout: 15000,
                    });
                    
                    console.log('✅ Puppeteer lanzado con configuración mínima');
                    return this.browser;
                } catch (fallbackError) {
                    console.error('❌ Error incluso con configuración mínima:', fallbackError.message);
                    throw fallbackError;
                }
            }
            
            throw error;
        }
    }

    /**
     * Genera un PDF con configuración optimizada
     */
    async generatePDF(htmlContent, pdfOptions = {}) {
        let page = null;
        
        try {
            const browser = await this.getBrowser();
            page = await browser.newPage();

            // ✅ Configuraciones de página optimizadas
            await page.setViewport({ 
                width: 1280, 
                height: 720,
                deviceScaleFactor: 1
            });

            // ✅ Desactivar imágenes y recursos innecesarios para PDFs
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (['image', 'media', 'font'].includes(resourceType)) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            // ✅ Configurar contenido HTML
            await page.setContent(htmlContent, { 
                waitUntil: 'networkidle0',
                timeout: 15000 
            });

            // ✅ Configuración por defecto del PDF
            const defaultPdfOptions = {
                format: 'A4',
                margin: {
                    top: '10mm',
                    right: '10mm',
                    bottom: '10mm',
                    left: '10mm'
                },
                printBackground: true,
                preferCSSPageSize: false,
                displayHeaderFooter: false,
                timeout: 30000,
                ...pdfOptions
            };

            console.log('📄 Generando PDF...');
            const pdfBuffer = await page.pdf(defaultPdfOptions);
            
            console.log('✅ PDF generado exitosamente');
            return pdfBuffer;

        } catch (error) {
            console.error('❌ Error generando PDF:', error.message);
            throw new Error(`Error generando PDF: ${error.message}`);
        } finally {
            // ✅ Cerrar página para liberar memoria
            if (page) {
                try {
                    await page.close();
                } catch (closeError) {
                    console.warn('⚠️ Error cerrando página:', closeError.message);
                }
            }
        }
    }

    /**
     * Cierra el browser y limpia recursos
     */
    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
                console.log('🔌 Browser cerrado correctamente');
            } catch (error) {
                console.warn('⚠️ Error cerrando browser:', error.message);
            } finally {
                this.browser = null;
            }
        }
    }

    /**
     * Obtiene información de estado para debugging
     */
    getStatus() {
        return {
            isProduction: this.isProduction,
            hasBrowser: !!this.browser,
            isConnected: this.browser ? this.browser.isConnected() : false,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'default'
        };
    }
}

// ✅ Crear instancia única
const puppeteerManager = new PuppeteerManager();

// ✅ Manejar cierre graceful del proceso
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM recibido, cerrando Puppeteer...');
    await puppeteerManager.closeBrowser();
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT recibido, cerrando Puppeteer...');
    await puppeteerManager.closeBrowser();
});

module.exports = puppeteerManager;