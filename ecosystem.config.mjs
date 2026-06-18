export default {
  apps: [
    {
      name: 'vertimar-api-v2',
      script: 'server.js',
      cwd: '/opt/distri-api-v2/backend',
      instances: 1,
      autorestart: true,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
