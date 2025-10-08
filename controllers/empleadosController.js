const bcrypt = require('bcryptjs');
const db = require('./dbPromise');
const { auditarOperacion, obtenerDatosAnteriores, limpiarDatosSensibles } = require('../middlewares/auditoriaMiddleware');

// Crear nuevo empleado
exports.crearEmpleado = async (req, res) => {
    try {
        const { 
            nombre, 
            apellido, 
            dni, 
            telefono, 
            email, 
            usuario, 
            password, 
            rol 
        } = req.body;

        // Validaciones básicas
        if (!nombre || !apellido || !usuario || !password || !rol) {
            return res.status(400).json({ 
                message: 'Los campos nombre, apellido, usuario, contraseña y rol son obligatorios' 
            });
        }

        // Validar rol
        if (!['GERENTE', 'VENDEDOR'].includes(rol)) {
            return res.status(400).json({ 
                message: 'El rol debe ser GERENTE o VENDEDOR' 
            });
        }

        // Validar longitud de contraseña
        if (password.length < 6) {
            return res.status(400).json({ 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        // Verificar si el usuario ya existe
        const [usuariosExistentes] = await db.execute(
            'SELECT id FROM empleados WHERE usuario = ?', 
            [usuario]
        );
        if (usuariosExistentes.length > 0) {
            return res.status(400).json({ message: 'El usuario ya existe' });
        }

        // Verificar si el DNI ya existe (si se proporciona)
        if (dni) {
            const [dniExistente] = await db.execute(
                'SELECT id FROM empleados WHERE dni = ?', 
                [dni]
            );
            if (dniExistente.length > 0) {
                return res.status(400).json({ message: 'El DNI ya está registrado' });
            }
        }

        // Encriptar contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insertar empleado
        const query = `
            INSERT INTO empleados (nombre, apellido, dni, telefono, email, usuario, password, rol) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const [result] = await db.execute(query, [
            nombre.trim(),
            apellido.trim(),
            dni?.trim() || null,
            telefono?.trim() || null,
            email?.trim() || null,
            usuario.trim(),
            hashedPassword,
            rol
        ]);

        // Preparar datos para auditoría (sin la contraseña)
        const datosNuevos = limpiarDatosSensibles({
            id: result.insertId,
            nombre: nombre.trim(),
            apellido: apellido.trim(),
            dni: dni?.trim() || null,
            telefono: telefono?.trim() || null,
            email: email?.trim() || null,
            usuario: usuario.trim(),
            password: hashedPassword,
            rol
        });

        // Auditar creación del empleado
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'empleados',
            registroId: result.insertId,
            datosNuevos,
            detallesAdicionales: `Empleado creado: ${nombre} ${apellido} - Rol: ${rol}`
        });

        res.status(201).json({ 
            message: 'Empleado creado exitosamente',
            id: result.insertId
        });

    } catch (error) {
        console.error('Error al crear empleado:', error);
        
        // Auditar error en creación
        await auditarOperacion(req, {
            accion: 'INSERT',
            tabla: 'empleados',
            detallesAdicionales: `Error al crear empleado: ${error.message}`,
            datosNuevos: limpiarDatosSensibles(req.body)
        });
        
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Buscar empleados
exports.buscarEmpleado = async (req, res) => {
  try {
    // ✅ Usar "search" como en el frontend
    const { search } = req.query;

    if (!search || search.trim().length < 1) {
      return res.json([]);
    }

    const searchTerm = `%${search.trim()}%`;

    const query = `
      SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo
      FROM empleados 
      WHERE (nombre LIKE ? OR apellido LIKE ? OR usuario LIKE ? OR CONCAT(nombre, ' ', apellido) LIKE ?)
      AND activo = 1
      ORDER BY nombre, apellido
      LIMIT 50
    `;

    const [empleados] = await db.execute(query, [
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm
    ]);

    // ✅ Agregar campo nombre_completo
    const empleadosConNombreCompleto = empleados.map(emp => ({
      ...emp,
      nombre_completo: `${emp.nombre} ${emp.apellido}`
    }));

    res.json(empleadosConNombreCompleto);

  } catch (error) {
    console.error('Error al buscar empleados:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};


// Actualizar empleado
exports.actualizarEmpleado = async (req, res) => {
  try {
    const { id } = req.params; // 👈 CAMBIO CLAVE
    const {
      nombre,
      apellido,
      dni,
      telefono,
      email,
      usuario,
      password,
      rol
    } = req.body;

    if (!id) {
      return res.status(400).json({ message: 'ID del empleado es requerido' });
    }

    // Validaciones básicas
    if (!nombre || !apellido || !usuario || !rol) {
      return res.status(400).json({
        message: 'Los campos nombre, apellido, usuario y rol son obligatorios'
      });
    }

    if (!['GERENTE', 'VENDEDOR'].includes(rol)) {
      return res.status(400).json({
        message: 'El rol debe ser GERENTE o VENDEDOR'
      });
    }

    const datosAnteriores = await obtenerDatosAnteriores('empleados', id);
    if (!datosAnteriores) {
      return res.status(404).json({ message: 'Empleado no encontrado' });
    }

    // Validar usuario duplicado
    const [usuarioExistente] = await db.execute(
      'SELECT id FROM empleados WHERE usuario = ? AND id != ?',
      [usuario, id]
    );
    if (usuarioExistente.length > 0) {
      return res.status(400).json({ message: 'El usuario ya está en uso por otro empleado' });
    }

    if (dni) {
      const [dniExistente] = await db.execute(
        'SELECT id FROM empleados WHERE dni = ? AND id != ?',
        [dni, id]
      );
      if (dniExistente.length > 0) {
        return res.status(400).json({ message: 'El DNI ya está registrado por otro empleado' });
      }
    }

    let query;
    let params;
    let datosNuevos = {
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      dni: dni?.trim() || null,
      telefono: telefono?.trim() || null,
      email: email?.trim() || null,
      usuario: usuario.trim(),
      rol
    };

    if (password && password.trim().length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      datosNuevos.password = hashedPassword;

      query = `
        UPDATE empleados 
        SET nombre = ?, apellido = ?, dni = ?, telefono = ?, email = ?, usuario = ?, password = ?, rol = ?
        WHERE id = ?
      `;
      params = [
        nombre.trim(),
        apellido.trim(),
        dni?.trim() || null,
        telefono?.trim() || null,
        email?.trim() || null,
        usuario.trim(),
        hashedPassword,
        rol,
        id
      ];
    } else {
      query = `
        UPDATE empleados 
        SET nombre = ?, apellido = ?, dni = ?, telefono = ?, email = ?, usuario = ?, rol = ?
        WHERE id = ?
      `;
      params = [
        nombre.trim(),
        apellido.trim(),
        dni?.trim() || null,
        telefono?.trim() || null,
        email?.trim() || null,
        usuario.trim(),
        rol,
        id
      ];
    }

    await db.execute(query, params);

    await auditarOperacion(req, {
      accion: 'UPDATE',
      tabla: 'empleados',
      registroId: id,
      datosAnteriores: limpiarDatosSensibles(datosAnteriores),
      datosNuevos: limpiarDatosSensibles(datosNuevos),
      detallesAdicionales: `Empleado actualizado: ${nombre} ${apellido}${password ? ' - Contraseña cambiada' : ''}`
    });

    res.json({ message: 'Empleado actualizado exitosamente' });

  } catch (error) {
    console.error('Error al actualizar empleado:', error);

    await auditarOperacion(req, {
      accion: 'UPDATE',
      tabla: 'empleados',
      registroId: req.params.id,
      detallesAdicionales: `Error al actualizar empleado: ${error.message}`,
      datosNuevos: limpiarDatosSensibles(req.body)
    });

    res.status(500).json({ message: 'Error interno del servidor' });
  }
};


// Listar todos los empleados (para gerentes)
exports.listarEmpleados = async (req, res) => {
    try {
        const [empleados] = await db.execute(`
            SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo, fecha_creacion
            FROM empleados 
            WHERE activo = 1
            ORDER BY nombre, apellido
        `);

        res.json(empleados);

    } catch (error) {
        console.error('Error al listar empleados:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Obtener empleado por ID
exports.obtenerEmpleado = async (req, res) => {
    try {
        const { id } = req.params;

        const [empleados] = await db.execute(
            'SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo FROM empleados WHERE id = ?',
            [id]
        );

        if (empleados.length === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        res.json(empleados[0]);

    } catch (error) {
        console.error('Error al obtener empleado:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Desactivar empleado (soft delete)
exports.desactivarEmpleado = async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir que un empleado se desactive a sí mismo
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta' });
        }

        // Obtener datos anteriores para auditoría
        const datosAnteriores = await obtenerDatosAnteriores('empleados', id);
        if (!datosAnteriores) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        const [result] = await db.execute(
            'UPDATE empleados SET activo = 0 WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        // Auditar desactivación del empleado
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'empleados',
            registroId: id,
            datosAnteriores: limpiarDatosSensibles(datosAnteriores),
            datosNuevos: limpiarDatosSensibles({ ...datosAnteriores, activo: 0 }),
            detallesAdicionales: `Empleado desactivado: ${datosAnteriores.nombre} ${datosAnteriores.apellido}`
        });

        res.json({ message: 'Empleado desactivado exitosamente' });

    } catch (error) {
        console.error('Error al desactivar empleado:', error);
        
        // Auditar error en desactivación
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'empleados',
            registroId: req.params.id,
            detallesAdicionales: `Error al desactivar empleado: ${error.message}`
        });
        
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.listarTodosEmpleados = async (req, res) => {
    try {
        const [empleados] = await db.execute(`
            SELECT id, nombre, apellido, dni, telefono, email, usuario, rol, activo, fecha_creacion
            FROM empleados 
            ORDER BY activo DESC, nombre, apellido
        `);

        res.json(empleados);

    } catch (error) {
        console.error('Error al listar todos los empleados:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.reactivarEmpleado = async (req, res) => {
    try {
        const { id } = req.params;

        // Obtener datos anteriores para auditoría
        const datosAnteriores = await obtenerDatosAnteriores('empleados', id);
        if (!datosAnteriores) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        // Verificar que el empleado esté inactivo
        if (datosAnteriores.activo === 1) {
            return res.status(400).json({ message: 'El empleado ya está activo' });
        }

        const [result] = await db.execute(
            'UPDATE empleados SET activo = 1 WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Empleado no encontrado' });
        }

        // Auditar reactivación del empleado
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'empleados',
            registroId: id,
            datosAnteriores: limpiarDatosSensibles(datosAnteriores),
            datosNuevos: limpiarDatosSensibles({ ...datosAnteriores, activo: 1 }),
            detallesAdicionales: `Empleado reactivado: ${datosAnteriores.nombre} ${datosAnteriores.apellido}`
        });

        res.json({ message: 'Empleado reactivado exitosamente' });

    } catch (error) {
        console.error('Error al reactivar empleado:', error);
        
        // Auditar error en reactivación
        await auditarOperacion(req, {
            accion: 'UPDATE',
            tabla: 'empleados',
            registroId: req.params.id,
            detallesAdicionales: `Error al reactivar empleado: ${error.message}`
        });
        
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};