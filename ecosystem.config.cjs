module.exports = {
  apps: [
    {
      name: 'ip-studio',
      script: 'server/index.js',
      cwd: '/opt/ip-studio',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
