const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class PuppeteerManager {
    constructor() {
        this.browser = null;
        this.isInitializing = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.initTimeout = 45000; // 45 segundos para VPS
        this.puppeteerVersion = null;
    }

    // Detectar versión de Puppeteer para compatibilidad
    async detectPuppeteerVersion() {
        if (this.puppeteerVersion) return this.puppeteerVersion;
        
        try {
            const puppeteerPackage = require('puppeteer/package.json');
            this.puppeteerVersion = puppeteerPackage.version;
            console.log(`📦 Puppeteer versión detectada: ${this.puppeteerVersion}`);
        } catch (error) {
            this.puppeteerVersion = 'unknown';
            console.log('⚠️ No se pudo detectar la versión de Puppeteer');
        }
        return this.puppeteerVersion;
    }

    // Verificar si waitForTimeout está disponible
    isWaitForTimeoutAvailable(page) {
        return typeof page.waitForTimeout === 'function';
    }

    // Función de wait compatible
    async waitFor(page, timeMs) {
        if (this.isWaitForTimeoutAvailable(page)) {
            await page.waitForTimeout(timeMs);
        } else {
            // Fallback para versiones antiguas
            await new Promise(resolve => setTimeout(resolve, timeMs));
        }
    }

    // Detectar ejecutable de Chrome/Chromium para VPS Linux
    findChromiumExecutable() {
        const possiblePaths = [
            // VPS Linux paths (más comunes en Hostinger)
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chrome',
            '/snap/bin/chromium',
            '/opt/google/chrome/chrome',
            // Paths alternativos para VPS
            '/usr/local/bin/chromium-browser',
            '/usr/local/bin/google-chrome',
            // Local development paths (por si acaso)
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];

        // Intentar detectar con 'which' primero
        try {
            const whichCommands = [
                'which google-chrome-stable',
                'which google-chrome', 
                'which chromium-browser',
                'which chromium',
                'which chrome'
            ];
            
            for (const cmd of whichCommands) {
                try {
                    const result = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
                    const detectedPath = result.trim();
                    if (detectedPath && fs.existsSync(detectedPath)) {
                        console.log('🔍 Chrome detectado con comando:', cmd, '→', detectedPath);
                        return detectedPath;
                    }
                } catch (e) {
                    // Continuar con el siguiente comando
                }
            }
        } catch (error) {
            console.log('⚠️ Comandos "which" fallaron, usando rutas predefinidas');
        }

        // Buscar en rutas predefinidas
        for (const checkPath of possiblePaths) {
            if (fs.existsSync(checkPath)) {
                console.log('🔍 Chrome encontrado en ruta predefinida:', checkPath);
                return checkPath;
            }
        }

        console.log('❌ No se encontró ejecutable de Chrome/Chromium');
        return null;
    }

    // Configuración de launch optimizada para VPS
    getLaunchConfig() {
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || this.findChromiumExecutable();
        
        const baseArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-translate',
            '--disable-default-apps',
            '--disable-background-networking',
            '--disable-software-rasterizer',
            '--disable-background-mode'
        ];

        // Configuración específica para VPS/producción
        if (process.env.NODE_ENV === 'production') {
            baseArgs.push(
                '--memory-pressure-off',
                '--max_old_space_size=2048', // Ajustado para VPS
                '--disable-features=AudioServiceOutOfProcess',
                '--disable-domain-reliability',
                '--disable-component-extensions-with-background-pages',
                '--disable-client-side-phishing-detection'
            );
        }

        // Configuración base compatible con versiones antiguas
        const config = {
            args: baseArgs,
            timeout: this.initTimeout,
            dumpio: process.env.NODE_ENV === 'development', // Solo logs en desarrollo
            // Solo agregar executablePath si lo encontramos
            ...(executablePath && { executablePath })
        };

        // Configurar headless según versión de Puppeteer
        try {
            const version = require('puppeteer/package.json').version;
            const majorVersion = parseInt(version.split('.')[0]);
            
            if (majorVersion >= 19) {
                config.headless = 'new';
            } else {
                config.headless = true;
            }
        } catch (error) {
            config.headless = true; // Fallback seguro
        }

        // Solo agregar protocolTimeout si está soportado
        try {
            if (puppeteer.defaultArgs && puppeteer.defaultArgs().includes('--remote-debugging-port')) {
                config.protocolTimeout = 120000;
            }
        } catch (error) {
            // Versión muy antigua, continuar sin protocolTimeout
        }

        console.log('🖥️ Configuración VPS Puppeteer:', {
            headless: config.headless,
            argsCount: config.args.length,
            executablePath: config.executablePath || 'bundled',
            timeout: config.timeout,
            protocolTimeout: config.protocolTimeout || 'default',
            environment: 'VPS'
        });

        return config;
    }

    // Inicializar browser con reintentos optimizado para VPS
    async initBrowser() {
        await this.detectPuppeteerVersion();

        if (this.browser && this.browser.connected) {
            try {
                // Verificar que realmente funciona
                await this.browser.version();
                return this.browser;
            } catch (error) {
                console.log('⚠️ Browser existe pero no responde, reiniciando...');
                this.browser = null;
            }
        }

        if (this.isInitializing) {
            console.log('⏳ Esperando inicialización existente...');
            // Esperar hasta que termine la inicialización
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            return this.browser;
        }

        this.isInitializing = true;

        try {
            console.log(`🚀 Lanzando Puppeteer en VPS (intento ${this.retryCount + 1}/${this.maxRetries})...`);
            
            // Cerrar browser anterior si existe
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (e) {
                    console.log('⚠️ Error cerrando browser anterior:', e.message);
                }
                this.browser = null;
            }

            const config = this.getLaunchConfig();
            
            // Lanzar con timeout más generous para VPS
            const browserPromise = puppeteer.launch(config);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout iniciando Puppeteer en VPS')), this.initTimeout);
            });

            this.browser = await Promise.race([browserPromise, timeoutPromise]);

            // Verificar que el browser esté realmente funcionando
            if (!this.browser || !this.browser.connected) {
                throw new Error('Browser no se conectó correctamente');
            }

            // Test básico de funcionalidad
            try {
                await this.browser.version();
                console.log('✅ Puppeteer inicializado y verificado en VPS');
            } catch (testError) {
                throw new Error('Browser conectado pero no funcional: ' + testError.message);
            }

            this.retryCount = 0; // Reset retry count en éxito
            
            // Manejar cierre inesperado
            this.browser.on('disconnected', () => {
                console.log('⚠️ Browser se desconectó inesperadamente en VPS');
                this.browser = null;
            });

            return this.browser;

        } catch (error) {
            console.error('❌ Error inicializando Puppeteer en VPS:', error.message);
            
            this.retryCount++;
            if (this.retryCount < this.maxRetries) {
                const waitTime = this.retryCount * 3000; // Incrementar tiempo de espera
                console.log(`🔄 Reintentando en ${waitTime/1000} segundos... (${this.retryCount}/${this.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this.initBrowser();
            } else {
                this.retryCount = 0;
                throw new Error(`Failed to initialize Puppeteer on VPS after ${this.maxRetries} attempts: ${error.message}`);
            }
        } finally {
            this.isInitializing = false;
        }
    }

    // Generar PDF optimizado para VPS y compatible con versiones antiguas
    async generatePDF(htmlContent, options = {}) {
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
        let page = null;
        
        try {
            console.log(`📄 Generando PDF optimizado en VPS (intento ${attempt + 1}/${maxAttempts})...`);
            
            const browser = await this.initBrowser();
            
            if (!browser || !browser.connected) {
                throw new Error('Browser no disponible o desconectado en VPS');
            }

            page = await Promise.race([
                browser.newPage(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout creando página en VPS')), 20000)
                )
            ]);

            // ✅ CONFIGURACIÓN OPTIMIZADA PARA UNA SOLA PÁGINA
            try {
                await page.setDefaultTimeout(90000);
            } catch (e) {
                console.log('⚠️ setDefaultTimeout no soportado en esta versión');
            }

            try {
                await page.setDefaultNavigationTimeout(90000);
            } catch (e) {
                console.log('⚠️ setDefaultNavigationTimeout no soportado en esta versión');
            }
            
            // ✅ VIEWPORT OPTIMIZADO PARA A4
            await page.setViewport({ 
                width: 794,  // Ancho A4 en píxeles (210mm)
                height: 1123, // Alto A4 en píxeles (297mm)
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false
            });

            // Deshabilitar imágenes para acelerar en VPS si es necesario
            if (process.env.NODE_ENV === 'production') {
                try {
                    await page.setRequestInterception(true);
                    page.on('request', (req) => {
                        if (req.resourceType() === 'image') {
                            req.abort();
                        } else {
                            req.continue();
                        }
                    });
                } catch (e) {
                    console.log('⚠️ setRequestInterception no soportado, continuando sin optimización de imágenes');
                }
            }

            // ✅ INYECTAR CSS ADICIONAL PARA CONTROL DE PÁGINAS
            const optimizedHtmlContent = `
                <style>
                    @page {
                        size: A4;
                        margin: 8mm 6mm 8mm 6mm;
                    }
                    
                    body {
                        margin: 0;
                        padding: 0;
                        font-size: 13px;
                        line-height: 1.3;
                        -webkit-print-color-adjust: exact;
                        color-adjust: exact;
                    }
                    
                    .container {
                        width: 100%;
                        max-width: none;
                        margin: 0;
                        padding: 8px;
                        box-sizing: border-box;
                        page-break-inside: avoid;
                    }
                    
                    .header {
                        font-size: 20px;
                        margin-bottom: 8px;
                    }
                    
                    .info, .info2 {
                        margin-bottom: 6px;
                        padding-bottom: 6px;
                        font-size: 12px;
                        line-height: 1.2;
                    }
                    
                    .table {
                        margin-top: 8px;
                        font-size: 11px;
                    }
                    
                    .table th, .table td {
                        padding: 4px 6px;
                        line-height: 1.2;
                    }
                    
                    .footer {
                        margin-top: 8px;
                        font-size: 10px;
                    }
                    
                    /* Evitar saltos de página innecesarios */
                    h1, h2, h3, .header {
                        page-break-after: avoid;
                    }
                    
                    .table {
                        page-break-inside: auto;
                    }
                    
                    .table tr {
                        page-break-inside: avoid;
                        page-break-after: auto;
                    }
                    
                    /* Para documentos con Tailwind (nota de pedido) */
                    .page-container {
                        max-width: none !important;
                        min-height: auto !important;
                        margin: 0 !important;
                        padding: 8px !important;
                        box-shadow: none !important;
                    }
                    
                    .text-4xl, .text-5xl {
                        font-size: 1.5rem !important;
                    }
                    
                    .text-6xl {
                        font-size: 2rem !important;
                    }
                    
                    .mb-8, .mb-6, .mb-4 {
                        margin-bottom: 0.5rem !important;
                    }
                    
                    .mt-8, .mt-6, .mt-4 {
                        margin-top: 0.5rem !important;
                    }
                    
                    .p-4, .p-6, .p-8 {
                        padding: 0.25rem !important;
                    }
                </style>
                ${htmlContent}
            `;

            const waitUntilOptions = ['load', 'domcontentloaded'];
            
            await page.setContent(optimizedHtmlContent, { 
                waitUntil: waitUntilOptions,
                timeout: 45000 
            });

            // Esperar renderizado completo
            await this.waitFor(page, 1500);

            // ✅ CONFIGURACIÓN DE PDF OPTIMIZADA PARA UNA PÁGINA
            const pdfOptions = {
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: true, // ✅ Respetar CSS @page
                displayHeaderFooter: false,
                margin: {
                    top: '8mm',    // Márgenes mínimos pero seguros
                    right: '6mm',
                    bottom: '8mm', 
                    left: '6mm'
                },
                // ✅ CONFIGURACIONES PARA EVITAR PÁGINAS MÚLTIPLES
                width: '210mm',
                height: '297mm',
                scale: 0.9, // ✅ Reducir ligeramente para que quepa mejor
                ...options
            };

            console.log('📋 Generando PDF optimizado en VPS con opciones:', pdfOptions);

            const pdfBuffer = await Promise.race([
                page.pdf(pdfOptions),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout generando PDF en VPS')), 60000)
                )
            ]);

            console.log(`✅ PDF optimizado generado exitosamente en VPS (${pdfBuffer.length} bytes)`);
            return pdfBuffer;

        } catch (error) {
            console.error(`❌ Error en intento ${attempt + 1} en VPS:`, error.message);
            
            if (error.message.includes('Protocol error') || 
                error.message.includes('Target closed') ||
                error.message.includes('Session closed') ||
                error.message.includes('Browser closed')) {
                console.log('🔄 Invalidando browser por error crítico en VPS...');
                if (this.browser) {
                    try {
                        await this.browser.close();
                    } catch (e) {
                        console.log('⚠️ Error cerrando browser:', e.message);
                    }
                    this.browser = null;
                }
            }

            attempt++;
            if (attempt >= maxAttempts) {
                throw new Error(`Error generando PDF en VPS después de ${maxAttempts} intentos: ${error.message}`);
            }

            const waitTime = attempt * 2000;
            console.log(`⏳ Esperando ${waitTime/1000}s antes del siguiente intento...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
        } finally {
            if (page) {
                try {
                    if (!page.isClosed()) {
                        await page.close();
                    }
                } catch (e) {
                    console.log('⚠️ Error cerrando página:', e.message);
                }
            }
        }
    }
}   

    // Diagnostics específicos para VPS
    async diagnostics() {
        const results = {
            timestamp: new Date().toISOString(),
            environment: 'VPS Hostinger',
            node_env: process.env.NODE_ENV,
            puppeteer_version: await this.detectPuppeteerVersion(),
            chromium_paths: [],
            browser_status: 'disconnected',
            system_info: {},
            vps_specific: {},
            compatibility: {}
        };

        // Verificar rutas de chromium en VPS
        const possiblePaths = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium', 
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/snap/bin/chromium',
            '/opt/google/chrome/chrome'
        ];

        for (const checkPath of possiblePaths) {
            try {
                const exists = fs.existsSync(checkPath);
                const stats = exists ? fs.statSync(checkPath) : null;
                results.chromium_paths.push({ 
                    path: checkPath, 
                    exists,
                    executable: exists ? (stats.mode & parseInt('111', 8)) : false
                });
            } catch (e) {
                results.chromium_paths.push({ 
                    path: checkPath, 
                    exists: false,
                    error: e.message
                });
            }
        }

        // Verificar compatibilidad de métodos
        try {
            if (this.browser && this.browser.connected) {
                const page = await this.browser.newPage();
                results.compatibility = {
                    waitForTimeout: this.isWaitForTimeoutAvailable(page),
                    setRequestInterception: typeof page.setRequestInterception === 'function',
                    setDefaultTimeout: typeof page.setDefaultTimeout === 'function'
                };
                await page.close();
            }
        } catch (e) {
            results.compatibility.error = e.message;
        }

        // Verificar estado del browser
        if (this.browser && this.browser.connected) {
            results.browser_status = 'connected';
            try {
                const version = await this.browser.version();
                const pages = await this.browser.pages();
                results.browser_version = version;
                results.browser_pages = pages.length;
            } catch (e) {
                results.browser_status = 'error';
                results.browser_error = e.message;
            }
        }

        // Info específica del VPS
        try {
            results.vps_specific = {
                uptime: process.uptime(),
                memory_usage: process.memoryUsage(),
                platform: process.platform,
                arch: process.arch,
                node_version: process.version,
                cpu_usage: process.cpuUsage()
            };

            // Comandos específicos de VPS Linux
            try {
                results.vps_specific.os_info = execSync('uname -a', { encoding: 'utf8', timeout: 3000 }).trim();
            } catch (e) {
                results.vps_specific.os_info_error = e.message;
            }

            try {
                results.vps_specific.memory_info = execSync('free -h', { encoding: 'utf8', timeout: 3000 }).trim();
            } catch (e) {
                results.vps_specific.memory_info_error = e.message;
            }

        } catch (e) {
            results.vps_specific.error = e.message;
        }

        // Variables de entorno importantes
        results.environment_variables = {
            PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
            PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD,
            NODE_ENV: process.env.NODE_ENV,
            PORT: process.env.PORT
        };

        return results;
    }

    // Cleanup optimizado para VPS
    async cleanup() {
        if (this.browser) {
            try {
                console.log('🧹 Cerrando Puppeteer en VPS...');
                
                // Cerrar todas las páginas primero
                const pages = await this.browser.pages();
                await Promise.all(pages.map(page => page.close().catch(e => 
                    console.log('⚠️ Error cerrando página:', e.message)
                )));
                
                // Cerrar browser
                await this.browser.close();
                console.log('✅ Puppeteer cerrado correctamente en VPS');
            } catch (error) {
                console.error('❌ Error cerrando Puppeteer:', error.message);
            }
            this.browser = null;
        }
    }

    // Método para verificar salud del sistema
    async healthCheck() {
        try {
            const browser = await this.initBrowser();
            const page = await browser.newPage();
            await page.setContent('<html><body><h1>Test</h1></body></html>');
            const pdf = await page.pdf({ format: 'A4' });
            await page.close();
            
            return {
                status: 'healthy',
                pdfSize: pdf.length,
                timestamp: new Date().toISOString(),
                puppeteerVersion: this.puppeteerVersion
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString(),
                puppeteerVersion: this.puppeteerVersion
            };
        }
    }
}

// Instancia singleton
const puppeteerManager = new PuppeteerManager();

// Cleanup automático optimizado para VPS
process.on('SIGINT', async () => {
    console.log('🛑 Recibida señal SIGINT, cerrando aplicación...');
    await puppeteerManager.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Recibida señal SIGTERM, cerrando aplicación...');
    await puppeteerManager.cleanup();
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    console.error('💥 Excepción no capturada:', error);
    await puppeteerManager.cleanup();
    process.exit(1);
});

module.exports = puppeteerManager;