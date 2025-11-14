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
    
  `;

  

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



const obtenerGananciasDetalladas = async (req, res) => {
  try {
    let { desde, hasta, periodo = 'mensual' } = req.query;
    
    // ✅ AUTOCOMPLETAR FECHAS SI FALTAN
    if (!desde || !hasta) {
      const ahora = new Date();
      const primerDiaDelMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      
      desde = desde || primerDiaDelMes.toISOString().split('T')[0];
      hasta = hasta || ahora.toISOString().split('T')[0];
    }
    
    console.log('🔍 Obteniendo ganancias detalladas:', { desde, hasta, periodo });
    
    // ✅ VALIDACIÓN DE FECHAS
    const fechaDesde = new Date(desde);
    const fechaHasta = new Date(hasta);
    
    if (isNaN(fechaDesde.getTime()) || isNaN(fechaHasta.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Formato de fecha inválido'
      });
    }

    if (fechaDesde > fechaHasta) {
      return res.status(400).json({
        success: false,
        message: 'La fecha desde no puede ser mayor que hasta'
      });
    }

    // ✅ CONFIGURACIÓN MEJORADA PARA PERÍODO
    let dateFormat, groupBy;
    const diasEnPeriodo = Math.ceil((fechaHasta - fechaDesde) / (1000 * 60 * 60 * 24));
    
    // ✅ LÓGICA INTELIGENTE PARA PERÍODO
    if (periodo === 'anual' || diasEnPeriodo > 365) {
      // Para períodos muy largos, agrupar por año
      dateFormat = '%Y';
      groupBy = 'YEAR(v.fecha)';
    } else if (periodo === 'mensual' || diasEnPeriodo > 60) {
      // Para períodos medianos, agrupar por mes
      dateFormat = '%Y-%m';
      groupBy = 'DATE_FORMAT(v.fecha, \'%Y-%m\')';
    } else {
      // Para períodos cortos, agrupar por día
      dateFormat = '%Y-%m-%d';
      groupBy = 'DATE(v.fecha)';
    }

    // ✅ FILTRO DE FECHA CORREGIDO
    const filtroFecha = 'WHERE v.fecha BETWEEN ? AND ?';

    const query = `
      SELECT 
        DATE_FORMAT(v.fecha, '${dateFormat}') as periodo,
        COUNT(v.id) as total_ventas,
        COALESCE(SUM(v.total), 0) as ingresos_totales,
        COALESCE(SUM(
          CASE 
            WHEN p.costo > 0 AND p.costo IS NOT NULL 
            THEN (vc.precio - p.costo) * vc.cantidad
            ELSE vc.precio * vc.cantidad * 0.25
          END
        ), 0) as ganancia_estimada,
        COALESCE(AVG(v.total), 0) as factura_promedio,
        COUNT(CASE WHEN p.costo > 0 THEN 1 END) as productos_con_costo,
        COUNT(CASE WHEN p.costo IS NULL OR p.costo = 0 THEN 1 END) as productos_sin_costo
      FROM ventas v
      JOIN ventas_cont vc ON v.id = vc.venta_id
      LEFT JOIN productos p ON vc.producto_id = p.id
      ${filtroFecha}
      GROUP BY DATE_FORMAT(v.fecha, '${dateFormat}')
      ORDER BY DATE_FORMAT(v.fecha, '${dateFormat}') ASC
    `;

    // ✅ PARÁMETROS CORREGIDOS (SIN LÍMITE)
    const params = [desde, hasta];

    console.log('📊 Ejecutando query con período:', periodo, 'Días:', diasEnPeriodo);

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('❌ Error obteniendo ganancias detalladas:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al obtener ganancias detalladas: ' + err.message
        });
      }

      console.log(`✅ Resultados obtenidos: ${results.length} registros`);

      if (results.length === 0) {
        return res.json({
          success: true,
          data: [],
          totales: {
            total_ventas: 0,
            ingresos_totales: 0,
            ganancia_estimada: 0
          },
          periodo,
          message: 'No se encontraron datos para el período seleccionado'
        });
      }

      // ✅ CÁLCULO DE TOTALES
      const totales = {
        total_ventas: results.reduce((acc, row) => acc + parseInt(row.total_ventas || 0), 0),
        ingresos_totales: results.reduce((acc, row) => acc + parseFloat(row.ingresos_totales || 0), 0),
        ganancia_estimada: results.reduce((acc, row) => acc + parseFloat(row.ganancia_estimada || 0), 0),
        productos_con_costo: results.reduce((acc, row) => acc + parseInt(row.productos_con_costo || 0), 0),
        productos_sin_costo: results.reduce((acc, row) => acc + parseInt(row.productos_sin_costo || 0), 0)
      };

      res.json({
        success: true,
        data: results,
        totales,
        periodo: diasEnPeriodo > 365 ? 'anual' : diasEnPeriodo > 60 ? 'mensual' : 'diario',
        filtros_aplicados: { desde, hasta, periodo }
      });
    });

  } catch (error) {
    console.error('💥 Error en obtenerGananciasDetalladas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
};



const obtenerTopProductosTabla = async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    
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
        vc.producto_id,
        vc.producto_nombre,
        c.nombre as categoria,
        p.costo,
        AVG(vc.precio) as precio_promedio,
        SUM(vc.cantidad) as cantidad_vendida,
        SUM(vc.precio * vc.cantidad) as ingresos_producto,
        SUM(
          CASE 
            WHEN p.costo > 0 AND p.costo IS NOT NULL 
            THEN (vc.precio - p.costo) * vc.cantidad
            ELSE vc.precio * vc.cantidad * 0.25
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
      ${filtroFecha}
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
        data: results
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


// ✅ OBTENER GANANCIAS POR PRODUCTO - Compatible con tu BD
const obtenerGananciasPorProducto = async (req, res) => {
  try {
    const { desde, hasta, limite = 20 } = req.query;
    
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
        vc.producto_id,
        vc.producto_nombre,
        p.costo,
        COUNT(vc.id) as veces_vendido,
        SUM(vc.cantidad) as cantidad_total_vendida,
        AVG(vc.precio) as precio_promedio,
        SUM(vc.precio * vc.cantidad) as ingresos_producto,
        SUM(
          CASE 
            WHEN p.costo > 0 THEN (vc.precio - p.costo) * vc.cantidad
            ELSE vc.precio * vc.cantidad * 0.3
          END
        ) as ganancia_estimada,
        (
          SUM(
            CASE 
              WHEN p.costo > 0 THEN (vc.precio - p.costo) * vc.cantidad
              ELSE vc.precio * vc.cantidad * 0.3
            END
          ) / SUM(vc.precio * vc.cantidad) * 100
        ) as margen_ganancia_porcentaje
      FROM ventas_cont vc
      JOIN ventas v ON vc.venta_id = v.id
      LEFT JOIN productos p ON vc.producto_id = p.id
      ${filtroFecha}
      GROUP BY vc.producto_id, vc.producto_nombre, p.costo
      ORDER BY ganancia_estimada DESC
      
    `;

    

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('Error obteniendo ganancias por producto:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al obtener ganancias por producto'
        });
      }

      res.json({
        success: true,
        data: results
      });
    });

  } catch (error) {
    console.error('Error obteniendo ganancias por producto:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener ganancias por producto'
    });
  }
};

