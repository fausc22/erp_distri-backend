const express = require('express');
const finanzasController = require('../controllers/finanzasController');
const { requireEmployee, requireManager } = require('../middlewares/authMiddleware');
const { middlewareAuditoria } = require('../middlewares/auditoriaMiddleware');
const router = express.Router();

// Rutas para las cuentas
router.get('/obtener-cuentas', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    finanzasController.obtenerCuentas
);

router.post('/cuentas', 
    requireManager,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'cuenta_fondos', incluirBody: true }),
    finanzasController.crearCuenta
);

router.get('/cuentas/:cuentaId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    finanzasController.obtenerCuenta
);

// Rutas para los movimientos
router.get('/movimientos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerMovimientos
);

router.post('/movimientos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.registrarMovimiento
);

// Ruta para transferencias
router.post('/transferencias', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.realizarTransferencia
);

// Rutas para historial de ingresos
router.get('/ingresos/historial', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerIngresos
);

router.get('/ingresos/cuentas', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'cuenta_fondos' }),
    finanzasController.obtenerCuentasParaFiltro
);

router.post('/ingresos/registrar', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.registrarIngreso
);

// *** NUEVAS RUTAS PARA DETALLES DE INGRESOS ***
router.get('/ingresos/detalle-venta/:ventaId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas' }),
    finanzasController.obtenerDetalleVenta
);

router.get('/ingresos/detalle-ingreso/:ingresoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos' }),
    finanzasController.obtenerDetalleIngreso
);

// Rutas para historial de egresos
router.get('/egresos/historial', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerEgresos
);

router.post('/egresos/registrar', 
    requireEmployee,
    middlewareAuditoria({ accion: 'INSERT', tabla: 'movimiento_fondos', incluirBody: true }),
    finanzasController.registrarEgreso
);

// *** NUEVAS RUTAS PARA DETALLES DE EGRESOS ***
router.get('/egresos/detalle-compra/:compraId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'compras' }),
    finanzasController.obtenerDetalleCompra
);

router.get('/egresos/detalle-gasto/:gastoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'gastos' }),
    finanzasController.obtenerDetalleGasto
);

router.get('/egresos/detalle-egreso/:egresoId', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos' }),
    finanzasController.obtenerDetalleEgreso
);

// Rutas para reportes financieros (solo gerentes para algunos)
router.get('/balance-general', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerBalanceGeneral
);

router.get('/balance-cuenta', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerBalancePorCuenta
);

router.get('/distribucion-ingresos', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerDistribucionIngresos
);

router.get('/gastos-categoria', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerGastosPorCategoria
);

router.get('/flujo-fondos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos', incluirQuery: true }),
    finanzasController.obtenerFlujoDeFondos
);

router.get('/anios-disponibles', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'movimiento_fondos' }),
    finanzasController.obtenerAniosDisponibles
);








// ✅ NUEVA RUTA: Verificar disponibilidad de datos
router.get('/verificar-datos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'verificacion_datos' }),
    finanzasController.verificarDisponibilidadDatos
);

const validarYCompletarFiltros = (req, res, next) => {
  const { desde, hasta, periodo } = req.query;
  
  // ✅ Si no hay fechas, usar valores por defecto
  if (!desde || !hasta) {
    const ahora = new Date();
    const hace30Dias = new Date();
    hace30Dias.setDate(ahora.getDate() - 30);
    
    req.query.desde = desde || hace30Dias.toISOString().split('T')[0];
    req.query.hasta = hasta || ahora.toISOString().split('T')[0];
    
    console.log(`⚡ Filtros autocompletados: desde=${req.query.desde}, hasta=${req.query.hasta}`);
  }
  
  // ✅ Validar formato de fecha
  const fechaDesde = new Date(req.query.desde);
  const fechaHasta = new Date(req.query.hasta);
  
  if (isNaN(fechaDesde.getTime()) || isNaN(fechaHasta.getTime())) {
    return res.status(400).json({
      success: false,
      message: 'Formato de fecha inválido. Use YYYY-MM-DD',
      ejemplo: '?desde=2025-01-01&hasta=2025-01-31'
    });
  }
  
  if (fechaDesde > fechaHasta) {
    return res.status(400).json({
      success: false,
      message: 'La fecha "desde" no puede ser mayor que "hasta"',
      filtros_recibidos: { desde: req.query.desde, hasta: req.query.hasta }
    });
  }
  
  // ✅ Asegurar período válido
  req.query.periodo = periodo || 'mensual';
  
  next();
};

