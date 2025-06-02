
CREATE DATABASE IF NOT EXISTS erp_distribuidora;
USE erp_distribuidora;

-- Tabla de Clientes
CREATE TABLE clientes (
    id INT  PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
	nombre_alternativo VARCHAR(100),
	condicion_iva VARCHAR(100),
	cuit INT,
	dni INT, 
	direccion VARCHAR(255),
	ciudad VARCHAR(100),
	provincia VARCHAR(100)
    telefono INT,
	email VARCHAR(100)	
);

-- Tabla de Proveedores
CREATE TABLE proveedores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(255),
    ciudad VARCHAR(100)
);

-- Tabla de Categorías de Productos
CREATE TABLE categorias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL
);

-- Tabla de Unidades de Medida
CREATE TABLE unidades_medida (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre ENUM('kilos', 'litros', 'unidades') UNIQUE NOT NULL
);

-- Tabla de Productos
CREATE TABLE productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    categoria_id INT NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    precio_ganancia DECIMAL(10,2) NOT NULL,
    costo DECIMAL(10,2) NOT NULL,
    porcentaje_ganancia DECIMAL(5,2) NOT NULL,
    iva ENUM('IVA21', 'IVA10.5', 'IVA27', 'IVAExento') NOT NULL DEFAULT 'IVA21',
    descuento DECIMAL(5,2) DEFAULT 0.00,
    unidad_medida_id INT NOT NULL,
    stock_actual DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE RESTRICT,
    FOREIGN KEY (unidad_medida_id) REFERENCES unidades_medida(id) ON DELETE RESTRICT
);

-- Tabla de Empleados con autenticación y roles
CREATE TABLE empleados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(255),
    usuario VARCHAR(50) UNIQUE NOT NULL,
    contraseña VARCHAR(255) NOT NULL,
    rol_id INT NOT NULL,
    sueldo DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT
);

-- Tabla de Roles
CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL
);

-- Tabla de Permisos
CREATE TABLE permisos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL
);

-- Relación entre Roles y Permisos
CREATE TABLE roles_permisos (
    rol_id INT NOT NULL,
    permiso_id INT NOT NULL,
    PRIMARY KEY (rol_id, permiso_id),
    FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE
);

-- Tabla de Ventas
CREATE TABLE ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
	fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
	cliente_id INT, 
    cliente_nombre VARCHAR(100),
	cliente_cuit VARCHAR (45),
	cliente_telefono VARCHAR(100),
	cliente_direccion VARCHAR(100),
	cliente_ciudad VARCHAR(100),
	cliente_provincia VARCHAR(100),
	tipo_documento VARCHAR(50),
	tipo_fiscal VARCHAR(5),
	total DECIMAL(10,2) NOT NULL,
    estado ENUM('Registrada', 'Confirmada', 'Anulada', 'Entregada') DEFAULT 'Registrada'
	empleado_id INT,
	empleado_nombre VARCHAR(50),
	cae_id INT, 
	cae_fecha DATETIME
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
    FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
);

	
-- Tabla de Detalle de Ventas
CREATE TABLE detalle_ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT,
    producto_id INT,
	producto_nombre VARCHAR(100),
	producto_um VARCHAR(50),
    cantidad INT NOT NULL,
	precio DECIMAL(10, 2) NOT NULL,
	IVA DECIMAL (10, 2) NOT NULL, 
    subtotal DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);

CREATE TABLE remitos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    cliente_id INT, 
    cliente_nombre VARCHAR(100),
    cliente_cuit VARCHAR (45),
	cliente_telefono VARCHAR(100),
	cliente_direccion VARCHAR(100),
	cliente_ciudad VARCHAR(100),
	cliente_provincia VARCHAR(100),
    estado ENUM('Pendiente', 'En camino', 'Entregado') DEFAULT 'Pendiente',
    observaciones TEXT,
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

CREATE TABLE detalle_remitos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    remito_id INT NOT NULL,
    producto_id INT,
	producto_nombre VARCHAR(100),
	producto_um VARCHAR(50),
    cantidad INT NOT NULL,
    FOREIGN KEY (remito_id) REFERENCES remitos(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);



-- Tabla de Facturas
CREATE TABLE facturas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venta_id INT,
    fecha_emision DATETIME DEFAULT CURRENT_TIMESTAMP,
    monto_total DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
);

-- Tabla de Comprobantes de Ventas
CREATE TABLE comprobantes_ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo_comprobante VARCHAR(50) NOT NULL,
    tipo_factura ENUM('A', 'B', 'C') NOT NULL,
    numero_cae VARCHAR(50) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    comprobante_rel INT NULL,
    FOREIGN KEY (comprobante_rel) REFERENCES comprobantes_ventas(id) ON DELETE SET NULL
);

-- Tabla de Compras a Proveedores
CREATE TABLE compras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    proveedor_id INT,
    empleado_id INT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    total DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL,
    FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
);

-- Tabla de Detalle de Compras
CREATE TABLE detalle_compras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    compra_id INT,
    producto_id INT,
    cantidad DECIMAL(10,2) NOT NULL,
    costo DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);

-- Tabla de Finanzas
CREATE TABLE finanzas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo ENUM('Ingreso', 'Egreso') NOT NULL,
    referencia_id INT,
    descripcion TEXT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    venta_id INT NULL,
    compra_id INT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE SET NULL,
    FOREIGN KEY (compra_id) REFERENCES compras(id) ON DELETE SET NULL
);

-- Tabla de Historial de Stock y Movimientos de Inventario
CREATE TABLE movimientos_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT,
    cantidad DECIMAL(10,2) NOT NULL,
    tipo ENUM('Ingreso', 'Egreso') NOT NULL,
    referencia ENUM('Compra', 'Venta', 'Ajuste Manual') NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);

-- Tabla de Observaciones de Empleados
CREATE TABLE observaciones_empleados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    empleado_id INT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    observacion TEXT NOT NULL,
    FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
);
