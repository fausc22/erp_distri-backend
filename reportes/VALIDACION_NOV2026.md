# Cierre con datos reales — 02/11/2026

Este informe reemplaza la verificación anterior de la exportación vacía. El archivo actualizado sí contiene datos.

## Fuente y aislamiento

- DATA_NOV2026.sql: 28.131.310 bytes.
- SHA-256: e82bebbb8bbf0e91bb0e3c0c4144a45367b23ae1840f59e02c0b02fa006b85b4.
- MySQL 8.0.44 local, socket Unix, sin red. Importación exclusivamente en erp_reportes_nov2026. No se accedió ni se escribió en producción.
- Filas: ventas 6.099; ventas_cont 46.669; movimiento_fondos 6.062; compras 10; gastos 3; cuenta_fondos 2.
- Comprobantes desde 11/07/2025 hasta 02/11/2026. No se publican el dump ni credenciales en los repositorios.

## Conciliación

Se verificaron los 17 meses con actividad: 6.099 comprobantes, sin diferencias entre servicio y SQL independiente en los controles ejecutados. Se contrastaron IDs, importe y clasificación de cada documento; total de cabeceras; libro IVA; listado comercial; compras; gastos; ingresos/egresos externos; transferencias y variación de caja. Los controles de partición, meses, vendedores, ciudades y líneas más ajuste cerraron en todos los períodos. Máxima lectura/cálculo observada: 79 ms local (no constituye SLA de producción).

| Período | Total final | Normal | Con flete | Pendiente |
|---|---:|---:|---:|---:|
| Octubre completo | $93.460.389,00 | $81.734.584,00 | $11.734.390,00 | -$8.585,00 |
| Noviembre 1–2, hasta el corte exportado | $4.791.880,00 | $4.791.880,00 | $0,00 | $0,00 |

Octubre: 680 documentos (649 facturas y 31 NC). Libro IVA A/B: $56.699.862,00; diferencia contra el segmento A/B del reporte: $0,00. El listado comercial tiene su propia base y fecha; coincide con $83.782.728,83. Noviembre: 26 facturas, A/B $2.068.270,00; listado comercial $4.305.265,00. La diferencia comercial no es un error de sumatoria: usa subtotal A/B y fecha comercial.

## Datos que requieren revisión administrativa

- Octubre: NC 0004-00020, ID 6105, -$8.585,00, sin factura de referencia. Se incluye en total y se conserva pendiente de clasificación. No se inventa la referencia ni se modifica la fuente.
- Historial completo: 7 documentos pendientes (3 en febrero, neto $1,21; 3 en abril, neto -$1.070.275; 1 en octubre). La pantalla permite revisarlos por período.
- Octubre: 654 ajustes cabecera/líneas, todos de hasta $1, neto -$70,97. Noviembre: 26, neto -$3,64. Se informan y se conserva el total de cabecera. El importe guardado no se reconstruye mediante precios actuales.
- Hay nombres geográficos variantes y provincias faltantes en la fuente; se conservan las etiquetas guardadas, sin fusionar ubicaciones por suposición.
- Compras y gastos de octubre/noviembre son cero en esta copia. Eso no certifica que la empresa no haya tenido costos. Sin costos históricos y saldo inicial verificados no se afirma utilidad ni saldo real.

## Pruebas finales

- 19/19 pruebas específicas aprobadas, sin omisiones: cálculo, autorización, snapshots, MySQL, concurrencia y PDF real.
- Navegador: siete pestañas, detalle, actualización, error, vencimiento PDF y móvil; aprobado. Usa API interceptada y fixtures; la copia real se valida directamente en MySQL.
- Frontend: tests y build de producción aprobados; advertencias preexistentes del build sin errores.
- Suite heredada backend: exit 0. Se corrigió un test estático para tolerar espacios/saltos de línea SQL. Sin cambios a finanzasService.js. Dos pruebas heredadas omiten sus consultas sin DB_HOST y se omitió PDF heredado; los tests nuevos sí ejecutan MySQL/PDF reales.
- PDFs reales octubre (7 páginas) y noviembre parcial (5): importes y snapshot comprobados por extracción, todas las páginas inspeccionadas visualmente. Se eliminó un salto forzado que desperdiciaba una página.
- git diff --check aprobado en ambos repositorios.

Evidencia detallada: VALIDACION_COPIA_NOVIEMBRE.json y VALIDACION_PDF_NOVIEMBRE.json. PDFs locales en output/pdf/. El código de conciliación reproducible está en backend/tests/reportesV2.copy-check.js.

## Salida a producción

Implementación y validación técnica completas, preparadas para publicación. No se realizó push ni despliegue. La clasificación histórica no se declara 100% resuelta mientras existan los 7 documentos pendientes; quedan visibles y no impiden la conciliación del total.

1. Publicar backend con las rutas v2 y Chromium disponible (PUPPETEER_EXECUTABLE_PATH si corresponde); mantener la instancia única configurada.
2. Publicar frontend compilado con NEXT_PUBLIC_REPORTES_V2 ausente o true. No hay migración SQL ni se debe importar este dump en producción.
3. Ingresar como gerente; revisar octubre, pendientes, noviembre actual y PDF. Noviembre en vivo puede diferir de la copia por operaciones posteriores. Usuarios no gerentes deben conservar rechazo de acceso.
4. Ante un problema de activación, reconstruir/publicar frontend con NEXT_PUBLIC_REPORTES_V2=false. La vista anterior queda disponible como contingencia y conserva sus limitaciones conocidas.

No se cambiaron ventas, stock, libro IVA, listados, ni datos históricos. Los snapshots duran 30 minutos, son por usuario y proceso; varios procesos requieren afinidad o store compartido. Reiniciar backend exige refrescar la vista antes de descargar.
