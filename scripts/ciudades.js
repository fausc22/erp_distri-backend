// script_asignar_ciudades.js
const mysql = require('mysql2/promise');

// Configuración de la base de datos
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '251199',
    database: 'erp_distri',
    charset: 'utf8mb4'
};


class AsignadorCiudades {
  constructor() {
    this.connection = null;
    this.ciudades = [];
    this.estadisticas = {
      totalClientes: 0,
      asignados: 0,
      asignadosDefault: 0,
      errores: 0
    };
  }

  async conectar() {
    try {
      this.connection = await mysql.createConnection(dbConfig);
      console.log('✅ Conectado a la base de datos');
    } catch (error) {
      console.error('❌ Error conectando a la base de datos:', error);
      throw error;
    }
  }

  async cargarCiudades() {
    try {
      const [ciudades] = await this.connection.execute('SELECT id, nombre FROM ciudades');
      this.ciudades = ciudades.map(ciudad => ({
        id: ciudad.id,
        nombre: ciudad.nombre.toLowerCase().trim(),
        nombreOriginal: ciudad.nombre
      }));
      
      console.log(`📍 Cargadas ${this.ciudades.length} ciudades`);
      return this.ciudades;
    } catch (error) {
      console.error('❌ Error cargando ciudades:', error);
      throw error;
    }
  }

