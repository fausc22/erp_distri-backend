# Producción: `@arcasdk/core`

Checklist para el primer día con ARCA en producción (sin `app.afipsdk.com`).

1. **Certificados**: `AFIP_CERT_PATH` / `AFIP_KEY_PATH` apuntando a `cert_prod.crt` / `cert_prod.key` (PEM).
2. **Entorno**: `AFIP_PRODUCTION=true` (o `NODE_ENV=production` según política del servidor).
3. **Token**: `AFIP_ACCESS_TOKEN` debe permanecer comentado (no se usa con `@arcasdk/core`).
4. **Tickets WSAA**: el proceso debe poder escribir en `backend/storage/arca-tickets/` (se crea al arrancar).
5. **Monitoreo día 1**: logs de creación de comprobante, rechazos ARCA, webhooks Discord ARCA/AFIP, métricas de error 5xx en el microservicio.
6. **Rollback rápido**: renombrar `services/afip.service.backup.js` → `services/afip.service.js`, restaurar `AFIP_ACCESS_TOKEN` en `.env`, `npm install` si hiciera falta, reiniciar proceso.
