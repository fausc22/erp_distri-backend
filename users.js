// scripts/crearUsuarioInicial.js
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Configurar la conexión a la base de datos
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 10
});

const crearUsuarioInicial = async () => {
    try {
        console.log('🔗 Conectando a la base de datos...');

        // Datos del usuario inicial
        const datosUsuario = {
            nombre: 'Martin',
            apellido: 'Cantallops',
            dni: '22074801',
            telefono: '2302652701',
            email: 'faausc@gmail.com',
            usuario: 'martin',
            password: 'gerente165',
            rol: 'GERENTE'
        };

        // Verificar si ya existe el usuario
        const [usuarioExistente] = await pool.execute(
            'SELECT id FROM empleados WHERE usuario = ?',
            [datosUsuario.usuario]
        );

        if (usuarioExistente.length > 0) {
            console.log('⚠️  El usuario ya existe en la base de datos');
            return;
        }

        // Hashear la contraseña
        console.log('🔒 Hasheando contraseña...');
        const hashedPassword = await bcrypt.hash(datosUsuario.password, 10);

        // Insertar el usuario
        console.log('👤 Creando usuario inicial...');
        const query = `
            INSERT INTO empleados (nombre, apellido, dni, telefono, email, usuario, password, rol) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [result] = await pool.execute(query, [
            datosUsuario.nombre,
            datosUsuario.apellido,
            datosUsuario.dni,
            datosUsuario.telefono,
            datosUsuario.email,
            datosUsuario.usuario,
            hashedPassword,
            datosUsuario.rol
        ]);

        console.log('✅ Usuario inicial creado exitosamente!');
        console.log(`📝 ID del empleado: ${result.insertId}`);
        console.log(`👤 Usuario: ${datosUsuario.usuario}`);
        console.log(`🔑 Contraseña: ${datosUsuario.password}`);
        console.log(`👔 Rol: ${datosUsuario.rol}`);

    } catch (error) {
        console.error('❌ Error al crear usuario inicial:', error);
    } finally {
        await pool.end();
        console.log('🔚 Conexión cerrada');
    }
};

// Ejecutar el script
crearUsuarioInicial();

// También exportar la función para uso en otros scripts
module.exports = { crearUsuarioInicial };