  // Función para limpiar y normalizar texto
  limpiarTexto(texto) {
    if (!texto) return '';
    
    return texto
      .toLowerCase()
      .trim()
      // Remover caracteres especiales y acentos
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Remover caracteres especiales comunes
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Buscar ciudad en un texto
  buscarCiudadEnTexto(texto) {
    if (!texto) return null;

    const textoLimpio = this.limpiarTexto(texto);
    
    // Buscar coincidencias exactas primero
    for (const ciudad of this.ciudades) {
      const ciudadLimpia = this.limpiarTexto(ciudad.nombre);
      
      // Coincidencia exacta
      if (textoLimpio === ciudadLimpia) {
        return ciudad;
      }
      
      // Coincidencia como palabra completa
      const regex = new RegExp(`\\b${ciudadLimpia}\\b`, 'i');
      if (regex.test(textoLimpio)) {
        return ciudad;
      }
    }

    // Buscar coincidencias parciales para ciudades compuestas
    for (const ciudad of this.ciudades) {
      const ciudadLimpia = this.limpiarTexto(ciudad.nombre);
      
      // Para ciudades con espacios, buscar cada palabra
      if (ciudadLimpia.includes(' ')) {
        const palabrasCiudad = ciudadLimpia.split(' ');
        const todasLasPalabrasPresentes = palabrasCiudad.every(palabra => 
          textoLimpio.includes(palabra)
        );
        
        if (todasLasPalabrasPresentes) {
          return ciudad;
        }
      }
      
      // Coincidencia parcial al inicio o final
      if (textoLimpio.includes(ciudadLimpia) && ciudadLimpia.length > 3) {
        return ciudad;
      }
    }

    return null;
  }

  // Detectar ciudad para un cliente específico
  detectarCiudadCliente(cliente) {
    // Prioridad 1: Campo ciudad
    if (cliente.ciudad) {
      const ciudadEncontrada = this.buscarCiudadEnTexto(cliente.ciudad);
      if (ciudadEncontrada) {
        return { ciudad: ciudadEncontrada, fuente: 'ciudad' };
      }
    }

    // Prioridad 2: Campo dirección
    if (cliente.direccion) {
      const ciudadEncontrada = this.buscarCiudadEnTexto(cliente.direccion);
      if (ciudadEncontrada) {
        return { ciudad: ciudadEncontrada, fuente: 'direccion' };
      }
    }

    // Prioridad 3: Campo nombre (menos confiable)
    if (cliente.nombre) {
      const ciudadEncontrada = this.buscarCiudadEnTexto(cliente.nombre);
      if (ciudadEncontrada) {
        return { ciudad: ciudadEncontrada, fuente: 'nombre' };
      }
    }

    // Prioridad 4: Campo provincia como pista
    if (cliente.provincia) {
      const ciudadEncontrada = this.buscarCiudadEnTexto(cliente.provincia);
      if (ciudadEncontrada) {
        return { ciudad: ciudadEncontrada, fuente: 'provincia' };
      }
    }

    return null;
  }

  async procesarClientes() {
    try {
      // Cargar todos los clientes
      console.log('📊 Cargando clientes...');
      const [clientes] = await this.connection.execute(`
        SELECT id, nombre, direccion, ciudad, provincia 
        FROM clientes 
        ORDER BY id
      `);

      this.estadisticas.totalClientes = clientes.length;
      console.log(`👥 Total de clientes a procesar: ${clientes.length}`);

      let lote = 1;
      const tamanioLote = 100;
      
      for (let i = 0; i < clientes.length; i += tamanioLote) {
        const clientesLote = clientes.slice(i, i + tamanioLote);
        console.log(`\n🔄 Procesando lote ${lote} (${clientesLote.length} clientes)...`);
        
        await this.procesarLoteClientes(clientesLote);
        lote++;
        
        // Pausa pequeña entre lotes para no sobrecargar la DB
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error('❌ Error procesando clientes:', error);
      throw error;
    }
  }

  async procesarLoteClientes(clientes) {
    for (const cliente of clientes) {
      try {
        const resultado = this.detectarCiudadCliente(cliente);
        let ciudadId = 27; // Default: General Pico
        let fuente = 'default';

        if (resultado) {
          ciudadId = resultado.ciudad.id;
          fuente = resultado.fuente;
          this.estadisticas.asignados++;
          
          console.log(`✅ Cliente ${cliente.id}: ${resultado.ciudad.nombreOriginal} (ID: ${ciudadId}) desde ${fuente}`);
        } else {
          this.estadisticas.asignadosDefault++;
          console.log(`⚠️  Cliente ${cliente.id}: No detectado, asignando General Pico (ID: 27)`);
        }

        // Actualizar en la base de datos
        await this.connection.execute(
          'UPDATE clientes SET ciudad_id = ? WHERE id = ?',
          [ciudadId, cliente.id]
        );

      } catch (error) {
        console.error(`❌ Error procesando cliente ${cliente.id}:`, error);
        this.estadisticas.errores++;
      }
    }
  }

  async mostrarEstadisticas() {
    console.log('\n📊 ESTADÍSTICAS FINALES:');
    console.log('========================');
    console.log(`Total de clientes procesados: ${this.estadisticas.totalClientes}`);
    console.log(`Ciudades detectadas automáticamente: ${this.estadisticas.asignados}`);
    console.log(`Asignados a General Pico (default): ${this.estadisticas.asignadosDefault}`);
    console.log(`Errores: ${this.estadisticas.errores}`);
    
    const porcentajeDetectados = ((this.estadisticas.asignados / this.estadisticas.totalClientes) * 100).toFixed(2);
    console.log(`Porcentaje de detección: ${porcentajeDetectados}%`);

    // Mostrar algunos ejemplos de asignaciones
    console.log('\n🔍 VERIFICACIÓN DE MUESTRA:');
    const [muestra] = await this.connection.execute(`
      SELECT c.id, c.nombre, c.ciudad, c.direccion, c.ciudad_id, ci.nombre as ciudad_nombre
      FROM clientes c
      LEFT JOIN ciudades ci ON c.ciudad_id = ci.id
      WHERE c.ciudad_id IS NOT NULL
      ORDER BY RAND()
      LIMIT 10
    `);

    muestra.forEach(cliente => {
      console.log(`Cliente ${cliente.id}: ${cliente.ciudad_nombre} (ID: ${cliente.ciudad_id})`);
      console.log(`  └─ ${cliente.nombre}`);
      if (cliente.ciudad) console.log(`  └─ Ciudad original: ${cliente.ciudad}`);
      if (cliente.direccion) console.log(`  └─ Dirección: ${cliente.direccion}`);
    });
  }

  async cerrarConexion() {
    if (this.connection) {
      await this.connection.end();
      console.log('🔌 Conexión cerrada');
    }
  }

  async ejecutar() {
    console.log('🚀 INICIANDO ASIGNACIÓN DE CIUDADES A CLIENTES');
    console.log('===============================================\n');

    try {
      await this.conectar();
      await this.cargarCiudades();
      await this.procesarClientes();
      await this.mostrarEstadisticas();
      
      console.log('\n✅ PROCESO COMPLETADO EXITOSAMENTE');
      
    } catch (error) {
      console.error('\n❌ ERROR DURANTE LA EJECUCIÓN:', error);
    } finally {
      await this.cerrarConexion();
    }
  }
}

// Función principal
async function main() {
  const asignador = new AsignadorCiudades();
  await asignador.ejecutar();
}

// Ejecutar solo si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = AsignadorCiudades;