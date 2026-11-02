# Reportes financieros v2

Servicio exclusivo de `/finanzas/reportes`. No modifica el circuito de ventas ni los endpoints previos. No requiere migraciones ni escrituras sobre datos de negocio.

## Contrato

- `GET /finanzas/reportes-v2?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`: exige gerente; rechaza otros filtros para evitar egresos globales contra ventas parciales. Máximo seis años.
- `GET /finanzas/reportes-v2/:snapshotId/pdf`: exige el mismo usuario gerente que creó la versión. No recibe importes del navegador ni vuelve a calcular datos. Versión inexistente, expirada o ajena: HTTP 410.
- Dinero: cadenas decimales de dos posiciones. Cálculos internos con `BigInt` en centavos. Cantidades de BD en décimos, agrupadas por producto/unidad.
- `resumen.total = normal + flete + pendiente`. Una clasificación pendiente conserva el documento y su importe. Cantidad pendiente determina la integridad, incluso si sus importes se compensan a cero.
- Una fila por cabecera; factura y ND suman, NC resta. Estado Facturada; tipos FACTURA, NOTA_DEBITO y NOTA_CREDITO. Estado/tipo se normalizan. Fecha fiscal con fallback a fecha comercial.
- Importes finales de `ventas.total`, neto e IVA guardados. No se reconstruyen desde precio × cantidad. La diferencia contra líneas se muestra sin distribuirla artificialmente.
- Flete: toda factura que contiene una línea FLETE, incluidas mixtas. Las notas sin línea FLETE heredan la clasificación del documento referenciado si su detalle es identificable. Si no se puede determinar, quedan pendientes. No se clasifica por vendedor; un vendedor distinto de Martín genera control.
- Vendedor: ID; notas con referencia se imputan al vendedor de esa referencia. Notas sin referencia conservan emisor y generan alerta. Nombres se muestran como etiquetas.
- Ticket: solo facturas, promedio final. ND/NC tienen conteos propios. No se mezclan denominadores.
- Agregados de todas las ciudades/productos, sin LIMIT. Participaciones sobre facturación neta global; si no es positiva, no disponibles. Devoluciones no se descartan.
- Comparación con período anterior de igual cantidad de días. Si el período seleccionado aún no cerró en Argentina, no se afirma diferencia/porcentaje comparable.
- Ganancias y saldos reales: `null`, con explicación; no hay costos históricos ni saldo inicial certificado. Diferencia de facturación menos compras/gastos y variación de caja se nombran explícitamente.
- Compras elegibles Registrada/Confirmada. Transferencias de fondos separadas de ingresos/egresos externos.
- Conciliación reproduce criterios de los listados actuales sin cambiarlos: A/B fiscal para IVA; base comercial subtotal A/B y total otras letras por fecha comercial, estado Facturada/Facturado y vendedor referenciado para notas. Incluye indicadores booleanos de pertenencia para distinguir cero de exclusión.

## Arquitectura

`repository.js`: una conexión InnoDB, REPEATABLE READ, transacción READ ONLY con snapshot consistente; día final completo. Consultas parametrizadas. `buildReport.js`: transformación pura e invariantes de cierre. `money.js`: precisión exacta. `controller.js`: autorización a través de rutas, HTTP y coordinación. `snapshots.js`: almacenamiento temporal por propietario. `pdf.js`: HTML escapado y Chromium sin acceso a recursos externos. Frontend independiente en `FinancialReportsV2.jsx`, dentro de la ruta existente.

El corte registrado es el inicio de la lectura consistente. La conciliación aritmética no certifica autorización fiscal ni ausencia de errores en la fuente. Diferencias de cabecera/líneas de hasta $1 se marcan informativas, sin redondear ni eliminarlas; las restantes se priorizan para revisión. El PDF muestra hasta 50 excepciones y 10 ciudades/productos, con límites explícitos; los totales y la pantalla son completos.

## Memoria y operación

