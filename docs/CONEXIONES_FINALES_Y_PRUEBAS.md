# Conexiones finales y pruebas previas a producción

Fecha: 2026-11-03. Estado: implementación local probada; falta homologación real y aceptación manual del negocio. No se desplegó ni se emitió ningún comprobante en ARCA.

## Qué se conectó

- El modo `v1` guarda cabecera, renglones y cálculo definitivo coherentes. Pedido facturado, venta directa y notas usan sus importes calculados. `sombra` sigue sin modificar importes comerciales y sus cálculos no se leen como definitivos.
- El envío de una operación v1 usa los totales y alícuotas guardados. El formatter valida y rechaza diferencias, sin reemplazar los precios por otros importes. Un frontend desactualizado que muestra otro total recibe `PREVIEW_DESACTUALIZADA` y la transacción se revierte.
- El PDF valida el cálculo guardado y conserva centavos, incluso en B. Las cantidades se muestran hasta tres decimales.
- La autorización normal persiste CAE, vencimiento, identidad, fecha, evidencia y conciliación en una transacción. La serie se libera dentro de esa misma transacción. Fallos posteriores a una autorización requieren recuperación, no otra emisión.
- Recuperación: se compara identidad, fecha y componentes monetarios. Se conserva por separado el contexto de la consulta específica, porque el SDK no devuelve todos los campos de identidad en su respuesta. Un resultado desconocido o incompleto nunca habilita por sí solo otra emisión. La recuperación interna del SDK tampoco asocia CAE por el número solamente.
- Libro IVA, vendedores, fletes y reportes comparten la expresión de fecha de reporte: fecha acreditada de A/B; fallback comercial provisional; fecha comercial para X. La columna histórica `fecha_fiscal` por sí sola no acredita una fecha. Los históricos no se reescriben.
- Libro IVA: evidencia canónica y secciones separadas. Un autorizado no evaluado no figura como conciliado. Se corrigió el desfase de un día al imprimir fechas DATE y se quitó el CUIT de ejemplo: se usa `AFIP_CUIT`.
- Venta directa: la intención UUID es la identidad del reintento. Se quitó el filtro previo por hash de contenido que confundía dos ventas legítimas iguales. Prueba concurrente real: cuatro solicitudes con una clave producen una venta.
- NC: el límite acumulado se valida contra el total realmente calculado, no contra el total enviado por el navegador.

## Migraciones y activación local

1. Usar una copia local con backup; nunca la conexión de producción. Confirmar host, base y usuario antes de ejecutar SQL. Las migraciones M001–M016 del trabajo previo deben estar aplicadas.
2. Aplicar `migrations/M017_calculo_aplicacion.sql`: distingue `SOMBRA` de `AUTORITATIVO`. Los cálculos existentes quedan en sombra: no se presume que eran definitivos.
3. Aplicar `migrations/M018_precision_operaciones.sql`: amplía precisión de cantidades de venta/pedido/remito/stock a tres decimales y precios de líneas a seis. Se incluyen stock y movimientos para que una cantidad no cambie al pasar de una tabla a otra. No recalcula históricos. No reducir precisión como rollback después de registrar nuevos datos.
4. Backend local: `MOTOR_CALCULO_VERSION=v1`, `FISCAL_V2=true`, `AFIP_PRODUCTION=false`. Conservar el `DEFAULT_PUNTO_VENTA` de homologación que corresponda. El selector real de entorno del SDK y de la evidencia es `AFIP_PRODUCTION`, no `NODE_ENV` ni `ARCA_ENTORNO`.
5. Frontend local: `NEXT_PUBLIC_MOTOR_CALCULO_VERSION=v1`, `NEXT_PUBLIC_API_URL=http://localhost:3001` (ajustar solo si el backend local usa otro puerto). Reiniciar desarrollo o volver a compilar: las variables `NEXT_PUBLIC_*` se fijan en el build.
6. Mantener CAE manual. No cambiar certificados para producción durante estas pruebas. EXENTO sigue bloqueado en v1 hasta validar su tratamiento; es un límite explícito, no una prueba aprobada.
7. Refrescar la aplicación y confirmar en la pestaña Red que las peticiones van al backend local. No mezclar un frontend v1 con un backend legacy, ni viceversa.