// ✅ OBTENER GANANCIAS POR CIUDAD - Compatible con tu BD
const obtenerGananciasPorCiudad = async (req, res) => {
  try {
    let { desde, hasta, limite = 10 } = req.query;
    
    if (!desde || !hasta) {
      const ahora = new Date();
      const hace30Dias = new Date();
      hace30Dias.setDate(ahora.getDate() - 30);
      
      desde = desde || hace30Dias.toISOString().split('T')[0];
      hasta = hasta || ahora.toISOString().split('T')[0];
    }

    const query = `
      SELECT 
        COALESCE(v.cliente_ciudad, 'Sin ciudad') as ciudad,
        COALESCE(v.cliente_provincia, 'Sin provincia') as provincia,
        COUNT(v.id) as total_ventas,
        COUNT(DISTINCT v.cliente_id) as clientes_unicos,
        SUM(v.total) as ingresos_totales,
        SUM(
          CASE 
            WHEN p.costo > 0 AND p.costo IS NOT NULL 
            THEN (vc.precio - p.costo) * vc.cantidad
            ELSE vc.precio * vc.cantidad * 0.25
          END
        ) as ganancia_estimada,
        AVG(v.total) as factura_promedio,
        ROUND(
          (SUM(
            CASE 
              WHEN p.costo > 0 AND p.costo IS NOT NULL 
              THEN (vc.precio - p.costo) * vc.cantidad
              ELSE vc.precio * vc.cantidad * 0.25
            END
          ) / SUM(v.total) * 100), 2
        ) as margen_promedio
      FROM ventas v
      JOIN ventas_cont vc ON v.id = vc.venta_id
      LEFT JOIN productos p ON vc.producto_id = p.id
      WHERE v.fecha BETWEEN ? AND ?
      GROUP BY COALESCE(v.cliente_ciudad, 'Sin ciudad'), COALESCE(v.cliente_provincia, 'Sin provincia')
      ORDER BY ganancia_estimada DESC
      
    `;

    const params = [desde, hasta];

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('❌ Error obteniendo ganancias por ciudad:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al obtener ganancias por ciudad'
        });
      }

      // Calcular totales para porcentajes
      const totalIngresos = results.reduce((acc, item) => acc + parseFloat(item.ingresos_totales), 0);
      
      // Agregar porcentajes
      const dataConPorcentaje = results.map(item => ({
        ...item,
        porcentaje_ingresos: totalIngresos > 0 ? 
          (parseFloat(item.ingresos_totales) / totalIngresos * 100).toFixed(1) : 0
      }));

      res.json({
        success: true,
        data: dataConPorcentaje,
        info: {
          total_ciudades: results.length,
          ciudad_top: results[0]?.ciudad || 'N/A',
          ingresos_totales: totalIngresos
        }
      });
    });

  } catch (error) {
    console.error('💥 Error en obtenerGananciasPorCiudad:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
};

// ✅ RESUMEN FINANCIERO CORREGIDO - Sin duplicación, datos reales
const obtenerResumenFinanciero = async (req, res) => {
  try {
    let { desde, hasta } = req.query;
    
    console.log('🔍 Obteniendo resumen financiero:', { desde, hasta });
    
    // ✅ Autocompletar fechas si no existen (últimos 30 días)
    if (!desde || !hasta) {
      const ahora = new Date();
      const hace30Dias = new Date();
      hace30Dias.setDate(ahora.getDate() - 30);
      
      desde = desde || hace30Dias.toISOString().split('T')[0];
      hasta = hasta || ahora.toISOString().split('T')[0];
      
      console.log('📅 Usando fechas por defecto:', { desde, hasta });
    }
    
    // Validar fechas
    const fechaDesde = new Date(desde);
    const fechaHasta = new Date(hasta);
    
    if (isNaN(fechaDesde.getTime()) || isNaN(fechaHasta.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Formato de fecha inválido. Use YYYY-MM-DD'
      });
    }
    
    const filtroFecha = 'WHERE fecha BETWEEN ? AND ?';
    const params = [desde, hasta];

    // ✅ QUERY 1: Ventas (INGRESOS REALES)
    const queryVentas = `
      SELECT 
        COUNT(*) as cantidad_ventas,
        COALESCE(SUM(total), 0) as monto_total_ventas,
        COALESCE(SUM(subtotal), 0) as subtotal_ventas,
        COALESCE(SUM(iva_total), 0) as iva_ventas,
        COALESCE(AVG(total), 0) as ticket_promedio
      FROM ventas 
      ${filtroFecha}
      AND estado = 'Facturada'
    `;

    // ✅ QUERY 2: Compras (EGRESOS REALES - proveedo res)
    const queryCompras = `
      SELECT 
        COUNT(*) as cantidad_compras,
        COALESCE(SUM(total), 0) as monto_total_compras
      FROM compras 
      ${filtroFecha}
      AND estado != 'Anulada'
    `;

    // ✅ QUERY 3: Gastos (EGRESOS REALES - operativos)
    const queryGastos = `
      SELECT 
        COUNT(*) as cantidad_gastos,
        COALESCE(SUM(monto), 0) as monto_total_gastos
      FROM gastos 
      ${filtroFecha}
    `;

    // ✅ QUERY 4: Ganancias por producto (solo productos con costo conocido)
    const queryGanancias = `
      SELECT 
        COALESCE(SUM(
          (vc.precio - COALESCE(p.costo, 0)) * vc.cantidad
        ), 0) as ganancia_bruta_real,
        COUNT(DISTINCT CASE WHEN p.costo > 0 THEN p.id END) as productos_con_costo,
        COUNT(DISTINCT p.id) as productos_totales
      FROM ventas v
      JOIN ventas_cont vc ON v.id = vc.venta_id
      LEFT JOIN productos p ON vc.producto_id = p.id
      ${filtroFecha.replace('fecha', 'v.fecha')}
      AND v.estado = 'Facturada'
    `;

    // ✅ Ejecutar queries en paralelo
    const [ventasRes, comprasRes, gastosRes, gananciasRes] = await Promise.all([
      new Promise((resolve) => {
        db.query(queryVentas, params, (err, results) => {
          if (err) {
            console.error('❌ Error query ventas:', err);
            resolve({ cantidad_ventas: 0, monto_total_ventas: 0, subtotal_ventas: 0, iva_ventas: 0, ticket_promedio: 0 });
          } else {
            resolve(results[0]);
          }
        });
      }),
      new Promise((resolve) => {
        db.query(queryCompras, params, (err, results) => {
          if (err) {
            console.error('❌ Error query compras:', err);
            resolve({ cantidad_compras: 0, monto_total_compras: 0 });
          } else {
            resolve(results[0]);
          }
        });
      }),
      new Promise((resolve) => {
        db.query(queryGastos, params, (err, results) => {
          if (err) {
            console.error('❌ Error query gastos:', err);
            resolve({ cantidad_gastos: 0, monto_total_gastos: 0 });
          } else {
            resolve(results[0]);
          }
        });
      }),
      new Promise((resolve) => {
        db.query(queryGanancias, params, (err, results) => {
          if (err) {
            console.error('❌ Error query ganancias:', err);
            resolve({ ganancia_bruta_real: 0, productos_con_costo: 0, productos_totales: 0 });
          } else {
            resolve(results[0]);
          }
        });
      })
    ]);

    // ✅ CALCULAR MÉTRICAS REALES
    const ingresos_totales = parseFloat(ventasRes.monto_total_ventas) || 0;
    const compras_totales = parseFloat(comprasRes.monto_total_compras) || 0;
    const gastos_totales = parseFloat(gastosRes.monto_total_gastos) || 0;
    const ganancia_bruta = parseFloat(gananciasRes.ganancia_bruta_real) || 0;
    
    // ✅ Total egresos = Compras + Gastos (NO sumar movimientos_fondos porque ya están incluidos)
    const egresos_totales = compras_totales + gastos_totales;
    
    // ✅ Resultado neto = Ingresos - Egresos
    const resultado_neto = ingresos_totales - egresos_totales;
    
    // ✅ Ganancia neta = Ganancia bruta - Gastos operativos
    const ganancia_neta = ganancia_bruta - gastos_totales;

    // ✅ Respuesta simplificada y clara
    const resumen = {
      periodo: {
        desde,
        hasta,
        dias: Math.ceil((fechaHasta - fechaDesde) / (1000 * 60 * 60 * 24))
      },
      ventas: {
        cantidad: parseInt(ventasRes.cantidad_ventas) || 0,
        monto_total: ingresos_totales,
        subtotal: parseFloat(ventasRes.subtotal_ventas) || 0,
        iva: parseFloat(ventasRes.iva_ventas) || 0,
        ticket_promedio: parseFloat(ventasRes.ticket_promedio) || 0
      },
      egresos: {
        compras: {
          cantidad: parseInt(comprasRes.cantidad_compras) || 0,
          monto: compras_totales
        },
        gastos: {
          cantidad: parseInt(gastosRes.cantidad_gastos) || 0,
          monto: gastos_totales
        },
        total: egresos_totales
      },
      ganancias: {
        ganancia_bruta: ganancia_bruta,
        ganancia_neta: ganancia_neta,
        margen_bruto: ingresos_totales > 0 ? (ganancia_bruta / ingresos_totales * 100) : 0,
        margen_neto: ingresos_totales > 0 ? (ganancia_neta / ingresos_totales * 100) : 0,
        productos_con_costo: parseInt(gananciasRes.productos_con_costo) || 0,
        productos_totales: parseInt(gananciasRes.productos_totales) || 0
      },
      resultado: {
        resultado_neto,
        rentabilidad: ingresos_totales > 0 ? (resultado_neto / ingresos_totales * 100) : 0,
        estado: resultado_neto >= 0 ? 'POSITIVO' : 'NEGATIVO'
      }
    };

    console.log('✅ Resumen financiero calculado:', {
      ingresos: ingresos_totales,
      egresos: egresos_totales,
      resultado: resultado_neto
    });

    res.json({
      success: true,
      data: resumen
    });

  } catch (error) {
    console.error('💥 Error obteniendo resumen financiero:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener resumen financiero: ' + error.message
    });
  }
};


