const db = require('./db');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

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
  const { anio, desde, hasta } = req.query;
  const params = [];
  const where = [];

  if (anio) {
    where.push('YEAR(fecha) = ?');
    params.push(anio);
  }
  if (desde) {
    where.push('DATE(fecha) >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('DATE(fecha) <= ?');
    params.push(hasta);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const query = `
    SELECT
      DATE_FORMAT(fecha, '%Y-%m') AS mes,
      ROUND(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END), 2) AS ingresos,
      ROUND(SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END), 2) AS egresos,
      ROUND(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END) - SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END), 2) AS balance
    FROM movimiento_fondos
    ${whereSql}
    GROUP BY mes
    ORDER BY mes
  `;

  db.query(query, params, (err, results) => {
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
  
  let filtroFechaVentas = '';
  let filtroFechaMovs = '';
  const paramsVentas = [];
  const paramsMovs = [];
  
  if (desde && hasta) {
    filtroFechaVentas = 'AND DATE(COALESCE(fecha_fiscal, fecha)) BETWEEN ? AND ?';
    filtroFechaMovs = 'AND DATE(fecha) BETWEEN ? AND ?';
    paramsVentas.push(desde, hasta);
    paramsMovs.push(desde, hasta);
  } else if (desde) {
    filtroFechaVentas = 'AND DATE(COALESCE(fecha_fiscal, fecha)) >= ?';
    filtroFechaMovs = 'AND DATE(fecha) >= ?';
    paramsVentas.push(desde);
    paramsMovs.push(desde);
  } else if (hasta) {
    filtroFechaVentas = 'AND DATE(COALESCE(fecha_fiscal, fecha)) <= ?';
    filtroFechaMovs = 'AND DATE(fecha) <= ?';
    paramsVentas.push(hasta);
    paramsMovs.push(hasta);
  }
  
  const queryVentas = `
    SELECT 
      ROUND(COALESCE(SUM((CASE WHEN tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * total), 0), 2) AS total
    FROM ventas
    WHERE estado = 'Facturada'
      AND tipo_doc IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO')
      ${filtroFechaVentas}
  `;
  
  db.query(queryVentas, paramsVentas, (err, ventasResults) => {
    if (err) {
      console.error('Error al obtener total de ventas:', err);
      return res.status(500).json({ 
        success: false, 
        message: "Error al obtener el total de ventas" 
      });
    }
    
    const totalVentas = ventasResults[0].total || 0;
    
    const queryIngresos = `
      SELECT ROUND(COALESCE(SUM(monto), 0), 2) AS total
      FROM movimiento_fondos
      WHERE tipo = 'INGRESO'
        ${filtroFechaMovs}
        AND (
          referencia_id IS NULL
          OR (
            LOWER(COALESCE(origen, '')) NOT LIKE '%facturacion%'
            AND LOWER(COALESCE(origen, '')) NOT LIKE '%venta directa%'
          )
        )
    `;
    
    db.query(queryIngresos, paramsMovs, (err, ingresosResults) => {
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
  
  const queryGastos = `
    SELECT categoria, ROUND(SUM(total), 2) AS total
    FROM (
      SELECT
        COALESCE(NULLIF(g.descripcion, ''), 'Gasto operativo') AS categoria,
        g.monto AS total
      FROM gastos g
      ${filtroFecha.replace(/fecha/g, 'g.fecha')}
      UNION ALL
      SELECT
        'Compras' AS categoria,
        c.total AS total
      FROM compras c
      ${filtroFecha.replace(/fecha/g, 'c.fecha')}
      ${filtroFecha ? 'AND c.estado != \'Anulada\'' : 'WHERE c.estado != \'Anulada\''}
      UNION ALL
      SELECT
        COALESCE(NULLIF(mf.origen, ''), 'Egreso manual') AS categoria,
        mf.monto AS total
      FROM movimiento_fondos mf
      ${filtroFecha.replace(/fecha/g, 'mf.fecha')}
      ${filtroFecha ? 'AND mf.tipo = \'EGRESO\'' : 'WHERE mf.tipo = \'EGRESO\''}
    ) egresos_unificados
    GROUP BY categoria
    ORDER BY total DESC
    LIMIT ?
  `;
  
  db.query(queryGastos, [...params, parseInt(limite, 10)], (err, results) => {
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

const ejecutarQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const normalizarFiltrosReportes = (query = {}) => {
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const desde = query.desde || primerDiaMes.toISOString().split('T')[0];
  const hasta = query.hasta || hoy.toISOString().split('T')[0];

  return {
    desde,
    hasta,
    periodo: query.periodo || 'mensual',
    cuenta_id: query.cuenta_id || '',
    tipo_fiscal: query.tipo_fiscal || query.tipo_f || '',
    empleado_id: query.empleado_id || '',
    ciudad: query.ciudad || '',
    cliente_id: query.cliente_id || '',
    limite: Number(query.limite || 10),
    comparativo: query.comparativo || 'periodo_anterior'
  };
};

const validarRangoFechas = (desde, hasta) => {
  const d = new Date(desde);
  const h = new Date(hasta);
  if (isNaN(d.getTime()) || isNaN(h.getTime())) {
    return { ok: false, message: 'Formato de fecha inválido. Use YYYY-MM-DD' };
  }
  if (d > h) {
    return { ok: false, message: 'La fecha "desde" no puede ser mayor que "hasta"' };
  }
  return { ok: true, d, h };
};

const construirWhereVentas = (filtros, alias = 'v') => {
  const where = [
    `${alias}.estado = 'Facturada'`,
    `${alias}.tipo_doc IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO')`,
    `DATE(COALESCE(${alias}.fecha_fiscal, ${alias}.fecha)) >= ?`,
    `DATE(COALESCE(${alias}.fecha_fiscal, ${alias}.fecha)) <= ?`
  ];
  const params = [filtros.desde, filtros.hasta];

  if (filtros.cuenta_id && filtros.cuenta_id !== 'todas') {
    where.push(`${alias}.cuenta_id = ?`);
    params.push(filtros.cuenta_id);
  }
  if (filtros.tipo_fiscal) {
    where.push(`${alias}.tipo_f = ?`);
    params.push(filtros.tipo_fiscal);
  }
  if (filtros.empleado_id) {
    where.push(`${alias}.empleado_id = ?`);
    params.push(filtros.empleado_id);
  }
  if (filtros.ciudad) {
    where.push(`${alias}.cliente_ciudad = ?`);
    params.push(filtros.ciudad);
  }
  if (filtros.cliente_id) {
    where.push(`${alias}.cliente_id = ?`);
    params.push(filtros.cliente_id);
  }

  return {
    whereSql: where.join(' AND '),
    params
  };
};

const obtenerFormatoPeriodo = (periodo, fechaDesde, fechaHasta) => {
  const dias = Math.ceil((fechaHasta - fechaDesde) / (1000 * 60 * 60 * 24)) + 1;
  if (periodo === 'anual' || dias > 365) return { formato: '%Y', tipo: 'anual' };
  if (periodo === 'mensual' || dias > 60) return { formato: '%Y-%m', tipo: 'mensual' };
  return { formato: '%Y-%m-%d', tipo: 'diario' };
};

const obtenerVentasPorVendedor = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const query = `
      WITH ventas_filtradas AS (
        SELECT
          v.id,
          v.empleado_id,
          COALESCE(NULLIF(v.empleado_nombre, ''), 'Sin vendedor') AS empleado_nombre,
          (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total AS total_neto
        FROM ventas v
        WHERE ${whereSql}
      ),
      costo_por_venta AS (
        SELECT
          v.id AS venta_id,
          SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)) AS costo_neto
        FROM ventas v
        JOIN ventas_cont vc ON vc.venta_id = v.id
        LEFT JOIN productos p ON p.id = vc.producto_id
        WHERE ${whereSql}
        GROUP BY v.id
      )
      SELECT
        vf.empleado_id,
        vf.empleado_nombre,
        SUM(CASE WHEN vf.total_neto > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM(vf.total_neto), 2) AS total_vendido,
        ROUND(AVG(CASE WHEN vf.total_neto > 0 THEN vf.total_neto END), 2) AS ticket_promedio,
        ROUND(SUM(vf.total_neto - COALESCE(cv.costo_neto, 0)), 2) AS ganancia_generada
      FROM ventas_filtradas vf
      LEFT JOIN costo_por_venta cv ON cv.venta_id = vf.id
      GROUP BY vf.empleado_id, vf.empleado_nombre
      ORDER BY total_vendido DESC
    `;

    const data = await ejecutarQuery(query, [...params, ...params]);
    res.json({ success: true, data, filtrosAplicados: filtros });
  } catch (error) {
    console.error('Error al obtener ventas por vendedor:', error);
    res.status(500).json({ success: false, message: 'Error al obtener ventas por vendedor' });
  }
};

const obtenerProductosMasVendidos = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const query = `
      SELECT
        vc.producto_id,
        vc.producto_nombre,
        ROUND(SUM(vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS total_vendida,
        ROUND(SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ingresos_netos,
        COUNT(DISTINCT v.id) AS documentos
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      WHERE ${whereSql}
      GROUP BY vc.producto_id, vc.producto_nombre
      HAVING total_vendida > 0
      ORDER BY total_vendida DESC
      LIMIT ?
    `;

    const data = await ejecutarQuery(query, [...params, filtros.limite]);
    res.json({ success: true, data, filtrosAplicados: filtros });
  } catch (error) {
    console.error('Error al obtener productos más vendidos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener productos más vendidos' });
  }
};

const obtenerGananciasDetalladas = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { formato, tipo } = obtenerFormatoPeriodo(filtros.periodo, validacion.d, validacion.h);
    const { whereSql, params } = construirWhereVentas(filtros, 'v');

    const query = `
      WITH ventas_filtradas AS (
        SELECT
          v.id,
          DATE(COALESCE(v.fecha_fiscal, v.fecha)) AS fecha_ref,
          (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total AS ingreso_neto
        FROM ventas v
        WHERE ${whereSql}
      ),
      costo_por_venta AS (
        SELECT
          v.id AS venta_id,
          SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)) AS costo_neto
        FROM ventas v
        JOIN ventas_cont vc ON vc.venta_id = v.id
        LEFT JOIN productos p ON p.id = vc.producto_id
        WHERE ${whereSql}
        GROUP BY v.id
      )
      SELECT
        DATE_FORMAT(vf.fecha_ref, '${formato}') AS periodo,
        SUM(CASE WHEN vf.ingreso_neto > 0 THEN 1 ELSE 0 END) AS total_ventas,
        ROUND(SUM(vf.ingreso_neto), 2) AS ingresos_totales,
        ROUND(SUM(vf.ingreso_neto - COALESCE(cv.costo_neto, 0)), 2) AS ganancia_estimada,
        ROUND(AVG(CASE WHEN vf.ingreso_neto > 0 THEN vf.ingreso_neto END), 2) AS factura_promedio
      FROM ventas_filtradas vf
      LEFT JOIN costo_por_venta cv ON cv.venta_id = vf.id
      GROUP BY DATE_FORMAT(vf.fecha_ref, '${formato}')
      ORDER BY periodo ASC
    `;

    const data = await ejecutarQuery(query, [...params, ...params]);
    const totales = data.reduce((acc, row) => {
      acc.total_ventas += Number(row.total_ventas || 0);
      acc.ingresos_totales += Number(row.ingresos_totales || 0);
      acc.ganancia_estimada += Number(row.ganancia_estimada || 0);
      return acc;
    }, { total_ventas: 0, ingresos_totales: 0, ganancia_estimada: 0 });

    res.json({
      success: true,
      data,
      totales,
      periodo: tipo,
      filtrosAplicados: filtros
    });
  } catch (error) {
    console.error('Error al obtener ganancias detalladas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener ganancias detalladas' });
  }
};



const obtenerTopProductosTabla = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');

    const query = `
      SELECT 
        vc.producto_id,
        vc.producto_nombre,
        c.nombre as categoria,
        p.costo,
        ROUND(AVG(vc.precio), 2) as precio_promedio,
        ROUND(SUM(vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) as cantidad_vendida,
        ROUND(SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) as ingresos_producto,
        SUM(
          CASE 
            WHEN p.costo > 0 AND p.costo IS NOT NULL
            THEN (vc.precio - p.costo) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)
            ELSE vc.precio * vc.cantidad * 0.25 * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)
          END
        ) as ganancia_total,
        (
          CASE 
            WHEN p.costo > 0 AND p.costo IS NOT NULL 
            THEN 'Con costo'
            ELSE 'Estimado'
          END
        ) as tipo_calculo
      FROM ventas_cont vc
      JOIN ventas v ON vc.venta_id = v.id
      LEFT JOIN productos p ON vc.producto_id = p.id
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE ${whereSql}
      GROUP BY vc.producto_id, vc.producto_nombre, c.nombre, p.costo
      ORDER BY ganancia_total DESC
    `;

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('Error obteniendo top productos tabla:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al obtener top productos tabla'
        });
      }

      res.json({
        success: true,
        data: results,
        filtrosAplicados: filtros
      });
    });

  } catch (error) {
    console.error('Error obteniendo top productos tabla:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener top productos tabla'
    });
  }
};


