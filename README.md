# ERP Distri — Backend

API REST para el sistema ERP de una distribuidora. Gestiona ventas, pedidos, inventario, compras, finanzas, clientes, proveedores, empleados e integración fiscal con ARCA/AFIP.

---

## Tecnologías

| Tecnología | Uso |
|---|---|
| **Node.js ≥18** | Runtime |
| **Express 4** | Framework HTTP |
| **MySQL 2** | Base de datos relacional |
| **JWT (jsonwebtoken)** | Autenticación stateless |
| **bcryptjs** | Hash de contraseñas |
| **Puppeteer** | Generación de PDFs (comprobantes, remitos) |
| **pdf-lib** | Manipulación de PDFs (sellos, firmas) |
| **multer** | Upload de archivos |
| **express-rate-limit** | Protección contra abuso de endpoints |
| **Discord Webhook** | Resumen diario automático por Discord |

---

## Arquitectura

```
routes/ → controllers/ → services/ → DB (MySQL2)
```

- **Routes** — Definen los endpoints y aplican middlewares de auth/auditoría.
- **Controllers** — Validan la request y delegan en services.
- **Services** — Contienen toda la lógica de negocio y acceso a la base de datos.
- **Middlewares** — `authMiddleware` (verifica JWT), `auditoriaMiddleware` (registra operaciones críticas), `metricsMiddleware`, `errorHandler` (respuestas de error normalizadas).

---

## Módulos principales

### Ventas (`ventasRoutes.js` / `ventasService.js`)
- Registro de ventas directas con verificación de stock transaccional.
- Protección contra duplicados via hash idempotente de venta.
- Rollback automático de stock si falla cualquier paso de la transacción.
- Generación de número de comprobante y CAE (ARCA/AFIP).

### Pedidos (`pedidosRoutes.js` / `pedidosService.js`)
- Registro, edición y cambio de estado de pedidos.
- Descuento de stock al confirmar pedido; restauración de stock al anular.
- Detección de pedidos duplicados por hash.
- Paginación eficiente de historial.

### Productos (`productosRoutes.js` / `productosService.js`)
- ABM de productos con categorías y stock.
- Ajuste manual de stock con registro en `movimiento_stock`.
- Índices de rendimiento en columnas de búsqueda frecuente.

### Compras (`comprasRoutes.js` / `comprasService.js`)
- Registro de compras con actualización de stock.
- Historial de compras y gastos operativos.

### Finanzas (`finanzasRoutes.js` / `finanzasService.js`)
- Gestión de cuentas (efectivo, banco, cuenta corriente).
- Registro de ingresos, egresos y transferencias entre cuentas.
- Reportes de rentabilidad por período y cuenta.

### Personas (`personasRouter.js` / `personasService.js`)
- ABM de clientes con datos fiscales (CUIT/DNI, condición IVA, validación AFIP Padrón).
- ABM de proveedores y empleados.

### ARCA / AFIP (`arcaRoutes.js` / `arcaIntegrationController.js`)
- Integración con ARCA para solicitud de CAE (Factura B, Factura C).
- Microservicio interno (`arca-microservice/`) que encapsula la comunicación con los WS de AFIP.
- Soporte para homologación y producción.

### Comprobantes (`comprobantesRoutes.js`)
- Generación de comprobantes PDF con Puppeteer.
- Links públicos de comprobante por token firmado (sin autenticación requerida).

### Auditoría (`auditoriaRoutes.js`)
- Log inmutable de operaciones críticas: quién, qué, cuándo.

### Notas (`notasRoutes.js`)
- Notas vinculadas a pedidos o ventas.

---

## Autenticación y roles

- Access token JWT de corta duración + refresh token de larga duración.
- Roles: `GERENTE` y `VENDEDOR`. Los endpoints sensibles validan el rol en el middleware.
- Refresh token rotado en cada uso (`authController.js`).

---

## Integración Discord

El script `scripts/discord-resumen-diario.js` envía un resumen diario automático (ventas, ingresos, stock bajo) al canal de Discord configurado.

```bash
npm run discord-resumen
```

---

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DB_HOST` | Host MySQL |
| `DB_USER` | Usuario MySQL |
| `DB_PASSWORD` | Contraseña MySQL |
| `DB_NAME` | Nombre de la base de datos |
| `JWT_SECRET` | Secreto para firmar access tokens |
| `JWT_REFRESH_SECRET` | Secreto para firmar refresh tokens |
| `DISCORD_WEBHOOK_URL` | URL del webhook de Discord (resumen diario) |
| `ARCA_*` | Configuración de certificados y CUIT para ARCA/AFIP |
| `PORT` | Puerto del servidor (default: 3001) |

---

## Comandos

```bash
npm install        # Instalar dependencias
npm run dev        # Desarrollo con nodemon
npm start          # Producción
npm test           # Suite completa de tests
npm run test:arca-homo   # Smoke test contra AFIP homologación
```

---

## Base de datos

La base de datos está en MySQL. El esquema completo está en `estructura.sql` (raíz del proyecto). Las migraciones incrementales se encuentran en `backend/scripts/*.sql`.

Tablas principales:
- `usuarios`, `clientes`, `proveedores`, `empleados`
- `productos`, `categorias`, `movimiento_stock`
- `pedidos`, `pedidos_cont` (detalle), `ventas_cont` (detalle venta directa)
- `compras`, `compras_cont`
- `facturas`, `detalle_remitos`, `notas`
- `cuentas_fondos`, `ingresos`, `egresos`, `transferencias`
- `auditoria_log`

---

## Despliegue

Alojado en **Hostinger VPS** con Node.js como proceso persistente (PM2 o similar).

```bash
npm start          # Inicia el servidor en el puerto configurado
```