// ✅ OBTENER GANANCIAS POR EMPLEADO - Compatible con tu BD
const obtenerGananciasPorEmpleado = async (req, res) => {
  try {
    let { desde, hasta } = req.query;
    
    if (!desde || !hasta) {
      const ahora = new Date();
      const primerDiaDelMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      
      desde = desde || primerDiaDelMes.toISOString().split('T')[0];
      hasta = hasta || ahora.toISOString().split('T')[0];
    }

    // ✅ QUERY CORREGIDA SIN DUPLICACIÓN
    const query = `
      SELECT 
        v.empleado_id,
        v.empleado_nombre,
        COUNT(v.id) as total_ventas,
        SUM(v.total) as ingresos_generados,
        SUM(ganancias_por_venta.ganancia_venta) as ganancia_generada,
        AVG(v.total) as factura_promedio,
        MIN(v.fecha) as primera_venta,
        MAX(v.fecha) as ultima_venta,
        COUNT(DISTINCT v.cliente_id) as clientes_atendidos,
        (SUM(ganancias_por_venta.ganancia_venta) / SUM(v.total) * 100) as margen_promedio
      FROM ventas v
      JOIN (
        SELECT 
          vc.venta_id,
          SUM(
            CASE 
              WHEN p.costo > 0 AND p.costo IS NOT NULL 
              THEN (vc.precio - p.costo) * vc.cantidad
              ELSE vc.precio * vc.cantidad * 0.25
            END
          ) as ganancia_venta
        FROM ventas_cont vc
        LEFT JOIN productos p ON vc.producto_id = p.id
        GROUP BY vc.venta_id
      ) as ganancias_por_venta ON v.id = ganancias_por_venta.venta_id
      WHERE v.fecha BETWEEN ? AND ?
      GROUP BY v.empleado_id, v.empleado_nombre
      ORDER BY ganancia_generada DESC
    `;

    const params = [desde, hasta];

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('❌ Error obteniendo ganancias por empleado:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al obtener ganancias por empleado'
        });
      }

      res.json({
        success: true,
        data: results,
        info: {
          total_empleados: results.length,
          empleado_top: results[0]?.empleado_nombre || 'N/A'
        }
      });
    });

  } catch (error) {
    console.error('💥 Error en obtenerGananciasPorEmpleado:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor: ' + error.message
    });
  }
};

