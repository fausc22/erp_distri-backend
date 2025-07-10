#!/usr/bin/env node

// ✅ SCRIPT DE VERIFICACIÓN DE CHROME/PUPPETEER
// Ejecutar con: node verify-chrome.js

const fs = require('fs');
const { execSync } = require('child_process');

console.log('🔍 DIAGNÓSTICO DE CHROME/PUPPETEER EN VPS');
console.log('='.repeat(50));

// ✅ 1. Verificar Node.js y npm
console.log('\n📦 VERIFICANDO NODE.JS...');
console.log(`   Node.js: ${process.version}`);
console.log(`   Plataforma: ${process.platform}`);
console.log(`   Arquitectura: ${process.arch}`);

// ✅ 2. Verificar Puppeteer
console.log('\n🎭 VERIFICANDO PUPPETEER...');
try {
    const puppeteer = require('puppeteer');
    console.log(`   ✅ Puppeteer instalado: v${require('puppeteer/package.json').version}`);
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    process.exit(1);
}

// ✅ 3. Verificar rutas de Chrome
console.log('\n🌐 VERIFICANDO CHROME/CHROMIUM...');
const chromePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome'
];

let foundChrome = null;
for (const path of chromePaths) {
    if (fs.existsSync(path)) {
        console.log(`   ✅ Encontrado: ${path}`);
        if (!foundChrome) foundChrome = path;
    } else {
        console.log(`   ❌ No existe: ${path}`);
    }
}

if (!foundChrome) {
    console.log('\n❌ NO SE ENCONTRÓ CHROME/CHROMIUM');
    console.log('   Ejecuta: bash install-chrome-vps.sh');
    process.exit(1);
}

// ✅ 4. Verificar versión de Chrome
console.log('\n📋 INFORMACIÓN DE CHROME...');
try {
    const version = execSync(`${foundChrome} --version`, { encoding: 'utf8' }).trim();
    console.log(`   ✅ Versión: ${version}`);
} catch (error) {
    console.log(`   ❌ Error obteniendo versión: ${error.message}`);
}

// ✅ 5. Verificar dependencias del sistema
console.log('\n🔧 VERIFICANDO DEPENDENCIAS...');
const dependencies = [
    'xdg-utils',
    'libnss3',
    'libatk-bridge2.0-0',
    'libxrandr2',
    'libxcomposite1',
    'libxss1'
];

for (const dep of dependencies) {
    try {
        execSync(`dpkg -l | grep ${dep}`, { stdio: 'ignore' });
        console.log(`   ✅ ${dep}: instalado`);
    } catch (error) {
        console.log(`   ❌ ${dep}: NO instalado`);
    }
}

// ✅ 6. Verificar display virtual
console.log('\n🖥️ VERIFICANDO DISPLAY...');
const display = process.env.DISPLAY || 'NO CONFIGURADO';
console.log(`   Display: ${display}`);

if (display === 'NO CONFIGURADO') {
    console.log('   ⚠️ DISPLAY no configurado, configurando...');
    process.env.DISPLAY = ':99';
    console.log('   ✅ DISPLAY configurado como :99');
}

// ✅ 7. Test básico de Chrome
console.log('\n🧪 PROBANDO CHROME...');
try {
    const testCommand = `${foundChrome} --headless --disable-gpu --no-sandbox --disable-dev-shm-usage --dump-dom "data:text/html,<h1>Test</h1>" 2>/dev/null`;
    const result = execSync(testCommand, { encoding: 'utf8', timeout: 10000 });
    
    if (result.includes('<h1>Test</h1>')) {
        console.log('   ✅ Chrome funciona correctamente');
    } else {
        console.log('   ⚠️ Chrome responde pero con problemas');
        console.log(`   Resultado: ${result.substring(0, 100)}...`);
    }
} catch (error) {
    console.log(`   ❌ Chrome NO funciona: ${error.message}`);
}

// ✅ 8. Test de Puppeteer
console.log('\n🎭 PROBANDO PUPPETEER...');
async function testPuppeteer() {
    try {
        const puppeteer = require('puppeteer');
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            executablePath: foundChrome,
            timeout: 30000
        });

        const page = await browser.newPage();
        await page.goto('data:text/html,<h1>Puppeteer Test</h1>');
        const title = await page.$eval('h1', el => el.textContent);
        await browser.close();

        if (title === 'Puppeteer Test') {
            console.log('   ✅ Puppeteer funciona correctamente');
            return true;
        } else {
            console.log('   ❌ Puppeteer no funciona correctamente');
            return false;
        }
    } catch (error) {
        console.log(`   ❌ Error en Puppeteer: ${error.message}`);
        return false;
    }
}

// ✅ 9. Test de generación PDF
console.log('\n📄 PROBANDO GENERACIÓN DE PDF...');
async function testPDF() {
    try {
        const puppeteer = require('puppeteer');
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            executablePath: foundChrome,
            timeout: 30000
        });

        const page = await browser.newPage();
        await page.setContent('<html><body><h1>PDF Test</h1><p>Fecha: ' + new Date().toISOString() + '</p></body></html>');
        const pdf = await page.pdf({ format: 'A4' });
        await browser.close();

        console.log(`   ✅ PDF generado correctamente (${pdf.length} bytes)`);
        
        // ✅ Guardar PDF de prueba
        fs.writeFileSync('/tmp/test-chrome.pdf', pdf);
        console.log('   ✅ PDF guardado en: /tmp/test-chrome.pdf');
        
        return true;
    } catch (error) {
        console.log(`   ❌ Error generando PDF: ${error.message}`);
        return false;
    }
}

// ✅ Ejecutar tests
(async () => {
    const puppeteerWorks = await testPuppeteer();
    const pdfWorks = await testPDF();

    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMEN DEL DIAGNÓSTICO');
    console.log('='.repeat(50));
    console.log(`Chrome encontrado: ${foundChrome ? '✅' : '❌'}`);
    console.log(`Puppeteer funciona: ${puppeteerWorks ? '✅' : '❌'}`);
    console.log(`PDF funciona: ${pdfWorks ? '✅' : '❌'}`);

    if (puppeteerWorks && pdfWorks) {
        console.log('\n🎉 ¡TODO FUNCIONA CORRECTAMENTE!');
        console.log('Tu aplicación debería poder generar PDFs sin problemas.');
    } else {
        console.log('\n❌ HAY PROBLEMAS QUE RESOLVER');
        console.log('Ejecuta: bash install-chrome-vps.sh');
        console.log('O revisa los logs de errores arriba.');
    }
})().catch(console.error);