La base aislada `erp_preprod_conexiones`, en `/tmp/erp-reportes-mysql/mysql.sock`, contiene datos de pruebas y CAE SIMULADOS. No usarla como fuente para producción, ni sus documentos como comprobantes reales. La copia original `erp_reportes_nov2026` no se modificó para estas pruebas.

## Pruebas manuales del sistema (sin solicitar CAE todavía)

Usar un cliente y un producto de prueba en la copia local. Registrar stock y saldo iniciales. Para las cifras siguientes el precio indicado es NETO, antes del IVA. Si la interfaz muestra precio final, ajustar la entrada para obtener ese neto.

| Caso | Acción | Resultado esperado |
|---|---|---|
| Venta simple | Neto $1.000, cantidad 1, IVA 21% | Neto 1.000; IVA 210; total 1.210 |
| Descuento global porcentual | Mismo caso, 10% global | Neto 900; IVA 189; total 1.089 |
| Descuento fijo | Mismo caso, descuento final $121 | Neto 900; IVA 189; total 1.089 |
| Centavos | Neto $1.000,01, cantidad 1, IVA 21% | Neto 1.000,01; IVA 210; total 1.210,01, incluso en PDF B |
| Descuentos combinados | Neto 1.000, 10% de línea y 10% global | Neto 810; IVA 170,10; total 980,10 |
| IVA mixto | Una línea neta 1.000 al 21%, otra neta 1.000 al 10,5% | Neto 2.000; IVA 315; total 2.315 |
| Cantidad fraccionaria | Precio neto 1.000, cantidad 0,5, IVA 21% | Neto 500; IVA 105; total 605; stock baja 0,5 |
| Precisión extendida | Si la pantalla permite introducirla: precio 1.000,123456 y cantidad 2,333 al 21% | Neto 2.333,29; IVA 489,99; total 2.823,28; cantidad 2,333 en detalle, remito y movimiento |

En cada caso comparar: vista previa → venta guardada → detalle → PDF. Hacer al menos los casos simple, descuento global y centavos por **ambos caminos**, pedido → facturar y venta directa. No alcanza con comparar el total si neto e IVA difieren.

Después:

1. Reintentar la misma operación (doble clic o repetición de la petición con el mismo `operacion_id`). Debe devolver el mismo ID; un solo remito, un solo movimiento de fondos y un solo descuento de stock.
2. Crear intencionalmente una segunda venta igual desde una operación nueva. Debe tener otro ID y producir sus propios efectos.
3. Intentar facturar un pedido anulado: debe rechazarlo sin cambiar stock ni fondos.
4. Crear X: debe aparecer en datos comerciales, quedar fuera del libro IVA y no solicitar CAE.
5. Crear un documento de flete con un producto correctamente marcado como servicio de flete. Debe quedar separado de mercadería. Probar el bloqueo de mezcla de mercadería y flete en un mismo documento nuevo.
6. NC por devolución: referencia correcta, resta una sola vez al vendedor de la factura y devuelve las unidades correspondientes. NC por ajuste de precio: resta una sola vez, pero NO devuelve stock. Reintentar ambas: ningún efecto adicional.
7. Intentar una NC superior al saldo pendiente de acreditar: rechazo. Para NC A/B, realizar primero la autorización de su factura en homologación.
8. Entrar como vendedor: confirmar que no puede solicitar CAE, ver evidencias fiscales reservadas ni usar los reportes gerenciales restringidos.
9. Ejecutar libro IVA, listado del vendedor y reporte financiero con iguales fechas. En vendedor y reporte comparar la misma medida **total final** y el mismo conjunto de comprobantes. En IVA verificar A/B, notas con signo correcto y secciones de pendientes/discrepantes separadas.
10. Descargar el PDF desde el reporte mostrado: mismos filtros, cifras y snapshot. Probar período vacío, cambio de mes y una autorización que cae en un mes distinto de la venta. No deben duplicarse documentos entre meses.

Una autorización histórica sin evidencia suficiente puede quedar en EVIDENCIA INCOMPLETA. No reemplazar sus importes por cero ni rellenar evidencia para hacer desaparecer la advertencia. La migración no resuelve administrativamente el historial.

## Homologación real (la realiza el gerente)

