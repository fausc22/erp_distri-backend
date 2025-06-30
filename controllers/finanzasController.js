const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const puppeteer = require("puppeteer");
const multer = require('multer');



const obtenerCuentas = (req, res) => {
  const query = `
    SELECT * FROM cuenta_fondos
    ORDER BY id ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener cuentas:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener cuentas" 
      });
    }
    res.json({ 
      success: true, 
      data: results 
    });
  });
};


const crearCuenta = (req, res) => {
  const { nombre, saldo = 0 } = req.body;
  
  if (!nombre) {
    return res.status(400).json({
      success: false,
      message: "El nombre de la cuenta es obligatorio"
    });
  }
  
  const query = `
    INSERT INTO cuenta_fondos (nombre, saldo)
    VALUES (?, ?)
  `;
  
  db.query(query, [nombre, saldo], (err, result) => {
    if (err) {
      console.error('Error al crear cuenta:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al crear la cuenta" 
      });
    }
    
    res.json({
      success: true,
      message: "Cuenta creada exitosamente",
      id: result.insertId
    });
  });
};

const obtenerCuenta = (req, res) => {
  const cuentaId = req.params.cuentaId;
  
  const query = `
    SELECT * FROM cuenta_fondos
    WHERE id = ?
  `;
  
  db.query(query, [cuentaId], (err, results) => {
    if (err) {
      console.error('Error al obtener la cuenta:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener la cuenta" 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Cuenta no encontrada"
      });
    }
    
    res.json({ 
      success: true, 
      data: results[0] 
    });
  });
};

const registrarMovimiento = (req, res) => {
  const { cuenta_id, tipo, origen, monto, descripcion, referencia_id = null } = req.body;
  
  // Validaciones
  if (!cuenta_id || !tipo || !monto || monto <= 0) {
    return res.status(400).json({
      success: false,
      message: "Faltan datos obligatorios o el monto es inválido"
    });
  }

  // 1. Primero insertamos el movimiento
  const insertQuery = `
    INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, monto, referencia_id)
    VALUES (?, ?, ?, ?, ?)
  `;
  
  db.query(
    insertQuery,
    [cuenta_id, tipo, origen, monto, referencia_id],
    (err, insertResults) => {
      if (err) {
        console.error('Error al insertar movimiento:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al insertar el movimiento" 
        });
      }
      
      // 2. Luego actualizamos el saldo de la cuenta
      const updateQuery = `
        UPDATE CUENTA_FONDOS
        SET saldo = saldo ${tipo === 'INGRESO' ? '+' : '-'} ?
        WHERE id = ?
      `;
      
      db.query(
        updateQuery,
        [monto, cuenta_id],
        (err, updateResults) => {
          if (err) {
            console.error('Error al actualizar saldo:', err);
            // Nota: Aquí no tenemos control de transacción para deshacer la inserción anterior
            return res.status(500).json({ 
              success: false, 
              message: "Error al actualizar el saldo" 
            });
          }
          
          res.json({
            success: true,
            message: `${tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'} registrado exitosamente`,
            id: insertResults.insertId
          });
        }
      );
    }
  );
};

const obtenerMovimientos = (req, res) => {
  let { cuenta_id, tipo, desde, hasta, busqueda, limit = 100 } = req.query;
  
  let query = `
    SELECT * FROM movimiento_fondos
    WHERE 1=1
  `;
  
  let params = [];
  
  // Aplicar filtros
  if (cuenta_id && cuenta_id !== 'todas') {
    query += ` AND cuenta_id = ?`;
    params.push(cuenta_id);
  }
  
  if (tipo && tipo !== 'todos') {
    query += ` AND tipo = ?`;
    params.push(tipo);
  }
  
  if (desde) {
    query += ` AND DATE(fecha) >= ?`;
    params.push(desde);
  }
  
  if (hasta) {
    query += ` AND DATE(fecha) <= ?`;
    params.push(hasta);
  }
  
  if (busqueda) {
    query += ` AND (origen LIKE ? OR referencia_id LIKE ?)`;
    params.push(`%${busqueda}%`, `%${busqueda}%`);
  }
  
  // Ordenar y limitar resultados
  query += ` ORDER BY fecha DESC LIMIT ?`;
  params.push(parseInt(limit));
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener movimientos:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener los movimientos" 
      });
    }
    
    res.json({ 
      success: true, 
      data: results 
    });
  });
};

