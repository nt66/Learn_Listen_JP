// pm2 start ecosystem.config.cjs —— 只跑 API 服务；前端静态文件由 nginx 提供（见 deploy/nginx.conf）。
module.exports = {
  apps: [{
    name: 'kotoba-api',
    script: 'server/index.mjs',
    cwd: __dirname,
    node_args: '--env-file-if-exists=.env.local',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '300M',
  }],
};