const obtenerGananciasPorProducto = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const query = `
      SELECT 
        vc.producto_id,
        vc.producto_nombre,
        ROUND(AVG(vc.precio), 2) AS precio_promedio,
        ROUND(SUM(vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS cantidad_total_vendida,
        ROUND(SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ingresos_producto,
        ROUND(SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS costo_producto,
        ROUND(SUM((vc.precio - COALESCE(p.costo, 0)) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ganancia_estimada,
        ROUND(
          CASE WHEN SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)) = 0 THEN 0
               ELSE (
                 SUM((vc.precio - COALESCE(p.costo, 0)) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END))
                 /
                 SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END))
               ) * 100
          END, 2
        ) AS margen_ganancia_porcentaje
      FROM ventas_cont vc
      JOIN ventas v ON vc.venta_id = v.id
      LEFT JOIN productos p ON vc.producto_id = p.id
      WHERE ${whereSql}
      GROUP BY vc.producto_id, vc.producto_nombre
      HAVING cantidad_total_vendida > 0
      ORDER BY ganancia_estimada DESC
      LIMIT ?
    `;

    const data = await ejecutarQuery(query, [...params, filtros.limite]);
    res.json({ success: true, data, filtrosAplicados: filtros });
  } catch (error) {
    console.error('Error obteniendo ganancias por producto:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener ganancias por producto'
    });
  }
};

