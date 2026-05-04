# Validación AFIP de clientes (padrón y constancia de inscripción)

Este documento describe el flujo de validación de contribuyentes contra AFIP/ARCA al crear o editar clientes en el ERP.

## Resumen

- **Por CUIT/CUIL (11 dígitos):** se consulta directamente el padrón **Constancia de Inscripción** (`ws_sr_constancia_inscripcion`) y se obtienen nombre, condición IVA, domicilio, etc.
- **Por DNI (7 u 8 dígitos):** se consulta primero el **Padrón Alcance 13** (`ws_sr_padron_a13`) con `getIdPersonaListByDocumento` para obtener el CUIT; luego se consulta Constancia de Inscripción con ese CUIT.
- Los datos devueltos se usan para autocompletar el formulario de cliente (nombre, condición IVA, CUIT, DNI, dirección, ciudad, provincia). La condición fiscal se determina así: Monotributo, Responsable Inscripto o Consumidor Final si no está en padrón.

## Variables de entorno necesarias

En `.env` del backend (compartido con `arca-microservice`):

- `AFIP_ACCESS_TOKEN`: token de Afip SDK (obtenido en https://app.afipsdk.com/).
- `AFIP_CUIT`: CUIT de la empresa (11 dígitos).
- **Para consulta padrón/constancia** (y para que el SDK pueda obtener token/sign): `AFIP_CERT_PATH` y `AFIP_KEY_PATH` con las rutas al certificado y clave privada (.crt y .key). Sin ellos la API de Afip SDK puede devolver error "Certificado/Key obligatorios".
- Opcional: `AFIP_PRODUCTION=true` para producción; si no, se usa homologación (`dev`).

## Endpoints

### POST `/personas/consulta-afip`

- **Auth:** requiere empleado logueado.
- **Body:** `{ "cuit": "20123456789" }` **o** `{ "dni": "12345678" }` (solo uno).
- **Respuesta exitosa:** `{ success: true, data: { nombre, cuit, dni, condicion_iva, direccion, ciudad, provincia } }`.
- **Límite:** 60 solicitudes por IP cada 15 minutos (rate limit).

## Cómo probar

1. Tener configurados `AFIP_ACCESS_TOKEN` y `AFIP_CUIT` en `.env`.
2. En homologación, algunos CUIT/DNI de prueba están disponibles (ver documentación de Afip SDK).
3. Desde la UI: en cualquier formulario de crear/editar cliente, ingresar CUIT (11 dígitos) o DNI (7 u 8) y hacer clic en **Validar con AFIP**. Los campos se completan con los datos devueltos.
4. Con curl (reemplazar `TOKEN` y opcionalmente el body):

```bash
curl -X POST http://localhost:3001/personas/consulta-afip \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"cuit":"20123456789"}'
```

## Archivos principales

- **arca-microservice (AFIP/ARCA):** `services/afip.service.js` (getCuitPorDni, getDatosConstancia, mapConstanciaToCliente), `controllers/billing.controller.js` (consultaContribuyente). Toda la interacción con el SDK de AFIP (facturación CAE y consulta padrón) está en esta carpeta.
- **Backend:** `controllers/personasController.js` (consultaAfip delega en el microservicio; nuevoCliente, actualizarCliente), `utils/validadoresCliente.js` (validación CUIT/DNI), `routes/personasRouter.js`.
- **Frontend:** `hooks/useClientes.js` (consultarContribuyenteAfip, validarDatosCliente), formularios de cliente que usan el botón "Validar con AFIP".
- **Migración:** `scripts/add_validado_afip_at_clientes.sql` (campo `validado_afip_at` en `clientes`).

## Validaciones al guardar cliente

- CUIT: 11 dígitos y dígito verificador válido (módulo 11).
- DNI: 7 u 8 dígitos numéricos.
- Para Monotributo o Responsable Inscripto el CUIT es obligatorio.
- Al solicitar CAE para facturas tipo A o B, el cliente de la venta debe tener CUIT válido; si no, el backend rechaza la solicitud con un mensaje claro.