// Función para realizar transferencias entre cuentas (sin usar getConnection)
const realizarTransferencia = (req, res) => {
  const { cuenta_origen, cuenta_destino, monto, descripcion } = req.body;
  
  if (!cuenta_origen || !cuenta_destino || !monto || monto <= 0) {
    return res.status(400).json({
      success: false,
      message: "Datos de transferencia inválidos"
    });
  }
  
  if (cuenta_origen === cuenta_destino) {
    return res.status(400).json({
      success: false,
      message: "Las cuentas de origen y destino deben ser diferentes"
    });
  }
  
  // 1. Verificar saldo suficiente en cuenta origen
  const checkQuery = `
    SELECT saldo FROM cuenta_fondos WHERE id = ?
  `;
  
  db.query(checkQuery, [cuenta_origen], (err, checkResults) => {
    if (err) {
      console.error('Error al verificar saldo:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al verificar el saldo" 
      });
    }
    
    if (checkResults.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Cuenta de origen no encontrada" 
      });
    }
    
    if (parseFloat(checkResults[0].saldo) < parseFloat(monto)) {
      return res.status(400).json({ 
        success: false, 
        message: "Saldo insuficiente en la cuenta de origen" 
      });
    }
    
    // 2. Registrar el egreso en la cuenta origen
    const egresoQuery = `
      INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, monto, referencia_id)
      VALUES (?, 'EGRESO', 'transferencia', ?, NULL)
    `;
    
    db.query(egresoQuery, [cuenta_origen, monto], (err, egresoResults) => {
      if (err) {
        console.error('Error al registrar egreso:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al registrar el egreso" 
        });
      }
      
      // 3. Registrar el ingreso en la cuenta destino
      const ingresoQuery = `
        INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, monto, referencia_id)
        VALUES (?, 'INGRESO', 'transferencia', ?, ?)
      `;
      
      db.query(ingresoQuery, [cuenta_destino, monto, egresoResults.insertId], (err, ingresoResults) => {
        if (err) {
          console.error('Error al registrar ingreso:', err);
          return res.status(500).json({ 
            success: false, 
            message: "Error al registrar el ingreso" 
          });
        }
        
        // 4. Actualizar saldo en cuenta origen (restar)
        const updateOrigenQuery = `
          UPDATE cuenta_fondos SET saldo = saldo - ? WHERE id = ?
        `;
        
        db.query(updateOrigenQuery, [monto, cuenta_origen], (err, updateOrigenResults) => {
          if (err) {
            console.error('Error al actualizar cuenta origen:', err);
            return res.status(500).json({ 
              success: false, 
              message: "Error al actualizar la cuenta de origen" 
            });
          }
          
          // 5. Actualizar saldo en cuenta destino (sumar)
          const updateDestinoQuery = `
            UPDATE cuenta_fondos SET saldo = saldo + ? WHERE id = ?
          `;
          
          db.query(updateDestinoQuery, [monto, cuenta_destino], (err, updateDestinoResults) => {
            if (err) {
              console.error('Error al actualizar cuenta destino:', err);
              return res.status(500).json({ 
                success: false, 
                message: "Error al actualizar la cuenta de destino" 
              });
            }
            
            res.json({
              success: true,
              message: "Transferencia realizada exitosamente"
            });
          });
        });
      });
    });
  });
};