const obtenerGananciasPorCiudad = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const query = `
      WITH ventas_filtradas AS (
        SELECT
          v.id,
          COALESCE(v.cliente_ciudad, 'Sin ciudad') AS ciudad,
          COALESCE(v.cliente_provincia, 'Sin provincia') AS provincia,
          v.cliente_id,
          (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total AS ingreso_neto
        FROM ventas v
        WHERE ${whereSql}
      ),
      costo_por_venta AS (
        SELECT
          v.id AS venta_id,
          SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)) AS costo_neto
        FROM ventas v
        JOIN ventas_cont vc ON vc.venta_id = v.id
        LEFT JOIN productos p ON p.id = vc.producto_id
        WHERE ${whereSql}
        GROUP BY v.id
      )
      SELECT
        vf.ciudad,
        vf.provincia,
        SUM(CASE WHEN vf.ingreso_neto > 0 THEN 1 ELSE 0 END) AS total_ventas,
        COUNT(DISTINCT vf.cliente_id) AS clientes_unicos,
        ROUND(SUM(vf.ingreso_neto), 2) AS ingresos_totales,
        ROUND(SUM(vf.ingreso_neto - COALESCE(cv.costo_neto, 0)), 2) AS ganancia_estimada,
        ROUND(AVG(CASE WHEN vf.ingreso_neto > 0 THEN vf.ingreso_neto END), 2) AS factura_promedio,
        ROUND(
          CASE WHEN SUM(vf.ingreso_neto) = 0 THEN 0
               ELSE (SUM(vf.ingreso_neto - COALESCE(cv.costo_neto, 0)) / SUM(vf.ingreso_neto)) * 100
          END, 2
        ) AS margen_promedio
      FROM ventas_filtradas vf
      LEFT JOIN costo_por_venta cv ON cv.venta_id = vf.id
      GROUP BY vf.ciudad, vf.provincia
      ORDER BY ganancia_estimada DESC
      LIMIT ?
    `;

    const data = await ejecutarQuery(query, [...params, ...params, filtros.limite]);
    const ingresosTotales = data.reduce((acc, item) => acc + Number(item.ingresos_totales || 0), 0);
    const dataConPorcentaje = data.map(item => ({
      ...item,
      porcentaje_ingresos: ingresosTotales > 0 ? Number((Number(item.ingresos_totales) / ingresosTotales) * 100).toFixed(1) : 0
    }));

    res.json({
      success: true,
      data: dataConPorcentaje,
      info: {
        total_ciudades: data.length,
        ciudad_top: data[0]?.ciudad || 'N/A',
        ingresos_totales: ingresosTotales
      },
      filtrosAplicados: filtros
    });
  } catch (error) {
    console.error('💥 Error en obtenerGananciasPorCiudad:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
};

const obtenerResumenFinanciero = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const fechaParams = [filtros.desde, filtros.hasta];

    const queryVentas = `
      SELECT
        SUM(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS monto_total_ventas,
        ROUND(AVG(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
    `;

    const queryCostos = `
      SELECT
        ROUND(SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS costo_total,
        COUNT(DISTINCT CASE WHEN p.costo > 0 THEN p.id END) AS productos_con_costo,
        COUNT(DISTINCT p.id) AS productos_totales
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      LEFT JOIN productos p ON p.id = vc.producto_id
      WHERE ${whereSql}
    `;

    const queryCompras = `
      SELECT
        COUNT(*) AS cantidad_compras,
        ROUND(COALESCE(SUM(total), 0), 2) AS monto_total_compras
      FROM compras
      WHERE DATE(fecha) >= ? AND DATE(fecha) <= ?
      AND estado != 'Anulada'
    `;

    const queryGastos = `
      SELECT
        COUNT(*) AS cantidad_gastos,
        ROUND(COALESCE(SUM(monto), 0), 2) AS monto_total_gastos
      FROM gastos
      WHERE DATE(fecha) >= ? AND DATE(fecha) <= ?
    `;

    const [ventasRow, costosRow, comprasRow, gastosRow] = await Promise.all([
      ejecutarQuery(queryVentas, params).then(r => r[0] || {}),
      ejecutarQuery(queryCostos, params).then(r => r[0] || {}),
      ejecutarQuery(queryCompras, fechaParams).then(r => r[0] || {}),
      ejecutarQuery(queryGastos, fechaParams).then(r => r[0] || {})
    ]);

    const ingresosTotales = Number(ventasRow.monto_total_ventas || 0);
    const costoVentas = Number(costosRow.costo_total || 0);
    const comprasTotales = Number(comprasRow.monto_total_compras || 0);
    const gastosTotales = Number(gastosRow.monto_total_gastos || 0);
    const egresosTotales = comprasTotales + gastosTotales;

    const gananciaBruta = ingresosTotales - costoVentas;
    const gananciaNeta = gananciaBruta - gastosTotales;
    const resultadoNeto = ingresosTotales - egresosTotales;

    const resumen = {
      periodo: {
        desde: filtros.desde,
        hasta: filtros.hasta,
        dias: Math.ceil((validacion.h - validacion.d) / (1000 * 60 * 60 * 24)) + 1
      },
      ventas: {
        cantidad: Number(ventasRow.cantidad_ventas || 0),
        monto_total: ingresosTotales,
        ticket_promedio: Number(ventasRow.ticket_promedio || 0)
      },
      egresos: {
        compras: {
          cantidad: Number(comprasRow.cantidad_compras || 0),
          monto: comprasTotales
        },
        gastos: {
          cantidad: Number(gastosRow.cantidad_gastos || 0),
          monto: gastosTotales
        },
        total: egresosTotales
      },
      ganancias: {
        ganancia_bruta: gananciaBruta,
        ganancia_neta: gananciaNeta,
        margen_bruto: ingresosTotales > 0 ? (gananciaBruta / ingresosTotales) * 100 : 0,
        margen_neto: ingresosTotales > 0 ? (gananciaNeta / ingresosTotales) * 100 : 0,
        productos_con_costo: Number(costosRow.productos_con_costo || 0),
        productos_totales: Number(costosRow.productos_totales || 0)
      },
      resultado: {
        resultado_neto: resultadoNeto,
        rentabilidad: ingresosTotales > 0 ? (resultadoNeto / ingresosTotales) * 100 : 0,
        estado: resultadoNeto >= 0 ? 'POSITIVO' : 'NEGATIVO'
      }
    };

    res.json({ success: true, data: resumen, filtrosAplicados: filtros });
  } catch (error) {
    console.error('💥 Error obteniendo resumen financiero:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener resumen financiero: ' + error.message
    });
  }
};


