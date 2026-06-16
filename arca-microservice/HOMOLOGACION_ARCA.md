# Homologación ARCA (`@arcasdk/core`)

Checklist alineado al plan de migración. Ejecutar con `AFIP_PRODUCTION=false` y certificados de homologación.

## Automático (humo)

Desde `backend/`:

```bash
npm run test:arca-homo
# o: node arca-microservice/scripts/smoke-arca-homo.mjs
```

Cubre: **FEDummy**, **último comprobante B**, intento de **puntos de venta** (si el WS falla en homologación, se usa el fallback dev `{ PtoVta: 1 }` como antes), e intento de **constancia** con el CUIT del `.env` (requiere que el certificado tenga el servicio de constancia habilitado en AFIP; si no, verás `notAuthorized` en WSAA).

Opcional: `TEST_DNI=12345678 node arca-microservice/scripts/smoke-arca-homo.mjs` para probar padrón A13 (mismos requisitos de alcance en el certificado).

## Manual (12 escenarios)

1. FEDummy — incluido en el script (`verificarEstadoServidor`).
2. `FECompUltimoAutorizado` — incluido en el script (`obtenerUltimoComprobante`).
3. Factura B consumidor final sin DNI — vía flujo ERP / `billing.service`.
4. Factura B consumidor final con DNI.
5. Factura A responsable inscripto.
6. Factura B exento.
7. Nota de crédito A (con comprobante asociado).
8. Nota de crédito B.
9. Nota de débito A.
10. Nota de débito B.
11. Padrón por DNI — `GET/POST consulta-contribuyente` con `dni`.
12. Constancia por CUIT — mismo endpoint con `cuit` (11 dígitos).

Registrar CAE, observaciones y número de comprobante en cada caso.