const obtenerIngresos = (req, res) => {
  // Filtros opcionales
  let { desde, hasta, tipo, cuenta, busqueda, limit = 100 } = req.query;
  
  // Construimos la consulta base que une ventas y solo los ingresos manuales (no automáticos)
  let query = `
    SELECT 
      'Venta' AS tipo, 
      v.id AS referencia, 
      v.cliente_nombre AS descripcion,
      v.total AS monto, 
      v.fecha, 
      'Venta' AS origen,
      'Cuenta Corriente' AS cuenta 
    FROM ventas v 
    UNION ALL 
    SELECT 
      mf.tipo, 
      mf.referencia_id, 
      mf.origen AS descripcion,
      mf.monto, 
      mf.fecha, 
      mf.origen,
      cf.nombre AS cuenta 
    FROM movimiento_fondos mf 
    JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id 
    WHERE mf.tipo = 'INGRESO' 
    AND (
      mf.origen = 'ingreso manual' OR 
      mf.origen = 'cobro' OR 
      mf.origen = 'reintegro' OR 
      mf.origen = 'ajuste' OR 
      mf.origen = 'otro' OR
      (mf.origen != 'venta' AND mf.referencia_id IS NULL)
    )
  `;
  
  // Aplicamos filtros
  let whereClause = [];
  let params = [];
  
  if (desde) {
    whereClause.push("fecha >= ?");
    params.push(desde);
  }
  
  if (hasta) {
    whereClause.push("fecha <= ?");
    params.push(hasta);
  }
  
  if (tipo && tipo !== 'todos') {
    whereClause.push("tipo = ?");
    params.push(tipo);
  }
  
  if (cuenta && cuenta !== 'todas') {
    whereClause.push("cuenta = ?");
    params.push(cuenta);
  }
  
  if (busqueda) {
    whereClause.push("(descripcion LIKE ? OR referencia LIKE ?)");
    params.push(`%${busqueda}%`, `%${busqueda}%`);
  }
  
  // Agregamos WHERE si hay filtros
  if (whereClause.length > 0) {
    query = `SELECT * FROM (${query}) AS ingresos WHERE ${whereClause.join(" AND ")}`;
  } else {
    query = `SELECT * FROM (${query}) AS ingresos`;
  }
  
  // Agregamos ORDER BY y LIMIT
  query += ` ORDER BY fecha DESC LIMIT ?`;
  params.push(parseInt(limit));
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener ingresos:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener los ingresos" 
      });
    }
    
    // Calculamos el total de los ingresos mostrados
    const totalIngresos = results.reduce((sum, ingreso) => sum + parseFloat(ingreso.monto), 0);
    
    res.json({ 
      success: true, 
      data: results,
      total: totalIngresos
    });
  });
};