const obtenerGananciasPorEmpleado = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const query = `
      WITH ventas_filtradas AS (
        SELECT
          v.id,
          v.empleado_id,
          COALESCE(NULLIF(v.empleado_nombre, ''), 'Sin vendedor') AS empleado_nombre,
          v.cliente_id,
          DATE(COALESCE(v.fecha_fiscal, v.fecha)) AS fecha_ref,
          (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total AS ingreso_neto
        FROM ventas v
        WHERE ${whereSql}
      ),
      costo_por_venta AS (
        SELECT
          v.id AS venta_id,
          SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)) AS costo_neto
        FROM ventas v
        JOIN ventas_cont vc ON vc.venta_id = v.id
        LEFT JOIN productos p ON p.id = vc.producto_id
        WHERE ${whereSql}
        GROUP BY v.id
      )
      SELECT
        vf.empleado_id,
        vf.empleado_nombre,
        SUM(CASE WHEN vf.ingreso_neto > 0 THEN 1 ELSE 0 END) AS total_ventas,
        ROUND(SUM(vf.ingreso_neto), 2) AS ingresos_generados,
        ROUND(SUM(vf.ingreso_neto - COALESCE(cv.costo_neto, 0)), 2) AS ganancia_generada,
        ROUND(AVG(CASE WHEN vf.ingreso_neto > 0 THEN vf.ingreso_neto END), 2) AS factura_promedio,
        MIN(vf.fecha_ref) AS primera_venta,
        MAX(vf.fecha_ref) AS ultima_venta,
        COUNT(DISTINCT vf.cliente_id) AS clientes_atendidos,
        ROUND(
          CASE WHEN SUM(vf.ingreso_neto) = 0 THEN 0
               ELSE (SUM(vf.ingreso_neto - COALESCE(cv.costo_neto, 0)) / SUM(vf.ingreso_neto)) * 100
          END, 2
        ) AS margen_promedio
      FROM ventas_filtradas vf
      LEFT JOIN costo_por_venta cv ON cv.venta_id = vf.id
      GROUP BY vf.empleado_id, vf.empleado_nombre
      ORDER BY ganancia_generada DESC
    `;

    const data = await ejecutarQuery(query, [...params, ...params]);
    res.json({
      success: true,
      data,
      info: {
        total_empleados: data.length,
        empleado_top: data[0]?.empleado_nombre || 'N/A'
      },
      filtrosAplicados: filtros
    });
  } catch (error) {
    console.error('💥 Error en obtenerGananciasPorEmpleado:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
};

const obtenerProductosMasRentables = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const query = `
      SELECT 
        vc.producto_id,
        vc.producto_nombre,
        ROUND(AVG(vc.precio), 2) AS precio_promedio,
        ROUND(SUM(vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS cantidad_vendida,
        ROUND(SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ingresos_producto,
        ROUND(SUM((vc.precio - COALESCE(p.costo, 0)) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ganancia_total,
        ROUND(
          CASE WHEN SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)) = 0 THEN 0
               ELSE (
                 SUM((vc.precio - COALESCE(p.costo, 0)) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END))
                 /
                 SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END))
               ) * 100
          END, 2
        ) AS margen_porcentaje
      FROM ventas_cont vc
      JOIN ventas v ON vc.venta_id = v.id
      LEFT JOIN productos p ON vc.producto_id = p.id
      WHERE ${whereSql}
      GROUP BY vc.producto_id, vc.producto_nombre
      HAVING cantidad_vendida > 0
      ORDER BY margen_porcentaje DESC, ganancia_total DESC
      LIMIT ?
    `;

    const data = await ejecutarQuery(query, [...params, filtros.limite]);
    res.json({ success: true, data, filtrosAplicados: filtros });
  } catch (error) {
    console.error('Error obteniendo productos más rentables:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener productos más rentables'
    });
  }
};


