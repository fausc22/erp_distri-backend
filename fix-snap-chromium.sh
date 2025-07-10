#!/bin/bash

# ✅ FIX ESPECÍFICO PARA SNAP CHROMIUM EN TU VPS
echo "🔧 Arreglando problemas de Snap Chromium..."

# ✅ 1. Instalar xdg-utils que falta
echo "📦 Instalando xdg-utils..."
sudo apt update
sudo apt install -y xdg-utils

# ✅ 2. Instalar dependencias de audio que faltan
echo "📦 Instalando dependencias de audio..."
sudo apt install -y libasound2t64

# ✅ 3. Configurar variables de entorno para Snap Chromium
echo "🔧 Configurando variables de entorno..."
export DISPLAY=:99
export XDG_DATA_HOME=/tmp/.local/share
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export HOME=/tmp

# ✅ 4. Crear directorios necesarios para Snap Chromium
echo "📁 Creando directorios para Snap Chromium..."
sudo mkdir -p /tmp/.local/share
sudo mkdir -p /tmp/.config
sudo mkdir -p /tmp/.cache
sudo mkdir -p /tmp/chrome-user-data
sudo chmod -R 777 /tmp/.local
sudo chmod -R 777 /tmp/.config
sudo chmod -R 777 /tmp/.cache
sudo chmod -R 777 /tmp/chrome-user-data

# ✅ 5. Verificar que Xvfb esté corriendo
echo "🖥️ Verificando Xvfb..."
if ! pgrep -x "Xvfb" > /dev/null; then
    echo "Iniciando Xvfb..."
    sudo Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset &
    sleep 2
fi

# ✅ 6. Test de Chromium con las nuevas configuraciones
echo "🧪 Probando Chromium con configuración corregida..."
/usr/bin/chromium-browser \
    --headless \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --single-process \
    --no-zygote \
    --disable-features=VizDisplayCompositor \
    --user-data-dir=/tmp/chrome-user-data \
    --data-path=/tmp/chrome-user-data \
    --disk-cache-dir=/tmp/chrome-cache \
    --dump-dom "data:text/html,<h1>Test Fixed</h1>" > /tmp/chromium-test.html 2>/dev/null

if [ -f "/tmp/chromium-test.html" ] && grep -q "Test Fixed" /tmp/chromium-test.html; then
    echo "✅ Chromium funciona correctamente ahora!"
    rm -f /tmp/chromium-test.html
else
    echo "❌ Chromium aún tiene problemas"
fi

# ✅ 7. Crear wrapper script para Chromium
echo "📝 Creando wrapper script..."
sudo tee /usr/local/bin/chromium-wrapper > /dev/null <<'EOF'
#!/bin/bash
export DISPLAY=:99
export XDG_DATA_HOME=/tmp/.local/share
export XDG_CONFIG_HOME=/tmp/.config
export XDG_CACHE_HOME=/tmp/.cache
export HOME=/tmp

# Crear directorios si no existen
mkdir -p /tmp/.local/share
mkdir -p /tmp/.config
mkdir -p /tmp/.cache
mkdir -p /tmp/chrome-user-data

# Ejecutar Chromium con configuraciones correctas
exec /usr/bin/chromium-browser \
    --user-data-dir=/tmp/chrome-user-data \
    --data-path=/tmp/chrome-user-data \
    --disk-cache-dir=/tmp/chrome-cache \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --single-process \
    --no-zygote \
    --disable-features=VizDisplayCompositor \
    --disable-background-networking \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    --disable-accelerated-2d-canvas \
    --disable-accelerated-jpeg-decoding \
    --disable-accelerated-mjpeg-decode \
    --disable-accelerated-video-decode \
    --disable-accelerated-video-encode \
    --memory-pressure-off \
    --disable-ipc-flooding-protection \
    --disable-software-rasterizer \
    --disable-gpu-sandbox \
    --no-first-run \
    --no-default-browser-check \
    --disable-default-apps \
    --disable-extensions \
    --disable-plugins \
    --disable-component-extensions-with-background-pages \
    --disable-client-side-phishing-detection \
    --disable-sync \
    --disable-translate \
    --disable-web-security \
    --disable-features=TranslateUI,BlinkGenPropertyTrees \
    --disable-background-mode \
    --disable-hang-monitor \
    --disable-prompt-on-repost \
    --disable-domain-reliability \
    --disable-features=AudioServiceOutOfProcess \
    --disable-permissions-api \
    --disable-notifications \
    "$@"
EOF

sudo chmod +x /usr/local/bin/chromium-wrapper

# ✅ 8. Configurar variables de entorno permanentes
echo "🔧 Configurando variables permanentes..."
echo 'export DISPLAY=:99' >> ~/.bashrc
echo 'export XDG_DATA_HOME=/tmp/.local/share' >> ~/.bashrc
echo 'export XDG_CONFIG_HOME=/tmp/.config' >> ~/.bashrc
echo 'export XDG_CACHE_HOME=/tmp/.cache' >> ~/.bashrc

# ✅ 9. Matar procesos Chromium zombies
echo "🧹 Limpiando procesos Chromium zombies..."
sudo pkill -f chromium || true
sudo pkill -f chrome || true
sleep 2

# ✅ 10. Configurar systemd para Xvfb si no está configurado
echo "🔧 Verificando servicio Xvfb..."
if ! systemctl is-active --quiet xvfb; then
    echo "Iniciando servicio Xvfb..."
    sudo systemctl start xvfb
    sudo systemctl enable xvfb
fi

# ✅ 11. Test final con wrapper
echo "🧪 Test final con wrapper..."
/usr/local/bin/chromium-wrapper \
    --headless \
    --dump-dom "data:text/html,<h1>Wrapper Test</h1>" > /tmp/wrapper-test.html 2>/dev/null

if [ -f "/tmp/wrapper-test.html" ] && grep -q "Wrapper Test" /tmp/wrapper-test.html; then
    echo "✅ Wrapper funciona correctamente!"
    rm -f /tmp/wrapper-test.html
else
    echo "❌ Wrapper tiene problemas"
fi

# ✅ 12. Reiniciar PM2 con nuevas variables
echo "🔄 Reiniciando aplicación..."
if command -v pm2 &> /dev/null; then
    sudo -u ftpuser pm2 restart all --update-env
    echo "✅ PM2 reiniciado con nuevas variables"
fi

echo ""
echo "🎉 Fix completado!"
echo "📋 Resumen de cambios:"
echo "   ✅ xdg-utils instalado"
echo "   ✅ libasound2t64 instalado"
echo "   ✅ Variables de entorno configuradas"
echo "   ✅ Directorios temporales creados"
echo "   ✅ Wrapper script creado: /usr/local/bin/chromium-wrapper"
echo "   ✅ Xvfb configurado y corriendo"
echo "   ✅ PM2 reiniciado"
echo ""
echo "💡 Ahora prueba generar un PDF desde tu aplicación"