const obtenerCuentasParaFiltro = (req, res) => {
  const query = `
    SELECT nombre FROM cuenta_fondos
    UNION
    SELECT 'Cuenta Corriente' AS nombre
    ORDER BY nombre
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener cuentas para filtro:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener las cuentas" 
      });
    }
    
    // Convertimos el resultado a un array simple
    const cuentas = results.map(item => item.nombre);
    
    res.json({ 
      success: true, 
      data: cuentas
    });
  });
};

// Función para registrar un nuevo ingreso manual
const registrarIngreso = (req, res) => {
  const { cuenta_id, monto, origen, descripcion, referencia_id = null } = req.body;
  
  // Validaciones
  if (!cuenta_id || !monto || monto <= 0) {
    return res.status(400).json({
      success: false,
      message: "Faltan datos obligatorios o el monto es inválido"
    });
  }

  // 1. Primero insertamos el movimiento
  const insertQuery = `
    INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, monto, referencia_id)
    VALUES (?, 'INGRESO', ?, ?, ?)
  `;
  
  db.query(
    insertQuery,
    [cuenta_id, origen || 'ingreso manual', monto, referencia_id],
    (err, insertResults) => {
      if (err) {
        console.error('Error al insertar ingreso:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al insertar el ingreso" 
        });
      }
      
      // 2. Luego actualizamos el saldo de la cuenta
      const updateQuery = `
        UPDATE cuenta_fondos
        SET saldo = saldo + ?
        WHERE id = ?
      `;
      
      db.query(
        updateQuery,
        [monto, cuenta_id],
        (err, updateResults) => {
          if (err) {
            console.error('Error al actualizar saldo:', err);
            return res.status(500).json({ 
              success: false, 
              message: "Error al actualizar el saldo" 
            });
          }
          
          res.json({
            success: true,
            message: "Ingreso registrado exitosamente",
            id: insertResults.insertId
          });
        }
      );
    }
  );
};

const obtenerDetalleVenta = (req, res) => {
  const ventaId = req.params.ventaId;
  
  // Primero obtenemos la información general de la venta
  const ventaQuery = `
    SELECT * FROM ventas
    WHERE id = ?
  `;
  
  db.query(ventaQuery, [ventaId], (err, ventaResults) => {
    if (err) {
      console.error('Error al obtener la venta:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener la venta" 
      });
    }
    
    if (ventaResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Venta no encontrada"
      });
    }
    
    const venta = ventaResults[0];
    
    // Luego obtenemos los productos de la venta
    const productosQuery = `
      SELECT * FROM ventas_cont
      WHERE venta_id = ?
    `;
    
    db.query(productosQuery, [ventaId], (err, productosResults) => {
      if (err) {
        console.error('Error al obtener los productos de la venta:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al obtener los productos de la venta" 
        });
      }
      
      res.json({ 
        success: true, 
        data: {
          venta: venta,
          productos: productosResults
        }
      });
    });
  });
};


const obtenerDetalleIngreso = (req, res) => {
  const ingresoId = req.params.ingresoId;
  console.log(`Solicitando detalle del ingreso ID: ${ingresoId}`);
  
  const query = `
    SELECT 
      mf.*,
      cf.nombre AS cuenta_nombre
    FROM movimiento_fondos mf
    JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id
    WHERE mf.id = ? AND mf.tipo = 'INGRESO'
  `;
  
  db.query(query, [ingresoId], (err, results) => {
    if (err) {
      console.error('Error al obtener el ingreso:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el ingreso" 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ingreso no encontrado"
      });
    }
    
    res.json({ 
      success: true, 
      data: results[0]
    });
  });
};

const obtenerEgresos = (req, res) => {
  // Filtros opcionales
  let { desde, hasta, tipo, cuenta, busqueda, limit = 100 } = req.query;
  
  // Construimos la consulta base que une compras, gastos y movimientos de egreso
  let query = `
    SELECT 
      'Compra' AS tipo, 
      c.id AS referencia, 
      c.proveedor_nombre AS descripcion,
      c.total AS monto, 
      c.fecha, 
      'Compra' AS origen,
      'Cuenta Corriente' AS cuenta,
      NULL AS id
    FROM compras c
    UNION ALL 
    SELECT 
      'Gasto' AS tipo, 
      g.id AS referencia, 
      g.descripcion,
      g.monto, 
      g.fecha, 
      'Gasto' AS origen,
      'Efectivo' AS cuenta,
      NULL AS id
    FROM gastos g
    UNION ALL 
    SELECT 
      mf.tipo, 
      mf.referencia_id AS referencia, 
      mf.origen AS descripcion,
      mf.monto, 
      mf.fecha, 
      mf.origen,
      cf.nombre AS cuenta,
      mf.id
    FROM movimiento_fondos mf 
    JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id 
    WHERE mf.tipo = 'EGRESO'
  `;
  
  // Aplicamos filtros
  let whereClause = [];
  let params = [];
  
  if (desde) {
    whereClause.push("fecha >= ?");
    params.push(desde);
  }
  
  if (hasta) {
    whereClause.push("fecha <= ?");
    params.push(hasta);
  }
  
  if (tipo && tipo !== 'todos') {
    whereClause.push("tipo = ?");
    params.push(tipo);
  }
  
  if (cuenta && cuenta !== 'todas') {
    whereClause.push("cuenta = ?");
    params.push(cuenta);
  }
  
  if (busqueda) {
    whereClause.push("(descripcion LIKE ? OR referencia LIKE ?)");
    params.push(`%${busqueda}%`, `%${busqueda}%`);
  }
  
  // Agregamos WHERE si hay filtros
  if (whereClause.length > 0) {
    query = `SELECT * FROM (${query}) AS egresos WHERE ${whereClause.join(" AND ")}`;
  } else {
    query = `SELECT * FROM (${query}) AS egresos`;
  }
  
  // Agregamos ORDER BY y LIMIT
  query += ` ORDER BY fecha DESC LIMIT ?`;
  params.push(parseInt(limit));
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener egresos:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener los egresos" 
      });
    }
    
    // Calculamos el total de los egresos mostrados
    const totalEgresos = results.reduce((sum, egreso) => sum + parseFloat(egreso.monto), 0);
    
    res.json({ 
      success: true, 
      data: results,
      total: totalEgresos
    });
  });
};

const obtenerDetalleCompra = (req, res) => {
  const compraId = req.params.compraId;
  
  // Primero obtenemos la información general de la compra
  const compraQuery = `
    SELECT * FROM compras
    WHERE id = ?
  `;
  
  db.query(compraQuery, [compraId], (err, compraResults) => {
    if (err) {
      console.error('Error al obtener la compra:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener la compra" 
      });
    }
    
    if (compraResults.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Compra no encontrada"
      });
    }
    
    const compra = compraResults[0];
    
    // Luego obtenemos los productos de la compra
    const productosQuery = `
      SELECT * FROM compras_cont
      WHERE compra_id = ?
    `;
    
    db.query(productosQuery, [compraId], (err, productosResults) => {
      if (err) {
        console.error('Error al obtener los productos de la compra:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al obtener los productos de la compra" 
        });
      }
      
      res.json({ 
        success: true, 
        data: {
          compra: compra,
          productos: productosResults
        }
      });
    });
  });
};

// Función para obtener detalles de un gasto
const obtenerDetalleGasto = (req, res) => {
  const gastoId = req.params.gastoId;
  
  const query = `
    SELECT * FROM gastos
    WHERE id = ?
  `;
  
  db.query(query, [gastoId], (err, results) => {
    if (err) {
      console.error('Error al obtener el gasto:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el gasto" 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gasto no encontrado"
      });
    }
    
    res.json({ 
      success: true, 
      data: results[0]
    });
  });
};

// Función para obtener detalles de un egreso
const obtenerDetalleEgreso = (req, res) => {
  const egresoId = req.params.egresoId;
  
  const query = `
    SELECT 
      mf.*,
      cf.nombre AS cuenta_nombre
    FROM MOVIMIENTO_FONDOS mf
    JOIN CUENTA_FONDOS cf ON mf.cuenta_id = cf.id
    WHERE mf.id = ? AND mf.tipo = 'EGRESO'
  `;
  
  db.query(query, [egresoId], (err, results) => {
    if (err) {
      console.error('Error al obtener el egreso:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el egreso" 
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Egreso no encontrado"
      });
    }
    
    res.json({ 
      success: true, 
      data: results[0]
    });
  });
};

// Función para registrar un nuevo egreso manual
const registrarEgreso = (req, res) => {
  const { cuenta_id, monto, origen, descripcion, referencia_id = null } = req.body;
  
  // Validaciones
  if (!cuenta_id || !monto || monto <= 0) {
    return res.status(400).json({
      success: false,
      message: "Faltan datos obligatorios o el monto es inválido"
    });
  }

  // 1. Primero insertamos el movimiento
  const insertQuery = `
    INSERT INTO movimiento_fondos (cuenta_id, tipo, origen, monto, referencia_id)
    VALUES (?, 'EGRESO', ?, ?, ?)
  `;
  
  db.query(
    insertQuery,
    [cuenta_id, origen || 'egreso manual', monto, referencia_id],
    (err, insertResults) => {
      if (err) {
        console.error('Error al insertar egreso:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al insertar el egreso" 
        });
      }
      
      // 2. Luego actualizamos el saldo de la cuenta
      const updateQuery = `
        UPDATE cuenta_fondos
        SET saldo = saldo - ?
        WHERE id = ?
      `;
      
      db.query(
        updateQuery,
        [monto, cuenta_id],
        (err, updateResults) => {
          if (err) {
            console.error('Error al actualizar saldo:', err);
            return res.status(500).json({ 
              success: false, 
              message: "Error al actualizar el saldo" 
            });
          }
          
          res.json({
            success: true,
            message: "Egreso registrado exitosamente",
            id: insertResults.insertId
          });
        }
      );
    }
  );
};




const obtenerBalanceGeneral = (req, res) => {
  const { anio } = req.query;
  
  // Si se proporciona un año, filtramos por ese año
  const filtroAnio = anio ? `WHERE YEAR(fecha) = ${anio}` : '';
  
  const query = `
    SELECT 
      DATE_FORMAT(fecha, '%Y-%m') AS mes,
      SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) AS egresos,
      SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END) - 
      SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) AS balance
    FROM movimiento_fondos
    ${filtroAnio}
    GROUP BY mes
    ORDER BY mes
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener balance general:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el balance general" 
      });
    }
    
    // Calcular totales
    const totales = {
      totalIngresos: 0,
      totalEgresos: 0,
      balanceTotal: 0
    };
    
    results.forEach(item => {
      totales.totalIngresos += parseFloat(item.ingresos);
      totales.totalEgresos += parseFloat(item.egresos);
      totales.balanceTotal += parseFloat(item.balance);
    });
    
    res.json({ 
      success: true, 
      data: results,
      totales
    });
  });
};