const verificarDisponibilidadDatos = async (req, res) => {
  try {
    const queryEstadisticas = `
      SELECT 
        'ventas' as tabla,
        COUNT(*) as total_registros,
        MIN(fecha) as fecha_minima,
        MAX(fecha) as fecha_maxima
      FROM ventas
      UNION ALL
      SELECT 
        'gastos' as tabla,
        COUNT(*) as total_registros,
        MIN(fecha) as fecha_minima,
        MAX(fecha) as fecha_maxima
      FROM gastos
      UNION ALL
      SELECT 
        'compras' as tabla,
        COUNT(*) as total_registros,
        MIN(fecha) as fecha_minima,
        MAX(fecha) as fecha_maxima
      FROM compras
      UNION ALL
      SELECT 
        'movimientos' as tabla,
        COUNT(*) as total_registros,
        MIN(fecha) as fecha_minima,
        MAX(fecha) as fecha_maxima
      FROM movimiento_fondos
    `;

    db.query(queryEstadisticas, (err, results) => {
      if (err) {
        console.error('❌ Error verificando disponibilidad de datos:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al verificar disponibilidad de datos'
        });
      }

      const estadisticas = {};
      results.forEach(row => {
        estadisticas[row.tabla] = {
          total_registros: row.total_registros,
          fecha_minima: row.fecha_minima,
          fecha_maxima: row.fecha_maxima,
          tiene_datos: row.total_registros > 0
        };
      });

      res.json({
        success: true,
        data: estadisticas,
        recomendaciones: {
          periodo_sugerido: estadisticas.ventas.tiene_datos ? {
            desde: estadisticas.ventas.fecha_minima,
            hasta: estadisticas.ventas.fecha_maxima
          } : null,
          mensaje: estadisticas.ventas.total_registros === 0 
            ? 'No hay datos de ventas registrados. Registra algunas ventas para ver estadísticas.'
            : `Tienes ${estadisticas.ventas.total_registros} ventas registradas desde ${estadisticas.ventas.fecha_minima}`
        }
      });
    });

  } catch (error) {
    console.error('💥 Error en verificarDisponibilidadDatos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al verificar disponibilidad de datos'
    });
  }
};

