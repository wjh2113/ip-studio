module.exports = {
  apps: [
    {
      name: 'ip-studio',
      script: 'server/index.js',
      cwd: '/opt/ip-studio',
      instances: 1,
      exec_mode: 'fork',
      // 停机时 server/index.js 会等进行中的请求和后台任务做完（最多 30 秒）；pm2 默认 1.6 秒就强杀
      kill_timeout: 32000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