// Función para obtener el balance por tipo de cuenta
const obtenerBalancePorCuenta = (req, res) => {
  const { desde, hasta } = req.query;
  
  let filtroFecha = '';
  const params = [];
  
  if (desde && hasta) {
    filtroFecha = 'WHERE fecha BETWEEN ? AND ?';
    params.push(desde, hasta);
  } else if (desde) {
    filtroFecha = 'WHERE fecha >= ?';
    params.push(desde);
  } else if (hasta) {
    filtroFecha = 'WHERE fecha <= ?';
    params.push(hasta);
  }
  
  const query = `
    SELECT 
      cf.nombre AS cuenta,
      SUM(CASE WHEN mf.tipo = 'INGRESO' THEN mf.monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN mf.tipo = 'EGRESO' THEN mf.monto ELSE 0 END) AS egresos,
      SUM(CASE WHEN mf.tipo = 'INGRESO' THEN mf.monto ELSE 0 END) - 
      SUM(CASE WHEN mf.tipo = 'EGRESO' THEN mf.monto ELSE 0 END) AS balance
    FROM movimiento_fondos mf
    JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id
    ${filtroFecha}
    GROUP BY cf.nombre
    ORDER BY balance DESC
  `;
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener balance por cuenta:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el balance por cuenta" 
      });
    }
    
    res.json({ 
      success: true, 
      data: results
    });
  });
};