const obtenerDashboardSimplificado = async (req, res) => {
  try {
    const filtros = normalizarFiltrosReportes(req.query);
    const validacion = validarRangoFechas(filtros.desde, filtros.hasta);
    if (!validacion.ok) {
      return res.status(400).json({ success: false, message: validacion.message });
    }

    const { whereSql, params } = construirWhereVentas(filtros, 'v');
    const diasPeriodo = Math.ceil((validacion.h - validacion.d) / (1000 * 60 * 60 * 24)) + 1;
    const fechaDesdeAnterior = new Date(validacion.d);
    fechaDesdeAnterior.setDate(fechaDesdeAnterior.getDate() - diasPeriodo);
    const fechaHastaAnterior = new Date(validacion.d);
    fechaHastaAnterior.setDate(fechaHastaAnterior.getDate() - 1);
    const filtrosAnterior = {
      ...filtros,
      desde: fechaDesdeAnterior.toISOString().split('T')[0],
      hasta: fechaHastaAnterior.toISOString().split('T')[0]
    };
    const whereAnterior = construirWhereVentas(filtrosAnterior, 'v');

    const queryVentas = `
      SELECT
        SUM(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS monto_ventas,
        ROUND(AVG(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
    `;

    const queryVentasAnterior = `
      SELECT
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS monto_ventas
      FROM ventas v
      WHERE ${whereAnterior.whereSql}
    `;

    const queryCostos = `
      SELECT
        ROUND(SUM(COALESCE(p.costo, 0) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS costo_ventas
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      LEFT JOIN productos p ON p.id = vc.producto_id
      WHERE ${whereSql}
    `;

    const queryComprasYGastos = `
      SELECT
        (SELECT ROUND(COALESCE(SUM(total), 0), 2) FROM compras WHERE DATE(fecha) >= ? AND DATE(fecha) <= ? AND estado != 'Anulada') AS compras_total,
        (SELECT ROUND(COALESCE(SUM(monto), 0), 2) FROM gastos WHERE DATE(fecha) >= ? AND DATE(fecha) <= ?) AS gastos_total
    `;

    const queryTopProductos = `
      SELECT
        vc.producto_nombre,
        ROUND(SUM(vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS cantidad_vendida,
        ROUND(SUM(vc.precio * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ingresos_generados,
        ROUND(SUM((vc.precio - COALESCE(p.costo, 0)) * vc.cantidad * (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)), 2) AS ganancia_generada
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      LEFT JOIN productos p ON p.id = vc.producto_id
      WHERE ${whereSql}
      GROUP BY vc.producto_nombre
      HAVING cantidad_vendida > 0
      ORDER BY ganancia_generada DESC
      LIMIT 5
    `;

    const queryVendedores = `
      SELECT
        COALESCE(NULLIF(v.empleado_nombre, ''), 'Sin vendedor') AS empleado_nombre,
        SUM(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS monto_total_ventas,
        ROUND(AVG(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
      GROUP BY COALESCE(NULLIF(v.empleado_nombre, ''), 'Sin vendedor')
      ORDER BY monto_total_ventas DESC
      LIMIT 10
    `;

    const queryClientes = `
      SELECT
        COALESCE(NULLIF(v.cliente_nombre, ''), 'Sin cliente') AS cliente_nombre,
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS monto_total,
        SUM(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(AVG(CASE WHEN (CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
      GROUP BY COALESCE(NULLIF(v.cliente_nombre, ''), 'Sin cliente')
      ORDER BY monto_total DESC
      LIMIT 10
    `;

    const queryCiudades = `
      SELECT
        COALESCE(v.cliente_ciudad, 'Sin ciudad') AS ciudad,
        COALESCE(v.cliente_provincia, 'Sin provincia') AS provincia,
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS monto_total,
        COUNT(DISTINCT v.cliente_id) AS clientes_unicos
      FROM ventas v
      WHERE ${whereSql}
      GROUP BY COALESCE(v.cliente_ciudad, 'Sin ciudad'), COALESCE(v.cliente_provincia, 'Sin provincia')
      ORDER BY monto_total DESC
      LIMIT 10
    `;

    const queryCuentas = `
      SELECT
        cf.id,
        cf.nombre,
        ROUND(SUM((CASE WHEN v.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END) * v.total), 2) AS facturacion_neta
      FROM ventas v
      JOIN cuenta_fondos cf ON cf.id = v.cuenta_id
      WHERE ${whereSql}
      GROUP BY cf.id, cf.nombre
      ORDER BY facturacion_neta DESC
    `;

    const [ventasRow, ventasAnteriorRow, costosRow, comprasGastosRow, topProductos, vendedores, clientes, ciudades, cuentas] = await Promise.all([
      ejecutarQuery(queryVentas, params).then(r => r[0] || {}),
      ejecutarQuery(queryVentasAnterior, whereAnterior.params).then(r => r[0] || {}),
      ejecutarQuery(queryCostos, params).then(r => r[0] || {}),
      ejecutarQuery(queryComprasYGastos, [filtros.desde, filtros.hasta, filtros.desde, filtros.hasta]).then(r => r[0] || {}),
      ejecutarQuery(queryTopProductos, params),
      ejecutarQuery(queryVendedores, params),
      ejecutarQuery(queryClientes, params),
      ejecutarQuery(queryCiudades, params),
      ejecutarQuery(queryCuentas, params)
    ]);

    const ventasMonto = Number(ventasRow.monto_ventas || 0);
    const ventasCantidad = Number(ventasRow.cantidad_ventas || 0);
    const costoVentas = Number(costosRow.costo_ventas || 0);
    const comprasTotal = Number(comprasGastosRow.compras_total || 0);
    const gastosTotal = Number(comprasGastosRow.gastos_total || 0);
    const egresosTotal = comprasTotal + gastosTotal;
    const margenBruto = ventasMonto - costoVentas;
    const margenNeto = margenBruto - gastosTotal;
    const resultadoNeto = ventasMonto - egresosTotal;

    const ventasAnterior = Number(ventasAnteriorRow.monto_ventas || 0);
    const diferencia = ventasMonto - ventasAnterior;
    const porcentajeCambio = ventasAnterior > 0 ? (diferencia / ventasAnterior) * 100 : 0;

    const dashboard = {
      periodo: {
        desde: filtros.desde,
        hasta: filtros.hasta,
        dias: diasPeriodo
      },
      kpis: {
        facturacion_neta: ventasMonto,
        cantidad_ventas: ventasCantidad,
        ticket_promedio: Number(ventasRow.ticket_promedio || 0),
        margen_bruto: margenBruto,
        margen_neto: margenNeto,
        compras_total: comprasTotal,
        gastos_total: gastosTotal,
        resultado_neto: resultadoNeto
      },
      resumen: {
        ventas: {
          cantidad: ventasCantidad,
          monto: ventasMonto,
          ticket_promedio: Number(ventasRow.ticket_promedio || 0)
        },
        egresos: {
          compras: comprasTotal,
          gastos: gastosTotal,
          total: egresosTotal
        },
        ganancias: {
          bruta: margenBruto,
          neta: margenNeto,
          margen_bruto: ventasMonto > 0 ? (margenBruto / ventasMonto) * 100 : 0,
          margen_neto: ventasMonto > 0 ? (margenNeto / ventasMonto) * 100 : 0
        },
        resultado_neto: resultadoNeto,
        estado: resultadoNeto >= 0 ? 'GANANCIA' : 'PERDIDA'
      },
      comparacion_periodo_anterior: {
        ventas_actuales: ventasMonto,
        ventas_anteriores: ventasAnterior,
        diferencia,
        porcentaje_cambio: porcentajeCambio,
        tendencia: porcentajeCambio > 0 ? 'MEJORA' : porcentajeCambio < 0 ? 'DISMINUCION' : 'IGUAL'
      },
      top_productos: topProductos.map(p => ({
        nombre: p.producto_nombre,
        cantidad_vendida: Number(p.cantidad_vendida || 0),
        ingresos: Number(p.ingresos_generados || 0),
        ganancia: Number(p.ganancia_generada || 0)
      })),
      vendedores: vendedores.map(v => ({
        nombre: v.empleado_nombre,
        cantidad_ventas: Number(v.cantidad_ventas || 0),
        monto_total: Number(v.monto_total_ventas || 0),
        ticket_promedio: Number(v.ticket_promedio || 0)
      })),
      clientes: clientes.map(c => ({
        nombre: c.cliente_nombre,
        monto_total: Number(c.monto_total || 0),
        cantidad_ventas: Number(c.cantidad_ventas || 0),
        ticket_promedio: Number(c.ticket_promedio || 0)
      })),
      ciudades: ciudades.map(c => ({
        ciudad: c.ciudad,
        provincia: c.provincia,
        monto_total: Number(c.monto_total || 0),
        clientes_unicos: Number(c.clientes_unicos || 0)
      })),
      cuentas: cuentas.map(c => ({
        id: c.id,
        nombre: c.nombre,
        facturacion_neta: Number(c.facturacion_neta || 0)
      })),
      alertas: []
    };

    if (resultadoNeto < 0) {
      dashboard.alertas.push({
        tipo: 'CRITICO',
        mensaje: `Resultado neto negativo: ${Math.abs(resultadoNeto).toFixed(2)}`
      });
    }
    if (porcentajeCambio < -20) {
      dashboard.alertas.push({
        tipo: 'ADVERTENCIA',
        mensaje: `Facturacion en baja ${Math.abs(porcentajeCambio).toFixed(1)}% vs periodo anterior`
      });
    }
    if (ventasCantidad === 0) {
      dashboard.alertas.push({
        tipo: 'INFO',
        mensaje: 'No hay ventas registradas para el filtro actual'
      });
    }

    res.json({ success: true, data: dashboard, filtrosAplicados: filtros });
  } catch (error) {
    console.error('💥 Error generando dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar dashboard: ' + error.message
    });
  }
};