Snapshots: 30 minutos, máximo 50 entradas y 64 MiB de JSON. Las entradas antiguas pueden desalojarse antes por capacidad. Reiniciar backend invalida versiones. UI recibe 410, pide nueva lectura y solicita revisar el nuevo corte antes de volver a descargar.

El despliegue actual configura una instancia en `ecosystem.config.mjs`. Este store es por proceso: antes de escalar a varias instancias se requiere afinidad de sesión o store compartido. No copiar archivos de snapshot al navegador ni aceptar datos financieros enviados por el cliente para renderizar PDFs.

No se agregó dependencia productiva: mysql2, Puppeteer y componentes UI ya existían. Chromium puede configurarse con PUPPETEER_EXECUTABLE_PATH; se detectan rutas habituales. No se agregó índice: EXPLAIN y tiempos de la copia existente no lo justificaron para su volumen.

## Activación y reversión

1. Publicar backend con las nuevas rutas conservando todas las anteriores.
2. Construir/publicar frontend con `NEXT_PUBLIC_REPORTES_V2` ausente o `true`.
3. Revisar períodos cerrados y período actual, pendientes, conciliación A/B/comercial, detalles y descarga PDF contra datos vigentes.
4. Reversión de interfaz: `NEXT_PUBLIC_REPORTES_V2=false` y reconstruir/publicar frontend. No requiere rollback de BD. La vista anterior conserva sus limitaciones conocidas; usar reversión solo como contingencia.

La implementación local no publica cambios automáticamente. Validación final del 02/11/2026: DATA_NOV2026.sql con datos reales, 6.099 comprobantes en 17 meses (julio de 2025 a noviembre de 2026), conciliados con SQL independiente por importe y clasificación, libro IVA, listado comercial, compras, gastos y caja. Octubre conserva una NC sin referencia (ID 6105, 0004-00020, -$8.585) como pendiente; no se alteró el documento de origen. Noviembre parcial suma $4.791.880, sin fletes ni pendientes en la copia. Evidencia agregada en VALIDACION_NOV2026.md, junto a este archivo.

## Pruebas

Desde backend:

```sh
npm run test:reportes
REPORTES_TEST_SOCKET=/tmp/erp-reportes-mysql/mysql.sock REPORTES_PDF_TEST=1 npm run test:reportes
REPORTES_UI_URL=http://127.0.0.1:3107 npm run test:reportes-ui
REPORTES_COPY_DATABASE=erp_reportes_nov2026 REPORTES_TEST_SOCKET=/tmp/erp-reportes-mysql/mysql.sock node tests/reportesV2.copy-check.js
```

Las pruebas de MySQL exigen una instancia desechable con socket bajo `/tmp/erp-reportes-mysql/` y BD `erp_reportes_test` creada desde DB_NOV2026.sql. Borran únicamente los fixtures de esa BD explícita. No cargan .env. La conciliación hace solo lecturas y acepta únicamente `erp_reportes_copy` (histórico) o `erp_reportes_nov2026` (exportación actual), mediante REPORTES_COPY_DATABASE. Recorre todos los meses con comprobantes y rechaza copias vacías. No apuntar estas bases a un servidor compartido.

Las pruebas UI requieren Next local, por ejemplo `NEXT_PUBLIC_API_URL=http://127.0.0.1:3199 next dev -p 3107`. Interceptan toda petición externa; los datos de pantalla son sintéticos. La integración MySQL/HTTP/PDF prueba que una modificación posterior a la consulta no modifica las cifras del PDF.

La suite general termina correctamente con DOTENV_CONFIG_PATH=/dev/null DB_HOST vacío y SKIP_PDF_GENERATE=1. Se corrigió exclusivamente el test de orden estable para tolerar saltos de línea SQL, sin modificar finanzasService.js. Dos comprobaciones heredadas que requieren DB_HOST omiten consultas para evitar una conexión configurada; el nuevo servicio sí se prueba en MySQL aislado. El PDF heredado se omite; el PDF nuevo se renderiza realmente.