// Función para obtener la distribución de ingresos (ventas vs. ingresos manuales)
const obtenerDistribucionIngresos = (req, res) => {
  const { desde, hasta } = req.query;
  
  let filtroFecha = '';
  let params = [];
  
  if (desde && hasta) {
    filtroFecha = 'AND fecha BETWEEN ? AND ?';
    params.push(desde, hasta);
  } else if (desde) {
    filtroFecha = 'AND fecha >= ?';
    params.push(desde);
  } else if (hasta) {
    filtroFecha = 'AND fecha <= ?';
    params.push(hasta);
  }
  
  // Primero obtenemos el total de ventas
  const queryVentas = `
    SELECT SUM(total) AS total
    FROM ventas
    WHERE 1=1 ${filtroFecha}
  `;
  
  db.query(queryVentas, params, (err, ventasResults) => {
    if (err) {
      console.error('Error al obtener total de ventas:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el total de ventas" 
      });
    }
    
    const totalVentas = ventasResults[0].total || 0;
    
    // Luego obtenemos el total de ingresos manuales
    const queryIngresos = `
      SELECT SUM(monto) AS total
      FROM movimiento_fondos
      WHERE tipo = 'INGRESO' ${filtroFecha}
    `;
    
    db.query(queryIngresos, params, (err, ingresosResults) => {
      if (err) {
        console.error('Error al obtener total de ingresos manuales:', err);
        return res.status(500).json({ 
          success: false, 
          message: "Error al obtener el total de ingresos manuales" 
        });
      }
      
      const totalIngresosManuales = ingresosResults[0].total || 0;
      
      // Calculamos la distribución
      const distribucion = [
        { tipo: 'Ventas', valor: parseFloat(totalVentas) },
        { tipo: 'Ingresos Manuales', valor: parseFloat(totalIngresosManuales) }
      ];
      
      const total = parseFloat(totalVentas) + parseFloat(totalIngresosManuales);
      
      res.json({ 
        success: true, 
        data: distribucion,
        total
      });
    });
  });
};