// ✅ NUEVO: Generar PDF del reporte financiero
const generarPDFReporteFinanciero = async (req, res) => {
  try {
    let { desde, hasta } = req.query;
    
    console.log('📄 Generando PDF de reporte financiero...');
    
    // ✅ Autocompletar fechas si no existen
    if (!desde || !hasta) {
      const ahora = new Date();
      const hace30Dias = new Date();
      hace30Dias.setDate(ahora.getDate() - 30);
      
      desde = desde || hace30Dias.toISOString().split('T')[0];
      hasta = hasta || ahora.toISOString().split('T')[0];
    }
    
    // ✅ Obtener datos del dashboard simplificado
    const dashboardData = await new Promise((resolve, reject) => {
      obtenerDashboardSimplificado(
        { query: { desde, hasta } },
        {
          json: (data) => {
            if (data.success) {
              resolve(data.data);
            } else {
              reject(new Error(data.message || 'Error obteniendo datos'));
            }
          },
          status: (code) => ({
            json: (data) => reject(new Error(data.message || `Error ${code}`))
          })
        }
      );
    });
    
    // ✅ Generar PDF
    const pdfGenerator = require('../utils/pdfGenerator');
    const pdfBuffer = await pdfGenerator.generarReporteFinanciero(dashboardData);
    
    // ✅ Nombre del archivo
    const fechaActual = new Date().toISOString().split('T')[0];
    const nombreArchivo = `reporte_financiero_${fechaActual}.pdf`;
    
    // ✅ Enviar PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    console.log(`✅ PDF generado exitosamente: ${nombreArchivo} (${pdfBuffer.length} bytes)`);
    
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('💥 Error generando PDF de reporte financiero:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar PDF del reporte financiero: ' + error.message
    });
  }
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
  obtenerProductosMasVendidos,
  obtenerGananciasDetalladas,
  obtenerGananciasPorProducto,
  obtenerGananciasPorEmpleado,
  obtenerGananciasPorCiudad,
  obtenerResumenFinanciero,
  obtenerProductosMasRentables,
  verificarDisponibilidadDatos,
  obtenerTopProductosTabla,
  // ✅ NUEVOS
  obtenerDashboardSimplificado,
  generarPDFReporteFinanciero
};
