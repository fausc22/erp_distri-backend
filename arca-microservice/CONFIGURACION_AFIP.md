# 🔐 Configuración del Microservicio ARCA/AFIP

Este documento te guiará en la configuración del microservicio de facturación electrónica con AFIP.

## 📋 Requisitos Previos

1. **CUIT registrado en AFIP**
2. **Certificado Digital AFIP** (archivo `.crt`)
3. **Clave Privada** (archivo `.key`)
4. **Punto de Venta habilitado** en AFIP para facturación electrónica

---

## 🔑 Paso 1: Obtener Certificado Digital de AFIP

### Opción A: Ambiente de Homologación (Testing) ✅ RECOMENDADO PARA EMPEZAR

1. Visita: https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado.asp
2. Selecciona **"Homologación"** 
3. Genera un certificado de prueba con tu CUIT
4. Descarga el archivo `.crt` (certificado) y `.key` (clave privada)
5. Colócalos en: `/backend/arca-microservice/certs/`

### Opción B: Ambiente de Producción ⚠️ SOLO PARA PRODUCCIÓN REAL

1. Visita: https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado.asp
2. Selecciona **"Producción"**
3. Sigue los pasos oficiales de AFIP (requiere Token y clave fiscal)
4. Descarga los archivos y colócalos en `/backend/arca-microservice/certs/`

---

## ⚙️ Paso 2: Configurar Variables de Entorno

Crea o edita el archivo `/backend/.env` con las siguientes variables:

```env
# ==============================================
# CONFIGURACIÓN DE AFIP/ARCA
# ==============================================

# CUIT de la empresa (11 dígitos sin guiones ni puntos)
AFIP_CUIT=20123456789

# Rutas a los certificados (relativas desde /backend)
AFIP_CERT_PATH=./arca-microservice/certs/certificado.crt
AFIP_KEY_PATH=./arca-microservice/certs/privada.key

# Punto de venta (número de 1 a 9999)
DEFAULT_PUNTO_VENTA=1

# Datos de la empresa
EMPRESA_RAZON_SOCIAL=Mi Empresa SRL
EMPRESA_DOMICILIO=Av. Ejemplo 123, CABA
EMPRESA_CONDICION_IVA=Responsable Inscripto
EMPRESA_INICIO_ACTIVIDADES=01/01/2020

# Ambiente: 'dev' para testing, 'prod' para producción
NODE_ENV=dev
```

---

## 📁 Paso 3: Estructura de Archivos de Certificados

Tu carpeta `certs/` debe quedar así:

```
/backend/arca-microservice/certs/
├── README.md
├── certificado.crt    ← Tu certificado AFIP
└── privada.key        ← Tu clave privada
```

⚠️ **IMPORTANTE**: 
- Nunca subas estos archivos a Git
- Mantén la clave privada segura
- Usa permisos restrictivos: `chmod 600 privada.key`

---

## 🧪 Paso 4: Probar la Configuración

### Desde el backend:

```bash
cd /backend
npm start
```

### Probar el health check de ARCA:

```bash
curl http://localhost:3001/arca/health
```

Deberías ver una respuesta como:

```json
{
  "success": true,
  "message": "Servicio ARCA operativo",
  "data": {
    "estado": "OK",
    "servidor": {
      "appserver": "OK",
      "dbserver": "OK",
      "authserver": "OK"
    },
    "ambiente": "dev",
    "cuit": "20123456789"
  }
}
```

---

## 🚀 Paso 5: Solicitar un CAE

### Desde el frontend o Postman:

```http
POST http://localhost:3001/arca/solicitar-cae
Content-Type: application/json
Authorization: Bearer <tu_token_jwt>

{
  "ventaId": 123
}
```

### Respuesta exitosa:

```json
{
  "success": true,
  "message": "CAE obtenido y guardado exitosamente",
  "data": {
    "ventaId": 123,
    "autorizacion": {
      "cae": "70123456789012",
      "fechaVencimiento": "20250116",
      "resultado": "A"
    },
    "comprobante": {
      "numero": 123,
      "puntoVenta": 1,
      "tipo": 6
    }
  }
}
```

---

## 🔧 Solución de Problemas Comunes

### Error: "Certificado no encontrado"
- Verifica que las rutas en `.env` sean correctas
- Verifica que los archivos existan en `/backend/arca-microservice/certs/`

### Error: "CUIT inválido"
- Verifica que el CUIT tenga 11 dígitos
- Verifica que el CUIT en `.env` coincida con el del certificado

### Error: "Error al conectar con WSAA"
- Verifica tu conexión a internet
- En homologación, usa las URLs de testing de AFIP
- En producción, verifica que el certificado sea de producción

### Error: "Ticket expirado"
- El ticket de AFIP dura 12 horas
- Se renueva automáticamente
- Si persiste, reinicia el servidor

### Error: "Servicio ARCA no disponible"
- El microservicio está cargando de forma asíncrona
- Espera unos segundos y vuelve a intentar
- Verifica los logs del servidor

---

## 📚 Recursos Útiles

- **Manual de AFIP WSFEv1**: https://www.afip.gob.ar/ws/documentacion/ws-facturacion.asp
- **Tipos de Comprobantes**: Factura A (1), Factura B (6), Factura C (11)
- **Condiciones IVA**: RI (1), Monotributo (6), Consumidor Final (5), Exento (4)
- **Obtener Certificado**: https://www.afip.gob.ar/ws/WSAA/wsaa_obtener_certificado.asp

---

## 🔐 Seguridad

✅ **Hacer:**
- Usar ambiente de homologación para desarrollo
- Mantener la clave privada segura
- Usar variables de entorno para configuración sensible
- Renovar certificados antes de su vencimiento

❌ **No hacer:**
- Subir certificados a Git
- Compartir la clave privada
- Usar certificados de producción en desarrollo
- Hardcodear credenciales en el código

---

## 📞 Soporte

Si necesitas ayuda:
1. Revisa los logs del servidor: `tail -f /backend/logs/server.log`
2. Verifica el health check: `curl http://localhost:3001/arca/health`
3. Consulta la documentación oficial de AFIP
4. Revisa el archivo `/backend/arca-microservice/COMO_OBTENER_ACCESS_TOKEN.md`

---

✅ **Tu microservicio ARCA está listo para facturar electrónicamente!**