// Función para obtener los principales gastos por categoría
const obtenerGastosPorCategoria = (req, res) => {
  const { desde, hasta, limite = 10 } = req.query;
  
  let filtroFecha = '';
  const params = [];
  
  if (desde && hasta) {
    filtroFecha = 'WHERE fecha BETWEEN ? AND ?';
    params.push(desde, hasta);
  } else if (desde) {
    filtroFecha = 'WHERE fecha >= ?';
    params.push(desde);
  } else if (hasta) {
    filtroFecha = 'WHERE fecha <= ?';
    params.push(hasta);
  }
  
  // Asumiendo que se ha agregado el campo 'categoria' a la tabla GASTOS
  // y que también queremos considerar los egresos de MOVIMIENTO_FONDOS
  const queryGastos = `
    SELECT 
      origen AS categoria,
      SUM(monto) AS total
    FROM movimiento_fondos
    WHERE tipo = 'EGRESO' 
    ${filtroFecha ? 'AND ' + filtroFecha.substring(6) : ''}
    GROUP BY origen
    ORDER BY total DESC
    LIMIT ${parseInt(limite)}
  `;
  
  db.query(queryGastos, params, (err, results) => {
    if (err) {
      console.error('Error al obtener gastos por categoría:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener gastos por categoría" 
      });
    }
    
    // Calcular el total para porcentajes
    const totalGastos = results.reduce((sum, item) => sum + parseFloat(item.total), 0);
    
    // Añadir porcentaje a cada categoría
    const dataConPorcentaje = results.map(item => ({
      ...item,
      porcentaje: (parseFloat(item.total) / totalGastos * 100).toFixed(2)
    }));
    
    res.json({ 
      success: true, 
      data: dataConPorcentaje,
      total: totalGastos
    });
  });
};

// Función para obtener el flujo de fondos por cuenta
const obtenerFlujoDeFondos = (req, res) => {
  const { desde, hasta, cuenta_id } = req.query;
  
  let filtro = '';
  const params = [];
  
  if (cuenta_id) {
    filtro = 'WHERE mf.cuenta_id = ?';
    params.push(cuenta_id);
  } else {
    filtro = 'WHERE 1=1';
  }
  
  if (desde) {
    filtro += ' AND fecha >= ?';
    params.push(desde);
  }
  
  if (hasta) {
    filtro += ' AND fecha <= ?';
    params.push(hasta);
  }
  
  const query = `
    SELECT 
      DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
      cf.nombre AS cuenta,
      tipo,
      origen,
      monto,
      (CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END) AS ingreso,
      (CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END) AS egreso
    FROM movimiento_fondos mf
    JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id
    ${filtro}
    ORDER BY fecha DESC, mf.id DESC
  `;
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener flujo de fondos:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el flujo de fondos" 
      });
    }
    
    // Calcular saldo acumulado
    let saldoAcumulado = 0;
    const dataConSaldo = [...results].reverse().map(item => {
      saldoAcumulado += parseFloat(item.ingreso) - parseFloat(item.egreso);
      return {
        ...item,
        saldo_acumulado: saldoAcumulado
      };
    }).reverse();
    
    // Calcular totales
    const totales = {
      totalIngresos: results.reduce((sum, item) => sum + parseFloat(item.ingreso), 0),
      totalEgresos: results.reduce((sum, item) => sum + parseFloat(item.egreso), 0),
      saldoFinal: saldoAcumulado
    };
    
    res.json({ 
      success: true, 
      data: dataConSaldo,
      totales
    });
  });
};