// ✅ RUTA CORREGIDA: ganancias-detalladas con autocompletado de filtros
router.get('/ganancias-detalladas', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    validarYCompletarFiltros, // ✅ Aplicar validación y autocompletado
    finanzasController.obtenerGananciasDetalladas
);

// ✅ APLICAR A OTRAS RUTAS PRINCIPALES
router.get('/resumen-financiero', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Para resumen financiero, las fechas son opcionales
      console.log('📊 Solicitando resumen financiero:', req.query);
      next();
    },
    finanzasController.obtenerResumenFinanciero
);

router.get('/ganancias-por-producto', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Autocompletar si faltan fechas
      if (!req.query.desde || !req.query.hasta) {
        const ahora = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(ahora.getDate() - 30);
        
        req.query.desde = req.query.desde || hace30Dias.toISOString().split('T')[0];
        req.query.hasta = req.query.hasta || ahora.toISOString().split('T')[0];
      }
      next();
    },
    finanzasController.obtenerGananciasPorProducto
);

router.get('/ganancias-por-empleado', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Autocompletar si faltan fechas
      if (!req.query.desde || !req.query.hasta) {
        const ahora = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(ahora.getDate() - 30);
        
        req.query.desde = req.query.desde || hace30Dias.toISOString().split('T')[0];
        req.query.hasta = req.query.hasta || ahora.toISOString().split('T')[0];
      }
      next();
    },
    finanzasController.obtenerGananciasPorEmpleado
);

router.get('/ganancias-por-ciudad', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Autocompletar si faltan fechas
      if (!req.query.desde || !req.query.hasta) {
        const ahora = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(ahora.getDate() - 30);
        
        req.query.desde = req.query.desde || hace30Dias.toISOString().split('T')[0];
        req.query.hasta = req.query.hasta || ahora.toISOString().split('T')[0];
      }
      next();
    },
    finanzasController.obtenerGananciasPorCiudad
);

router.get('/productos-mas-rentables', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Autocompletar si faltan fechas
      if (!req.query.desde || !req.query.hasta) {
        const ahora = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(ahora.getDate() - 30);
        
        req.query.desde = req.query.desde || hace30Dias.toISOString().split('T')[0];
        req.query.hasta = req.query.hasta || ahora.toISOString().split('T')[0];
      }
      next();
    },
    finanzasController.obtenerProductosMasRentables
);

router.get('/ventas-vendedores', 
    requireManager,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Autocompletar si faltan fechas
      if (!req.query.desde || !req.query.hasta) {
        const ahora = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(ahora.getDate() - 30);
        
        req.query.desde = req.query.desde || hace30Dias.toISOString().split('T')[0];
        req.query.hasta = req.query.hasta || ahora.toISOString().split('T')[0];
      }
      next();
    },
    finanzasController.obtenerVentasPorVendedor
);

router.get('/ventas-productos', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'detalle_ventas', incluirQuery: true }),
    (req, res, next) => {
      // ✅ Autocompletar si faltan fechas
      if (!req.query.desde || !req.query.hasta) {
        const ahora = new Date();
        const hace30Dias = new Date();
        hace30Dias.setDate(ahora.getDate() - 30);
        
        req.query.desde = req.query.desde || hace30Dias.toISOString().split('T')[0];
        req.query.hasta = req.query.hasta || ahora.toISOString().split('T')[0];
      }
      next();
    },
    finanzasController.obtenerProductosMasVendidos
);

// ✅ NUEVA RUTA DE DEBUGGING
router.get('/debug/filtros', 
    requireEmployee,
    (req, res) => {
      const ahora = new Date();
      const hace30Dias = new Date();
      hace30Dias.setDate(ahora.getDate() - 30);
      
      res.json({
        success: true,
        message: 'Información de filtros para debugging',
        filtros_recibidos: req.query,
        filtros_por_defecto: {
          desde: hace30Dias.toISOString().split('T')[0],
          hasta: ahora.toISOString().split('T')[0],
          periodo: 'mensual',
          limite: 20
        },
        fecha_servidor: ahora.toISOString(),
        ejemplos: {
          ganancias_detalladas: '/finanzas/ganancias-detalladas?desde=2025-06-21&hasta=2025-07-21&periodo=mensual',
          sin_filtros: '/finanzas/ganancias-detalladas (se aplicarán filtros por defecto)',
          con_limite: '/finanzas/ganancias-por-producto?limite=10'
        }
      });
    }
);


router.get('/top-productos-tabla', 
    requireEmployee,
    middlewareAuditoria({ accion: 'VIEW', tabla: 'ventas', incluirQuery: true }),
    finanzasController.obtenerTopProductosTabla
);



module.exports = router;