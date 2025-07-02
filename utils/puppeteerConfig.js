const puppeteer = require('puppeteer');

/**
 * Configuración de Puppeteer optimizada para Railway y producción
 * Soluciona problemas de detección de Chrome/Chromium
 */
class PuppeteerManager {
    constructor() {
        this.isProduction = process.env.NODE_ENV === 'production';
        this.browser = null;
    }

    /**
     * Detecta automáticamente la ruta del ejecutable de Chrome
     */
    detectChromeExecutable() {
        const possiblePaths = [
            // Railway/Nix paths
            '/nix/store/*/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            // Puppeteer bundled Chrome
            require('puppeteer').executablePath(),
        ];

        // Si hay un path específico en variables de entorno
        if (process.env.PUPPETEER_EXECUTABLE_PATH && 
            process.env.PUPPETEER_EXECUTABLE_PATH !== '/nix/store/*/bin/chromium') {
            possiblePaths.unshift(process.env.PUPPETEER_EXECUTABLE_PATH);
        }

        const fs = require('fs');
        const { execSync } = require('child_process');

        // Intentar encontrar chromium dinámicamente en Railway
        try {
            const whichChromium = execSync('which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
            if (whichChromium && fs.existsSync(whichChromium)) {
                console.log(`✅ Chrome encontrado con 'which': ${whichChromium}`);
                return whichChromium;
            }
        } catch (e) {
            console.log('⚠️ No se pudo usar "which" para encontrar Chrome');
        }

        // Buscar en rutas específicas de Nix
        try {
            const nixStores = execSync('find /nix/store -name "chromium*" -type f -executable 2>/dev/null | head -5 || echo ""', { encoding: 'utf8' }).trim();
            if (nixStores) {
                const chromiumPaths = nixStores.split('\n').filter(path => path.includes('/bin/'));
                for (const path of chromiumPaths) {
                    if (fs.existsSync(path)) {
                        console.log(`✅ Chrome encontrado en Nix store: ${path}`);
                        return path;
                    }
                }
            }
        } catch (e) {
            console.log('⚠️ No se pudo buscar en /nix/store');
        }

        // Probar rutas conocidas
        for (const path of possiblePaths) {
            try {
                if (path.includes('*')) continue; // Saltar patrones con wildcard
                if (fs.existsSync(path)) {
                    console.log(`✅ Chrome encontrado en: ${path}`);
                    return path;
                }
            } catch (e) {
                continue;
            }
        }

        console.log('⚠️ No se encontró Chrome, usando Puppeteer bundled');
        return null; // Usar el Chrome bundled de Puppeteer
    }

    /**
     * Obtiene la configuración de launch para Puppeteer
     */
    getLaunchOptions() {
        const baseOptions = {
            headless: 'new',
            timeout: 30000,
        };

        if (this.isProduction) {
            const executablePath = this.detectChromeExecutable();
            
            const productionOptions = {
                ...baseOptions,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
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
                    '--disable-images',
                    '--virtual-time-budget=5000',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096',
                ],
            };

            // Solo agregar executablePath si se encontró uno válido
            if (executablePath) {
                productionOptions.executablePath = executablePath;
            }

            return productionOptions;
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
     * Lanza una nueva instancia de browser con múltiples intentos
     */
    async getBrowser() {
        try {
            if (this.browser && this.browser.isConnected()) {
                return this.browser;
            }

            console.log('🚀 Lanzando nueva instancia de Puppeteer...');
            
            const options = this.getLaunchOptions();
            
            if (this.isProduction) {
                console.log('🐳 Configuración para producción:', {
                    headless: options.headless,
                    argsCount: options.args.length,
                    executablePath: options.executablePath || 'bundled'
                });
            }

            // Primer intento con configuración completa
            try {
                this.browser = await puppeteer.launch(options);
                console.log('✅ Puppeteer lanzado exitosamente');
                return this.browser;
            } catch (primaryError) {
                console.log('⚠️ Primer intento falló:', primaryError.message);
                
                // Segundo intento: sin executablePath (usar bundled)
                if (options.executablePath) {
                    console.log('🔄 Intentando con Chrome bundled...');
                    const fallbackOptions = { ...options };
                    delete fallbackOptions.executablePath;
                    
                    try {
                        this.browser = await puppeteer.launch(fallbackOptions);
                        console.log('✅ Puppeteer lanzado con Chrome bundled');
                        return this.browser;
                    } catch (bundledError) {
                        console.log('⚠️ Chrome bundled también falló:', bundledError.message);
                    }
                }

                // Tercer intento: configuración mínima absoluta
                console.log('🔄 Intentando con configuración mínima...');
                const minimalOptions = {
                    headless: 'new',
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--single-process',
                        '--disable-gpu'
                    ],
                    timeout: 15000,
                };

                try {
                    this.browser = await puppeteer.launch(minimalOptions);
                    console.log('✅ Puppeteer lanzado con configuración mínima');
                    return this.browser;
                } catch (minimalError) {
                    console.error('❌ Todas las configuraciones fallaron');
                    throw new Error(`No se pudo lanzar Puppeteer: ${minimalError.message}`);
                }
            }

        } catch (error) {
            console.error('❌ Error fatal lanzando Puppeteer:', error.message);
            throw error;
        }
    }

    /**
     * Genera un PDF con configuración optimizada y manejo de timeouts
     */
    async generatePDF(htmlContent, pdfOptions = {}) {
        let page = null;
        
        try {
            const browser = await this.getBrowser();
            page = await browser.newPage();

            // Configuraciones de página optimizadas
            await page.setViewport({ 
                width: 1280, 
                height: 720,
                deviceScaleFactor: 1
            });

            console.log('📄 Configurando página...');

            // ✅ ESTRATEGIA SIMPLIFICADA: No interceptar requests para evitar problemas
            // Solo configurar timeouts más largos y usar setContent directamente

            // ✅ Método 1: Intentar setContent con HTML directo
            try {
                console.log('📝 Cargando HTML directamente...');
                await page.setContent(htmlContent, { 
                    waitUntil: 'load', // Usar 'load' en lugar de 'domcontentloaded'
                    timeout: 30000     // Aumentar timeout a 30 segundos
                });
                console.log('✅ HTML cargado con setContent');
            } catch (setContentError) {
                console.log('⚠️ setContent falló, intentando método alternativo...');
                
                // ✅ Método 2: Navegar a data URI como fallback
                const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`;
                await page.goto(dataUri, {
                    waitUntil: 'load',
                    timeout: 30000
                });
                console.log('✅ HTML cargado con data URI');
            }

            // ✅ Esperar un momento adicional para que se renderice el CSS
            await page.waitForTimeout(1000);

            // Configuración por defecto del PDF
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
                timeout: 30000, // Aumentar timeout del PDF también
                ...pdfOptions
            };

            console.log('📄 Generando PDF...');
            const pdfBuffer = await page.pdf(defaultPdfOptions);
            
            console.log(`✅ PDF generado exitosamente (${pdfBuffer.length} bytes)`);
            return pdfBuffer;

        } catch (error) {
            console.error('❌ Error generando PDF:', error.message);
            
            // ✅ Proporcionar más información del error
            if (error.message.includes('Navigation timeout')) {
                throw new Error(`Timeout cargando HTML. Verifica que el HTML sea válido y no tenga recursos externos.`);
            } else if (error.message.includes('Target closed')) {
                throw new Error(`La página se cerró inesperadamente. Puede ser un problema de memoria.`);
            } else {
                throw new Error(`Error generando PDF: ${error.message}`);
            }
        } finally {
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
            detectedExecutable: this.detectChromeExecutable()
        };
    }

    /**
     * Endpoint de diagnóstico para verificar Puppeteer
     */
    async diagnostics() {
        const status = this.getStatus();
        
        try {
            const browser = await this.getBrowser();
            const version = await browser.version();
            await this.closeBrowser();
            
            return {
                ...status,
                browserVersion: version,
                canLaunch: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                ...status,
                canLaunch: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

// Crear instancia única
const puppeteerManager = new PuppeteerManager();

// Manejar cierre graceful del proceso
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM recibido, cerrando Puppeteer...');
    await puppeteerManager.closeBrowser();
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT recibido, cerrando Puppeteer...');
    await puppeteerManager.closeBrowser();
});

module.exports = puppeteerManager;