// Función para obtener años disponibles para filtros
const obtenerAniosDisponibles = (req, res) => {
  const query = `
    SELECT DISTINCT YEAR(fecha) as anio
    FROM movimiento_fondos
    ORDER BY anio DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener años disponibles:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener los años disponibles" 
      });
    }
    
    const anios = results.map(row => row.anio);
    
    res.json({ 
      success: true, 
      data: anios
    });
  });
};

const obtenerVentasPorVendedor = (req, res) => {
  const { desde, hasta } = req.query;
  const params = [];

  let filtro = '';
  if (desde && hasta) {
    filtro = 'WHERE fecha BETWEEN ? AND ?';
    params.push(desde, hasta);
  } else if (desde) {
    filtro = 'WHERE fecha >= ?';
    params.push(desde);
  } else if (hasta) {
    filtro = 'WHERE fecha <= ?';
    params.push(hasta);
  }

  const query = `
    SELECT 
      empleado_nombre,
      COUNT(*) AS cantidad_ventas,
      SUM(total) AS total_vendido
    FROM ventas
    ${filtro}
    GROUP BY empleado_nombre
    ORDER BY total_vendido DESC
  `;

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener ventas por vendedor:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener ventas por vendedor" 
      });
    }

    res.json({ 
      success: true, 
      data: results 
    });
  });
};

const obtenerProductosMasVendidos = (req, res) => {
  const { desde, hasta, limite = 10 } = req.query;

  let filtroFecha = '';
  const params = [];

  if (desde && hasta) {
    filtroFecha = 'WHERE v.fecha BETWEEN ? AND ?';
    params.push(desde, hasta);
  } else if (desde) {
    filtroFecha = 'WHERE v.fecha >= ?';
    params.push(desde);
  } else if (hasta) {
    filtroFecha = 'WHERE v.fecha <= ?';
    params.push(hasta);
  }

  const query = `
    SELECT 
      dv.producto_nombre,
      SUM(dv.cantidad) AS total_vendida
    FROM ventas_cont dv
    JOIN ventas v ON dv.venta_id = v.id
    ${filtroFecha}
    GROUP BY dv.producto_nombre
    ORDER BY total_vendida DESC
    LIMIT ?
  `;

  params.push(parseInt(limite));

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al obtener productos más vendidos:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener productos más vendidos" 
      });
    }

    res.json({ 
      success: true, 
      data: results 
    });
  });
};




// IMPORTANTE: Exportar todas las funciones
module.exports = {
  // Funciones de cuentas y movimientos
  obtenerCuentas,
  crearCuenta,
  obtenerCuenta,
  registrarMovimiento,
  obtenerMovimientos,
  realizarTransferencia,
  
  // Funciones de ingresos
  obtenerIngresos,
  obtenerCuentasParaFiltro, 
  registrarIngreso,
  obtenerDetalleVenta,
  obtenerDetalleIngreso,

  // Funciones de egresos
  obtenerEgresos,
  registrarEgreso,
  obtenerDetalleCompra,
  obtenerDetalleGasto,
  obtenerDetalleEgreso,

  // Funciones de reportes
  obtenerBalanceGeneral,
  obtenerBalancePorCuenta,
  obtenerDistribucionIngresos,
  obtenerGastosPorCategoria,
  obtenerFlujoDeFondos,
  obtenerAniosDisponibles,
  obtenerVentasPorVendedor,
  obtenerProductosMasVendidos
};