1. Confirmar en backend `AFIP_PRODUCTION=false`, CUIT de homologación, certificado/clave de homologación (`AFIP_CERT_PATH`, `AFIP_KEY_PATH`) y punto de venta habilitado. No reutilizar certificados productivos por comodidad. No compartir claves privadas ni tokens en capturas.
2. Comprobar conectividad con `AFIP_PRODUCTION=false npm run test:arca-homo` desde backend. Este paso no sustituye emitir las pruebas siguientes.
3. Crear y autorizar manualmente una A y una B nuevas. Incluir descuento global y centavos entre ambas.
4. Comparar: cabecera comercial, renglones, cálculo guardado, payload final `datosARCA`, autorización canónica, PDF y datos del QR. Deben coincidir importe, tipo, punto de venta, número, receptor y fecha. La autorización normal debe dejar `AUTORIZADO` y `CONCILIADO` si todo coincide; no debe depender de usar Recuperar estado para que aparezca la evidencia.
5. Generar el libro del período fiscal y comprobar que aparecen en autorizados conciliados, con el mismo neto/IVA/total de la autorización. Generar también vendedor y reporte y comprobar su total final comercial.
6. Autorizar una NC A/B referenciada a una de esas facturas. Revisar referencia, vendedor, importes negativos en reportes y efecto de stock según devolución/ajuste. Probar ND referenciada si se usa en el negocio.
7. Para recuperación, utilizar un caso de resultado desconocido real o una simulación controlada local. No cortar Internet deliberadamente y después pulsar emitir repetidamente. Recuperar consulta el número reservado; nunca debe obtener otro CAE por reintento. Si falta evidencia o la identidad difiere, debe bloquear la asociación; si no se encuentra el comprobante, no significa automáticamente que pueda reemitirse.
8. Si hubo recuperación, comprobar además número visible, vencimiento, fecha fiscal, QR y evidencia canónica, no solo que aparezca un CAE.

Registrar por caso: ID de venta, tipo, PV/número, total esperado/obtenido, estado, PDF y resultado de cada comparación. Un rechazo fiscal debe conservar el mensaje del organismo; no asumir que una prueba monetaria aprobada acredita la configuración fiscal.

## Evidencia automatizada local

- `npm run test:conexiones` en backend: usa exclusivamente socket local y base `erp_preprod_conexiones`; falla si esa base no está preparada. Ejecuta HTTP real sobre servicios comerciales, MySQL, concurrencia, intenciones distintas, rollback, pedido, NC, precisión, formatter, evidencia normal y PDF. La autorización externa se simula: no hay emisión ARCA.
- Suite backend existente ejecutada con un pool inyectado exclusivamente a la copia local. Se omiten las consultas legacy condicionadas por DB_HOST y el PDF de nota de pedido; no presentar esos pasos omitidos como integración validada.
- Comparación SQL de los 6.099 comprobantes históricos entre original y copia de pruebas: cero modificaciones de subtotal, IVA o total.
- M017 y M018 ejecutadas dos veces sobre copia local para verificar repetición sin pérdida de datos.
- 19 pruebas de reportes, incluidas MySQL y generación real de PDF, aprobadas sin omisiones.
- Prueba de navegador de reportes: siete pestañas, detalle, actualización, error, PDF vencido y pantalla móvil; API interceptada para impedir llamadas externas.
- Tests de frontend y build de producción aprobados. Persisten advertencias de lint/CSS preexistentes fuera del alcance.
- PDF B con centavos y libro IVA renderizados e inspeccionados visualmente. Son documentos de prueba con CAE simulado, sin validez fiscal.

## Criterio para publicar

Publicar después de: backup/restauración verificados en tu entorno; migraciones aplicadas en staging; pruebas manuales anteriores aprobadas; homologación real A/B y notas aprobada; frontend/backend con versiones y flags concordantes; revisión de pendientes históricos y del bloqueo EXENTO. No afirmar que todo el historial quedó conciliado porque las nuevas operaciones cierren.

Para desactivar nuevas operaciones v1, coordinar flags de frontend y backend. Los cálculos v1 ya persistidos siguen siendo la fuente de sus PDF y envíos fiscales; no se reconvierten a legacy. No eliminar M017/M018 ni las evidencias como rollback. Una autorización fiscal no se deshace apagando un flag.