// ✅ OBTENER PRODUCTOS MÁS RENTABLES - Compatible con tu BD
const obtenerProductosMasRentables = async (req, res) => {
  try {
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
        vc.producto_id,
        vc.producto_nombre,
        p.costo,
        AVG(vc.precio) as precio_promedio,
        SUM(vc.cantidad) as cantidad_vendida,
        SUM(vc.precio * vc.cantidad) as ingresos_producto,
        SUM(
          CASE 
            WHEN p.costo > 0 THEN (vc.precio - p.costo) * vc.cantidad
            ELSE vc.precio * vc.cantidad * 0.3
          END
        ) as ganancia_total,
        (
          CASE 
            WHEN p.costo > 0 THEN AVG((vc.precio - p.costo) / vc.precio * 100)
            ELSE 30.0
          END
        ) as margen_porcentaje
      FROM ventas_cont vc
      JOIN ventas v ON vc.venta_id = v.id
      LEFT JOIN productos p ON vc.producto_id = p.id
      ${filtroFecha}
      GROUP BY vc.producto_id, vc.producto_nombre, p.costo
      HAVING cantidad_vendida >= 2
      ORDER BY margen_porcentaje DESC, ganancia_total DESC
    `;

    

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('Error obteniendo productos más rentables:', err);
        return res.status(500).json({
          success: false,
          message: 'Error al obtener productos más rentables'
        });
      }

      res.json({
        success: true,
        data: results
      });
    });

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

// ✅ NUEVO: Dashboard completo simplificado - UNA SOLA LLAMADA
const obtenerDashboardSimplificado = async (req, res) => {
  try {
    let { desde, hasta } = req.query;
    
    // ✅ Autocompletar fechas si no existen
    const ahora = new Date();
    const hace30Dias = new Date();
    hace30Dias.setDate(ahora.getDate() - 30);
    
    desde = desde || hace30Dias.toISOString().split('T')[0];
    hasta = hasta || ahora.toISOString().split('T')[0];
    
    console.log('📊 Generando dashboard completo:', { desde, hasta });
    
    const params = [desde, hasta];

    // ✅ QUERY 1: Resumen General
    const queryResumen = `
      SELECT 
        (SELECT COUNT(*) FROM ventas WHERE fecha BETWEEN ? AND ? AND estado = 'Facturada') as cant_ventas,
        (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE fecha BETWEEN ? AND ? AND estado = 'Facturada') as monto_ventas,
        (SELECT COALESCE(SUM(total), 0) FROM compras WHERE fecha BETWEEN ? AND ? AND estado != 'Anulada') as monto_compras,
        (SELECT COALESCE(SUM(monto), 0) FROM gastos WHERE fecha BETWEEN ? AND ?) as monto_gastos
    `;

    // ✅ QUERY 2: Top 5 Productos Más Vendidos
    const queryTopProductos = `
      SELECT 
        vc.producto_nombre,
        SUM(vc.cantidad) as cantidad_vendida,
        SUM(vc.precio * vc.cantidad) as ingresos_generados,
        COUNT(DISTINCT v.id) as ventas_realizadas
      FROM ventas v
      JOIN ventas_cont vc ON v.id = vc.venta_id
      WHERE v.fecha BETWEEN ? AND ?
        AND v.estado = 'Facturada'
      GROUP BY vc.producto_nombre
      ORDER BY cantidad_vendida DESC
      LIMIT 5
    `;

    // ✅ QUERY 3: Ventas por Vendedor
    const queryVendedores = `
      SELECT 
        empleado_nombre,
        COUNT(*) as cantidad_ventas,
        SUM(total) as monto_total_ventas,
        AVG(total) as ticket_promedio
      FROM ventas
      WHERE fecha BETWEEN ? AND ?
        AND estado = 'Facturada'
        AND empleado_nombre IS NOT NULL
      GROUP BY empleado_nombre
      ORDER BY monto_total_ventas DESC
    `;

    // ✅ QUERY 4: Comparación con Período Anterior
    const diasPeriodo = Math.ceil((new Date(hasta) - new Date(desde)) / (1000 * 60 * 60 * 24));
    const fechaDesdeAnterior = new Date(desde);
    fechaDesdeAnterior.setDate(fechaDesdeAnterior.getDate() - diasPeriodo);
    const fechaHastaAnterior = new Date(desde);
    fechaHastaAnterior.setDate(fechaHastaAnterior.getDate() - 1);
    
    const queryComparacion = `
      SELECT 
        (SELECT COUNT(*) FROM ventas WHERE fecha BETWEEN ? AND ? AND estado = 'Facturada') as cant_ventas_anterior,
        (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE fecha BETWEEN ? AND ? AND estado = 'Facturada') as monto_ventas_anterior
    `;

    // ✅ Ejecutar todas las queries en paralelo
    const [resumenRes, topProductosRes, vendedoresRes, comparacionRes] = await Promise.all([
      new Promise((resolve) => {
        db.query(queryResumen, [...params, ...params, ...params, ...params], (err, results) => {
          if (err) {
            console.error('❌ Error query resumen:', err);
            resolve([{ cant_ventas: 0, monto_ventas: 0, monto_compras: 0, monto_gastos: 0 }]);
          } else {
            resolve(results);
          }
        });
      }),
      new Promise((resolve) => {
        db.query(queryTopProductos, params, (err, results) => {
          if (err) {
            console.error('❌ Error query top productos:', err);
            resolve([]);
          } else {
            resolve(results);
          }
        });
      }),
      new Promise((resolve) => {
        db.query(queryVendedores, params, (err, results) => {
          if (err) {
            console.error('❌ Error query vendedores:', err);
            resolve([]);
          } else {
            resolve(results);
          }
        });
      }),
      new Promise((resolve) => {
        const paramsComparacion = [
          fechaDesdeAnterior.toISOString().split('T')[0],
          fechaHastaAnterior.toISOString().split('T')[0],
          fechaDesdeAnterior.toISOString().split('T')[0],
          fechaHastaAnterior.toISOString().split('T')[0]
        ];
        db.query(queryComparacion, paramsComparacion, (err, results) => {
          if (err) {
            console.error('❌ Error query comparación:', err);
            resolve([{ cant_ventas_anterior: 0, monto_ventas_anterior: 0 }]);
          } else {
            resolve(results);
          }
        });
      })
    ]);

    // ✅ Procesar resultados
    const resumen = resumenRes[0];
    const ingresos = parseFloat(resumen.monto_ventas) || 0;
    const compras = parseFloat(resumen.monto_compras) || 0;
    const gastos = parseFloat(resumen.monto_gastos) || 0;
    const egresos = compras + gastos;
    const resultado = ingresos - egresos;

    // ✅ Comparación
    const comparacion = comparacionRes[0];
    const montosAnterior = parseFloat(comparacion.monto_ventas_anterior) || 0;
    const diferenciaVentas = ingresos - montosAnterior;
    const porcentajeCambio = montosAnterior > 0 ? ((diferenciaVentas / montosAnterior) * 100) : 0;

    // ✅ Respuesta unificada
    const dashboard = {
      periodo: {
        desde,
        hasta,
        dias: diasPeriodo
      },
      resumen: {
        ventas: {
          cantidad: parseInt(resumen.cant_ventas) || 0,
          monto: ingresos
        },
        egresos: {
          compras: compras,
          gastos: gastos,
          total: egresos
        },
        resultado_neto: resultado,
        estado: resultado >= 0 ? 'GANANCIA' : 'PÉRDIDA'
      },
      comparacion_periodo_anterior: {
        ventas_actuales: ingresos,
        ventas_anteriores: montosAnterior,
        diferencia: diferenciaVentas,
        porcentaje_cambio: porcentajeCambio,
        tendencia: porcentajeCambio > 0 ? 'MEJORA' : porcentajeCambio < 0 ? 'DISMINUCIÓN' : 'IGUAL'
      },
      top_productos: topProductosRes.map(p => ({
        nombre: p.producto_nombre,
        cantidad_vendida: parseFloat(p.cantidad_vendida),
        ingresos: parseFloat(p.ingresos_generados),
        ventas: parseInt(p.ventas_realizadas)
      })),
      vendedores: vendedoresRes.map(v => ({
        nombre: v.empleado_nombre,
        cantidad_ventas: parseInt(v.cantidad_ventas),
        monto_total: parseFloat(v.monto_total_ventas),
        ticket_promedio: parseFloat(v.ticket_promedio)
      })),
      alertas: []
    };

    // ✅ Generar alertas automáticas
    if (resultado < 0) {
      dashboard.alertas.push({
        tipo: 'CRÍTICO',
        mensaje: `Resultado negativo: Se perdieron $${Math.abs(resultado).toFixed(2)} en este período`
      });
    }
    
    if (porcentajeCambio < -20) {
      dashboard.alertas.push({
        tipo: 'ADVERTENCIA',
        mensaje: `Las ventas bajaron ${Math.abs(porcentajeCambio).toFixed(1)}% respecto al período anterior`
      });
    }

    if (resumen.cant_ventas === 0) {
      dashboard.alertas.push({
        tipo: 'INFO',
        mensaje: 'No hay ventas registradas en este período'
      });
    }

    console.log('✅ Dashboard completo generado exitosamente');

    res.json({
      success: true,
      data: dashboard
    });

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
