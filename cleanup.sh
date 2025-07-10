#!/bin/bash

# Script de limpieza completa para VPS - eliminar Puppeteer y dependencias

echo "🧹 Iniciando limpieza completa del servidor VPS..."

# 1. Detener la aplicación
echo "🛑 Deteniendo aplicación..."
pm2 stop all
pm2 delete all

# 2. Navegar al directorio del proyecto
cd /opt/distri-api

# 3. Backup del .env y archivos importantes
echo "💾 Creando backup de archivos importantes..."
cp .env .env.backup
cp -r storage storage_backup 2>/dev/null || true
cp -r resources resources_backup 2>/dev/null || true

# 4. Eliminar node_modules completamente
echo "🗑️ Eliminando node_modules..."
rm -rf node_modules/
rm -rf package-lock.json

# 5. Eliminar cachés de npm y yarn
echo "🧽 Limpiando cachés..."
npm cache clean --force
rm -rf ~/.npm
rm -rf ~/.cache/yarn 2>/dev/null || true

# 6. Eliminar directorios de Puppeteer si existen
echo "🔍 Eliminando restos de Puppeteer..."
rm -rf ~/.cache/puppeteer
rm -rf ~/.local-chromium
rm -rf /tmp/.puppeteer*
find /opt/distri-api -name "*puppeteer*" -type d -exec rm -rf {} + 2>/dev/null || true
find /opt/distri-api -name "*chromium*" -type d -exec rm -rf {} + 2>/dev/null || true

# 7. Actualizar el sistema y limpiar paquetes huérfanos
echo "🔄 Actualizando sistema..."
apt update
apt autoremove -y
apt autoclean

# 8. Eliminar dependencias de Chromium/Puppeteer si fueron instaladas
echo "🗑️ Eliminando dependencias de navegador..."
apt remove --purge -y chromium-browser chromium-browser-l10n 2>/dev/null || true
apt remove --purge -y google-chrome-stable 2>/dev/null || true
apt autoremove -y

echo "✅ Limpieza completada. Ahora puedes instalar el nuevo package.json"
echo "📝 Recuerda:"
echo "   1. Subir el nuevo package.json sin html-pdf-node y puppeteer"
echo "   2. Ejecutar: npm install"
echo "   3. Reiniciar con: pm2 start server.js --name distri-api"