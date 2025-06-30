#!/bin/bash

# Script para instalar dependencias de Puppeteer en Railway/Docker

echo "🚀 Instalando dependencias de Puppeteer..."

# Actualizar paquetes del sistema
echo "📦 Actualizando paquetes del sistema..."
apt-get update

# Instalar dependencias necesarias para Puppeteer
echo "🔧 Instalando dependencias de Chrome/Chromium..."
apt-get install -y \
  chromium-browser \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  ca-certificates \
  fonts-liberation \
  libappindicator1 \
  libnss3 \
  lsb-release \
  xdg-utils \
  wget

# Instalar Chrome vía Puppeteer
echo "🦾 Instalando Chrome via Puppeteer..."
npx puppeteer browsers install chrome

# Verificar instalación
echo "✅ Verificando instalación..."
which chromium-browser
npx puppeteer browsers list

echo "🎉 Instalación completada!"

# Configurar variables de entorno
export PUPPETEER_EXECUTABLE_PATH=$(which chromium-browser)
echo "📝 PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_EXECUTABLE_PATH"