// Solo para el proceso de ensayo. No arranca ni reinicia api-vertimar-v2.
// PORT queda en el entorno de PM2 y dotenv no lo pisa con el 3002 del .env copiado.
export default {
  apps: [
    {
      name: 'api-vertimar-v2-ensayo',
      script: 'server.js',
      cwd: '/opt/distri-api-v2-ensayo',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '800M',
      kill_timeout: 20000,
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
      },
    },
  ],
};
