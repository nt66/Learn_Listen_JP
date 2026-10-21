#!/usr/bin/env bash
# 构建前端 → 发布到 nginx 目录 → 重载 nginx → 重启 API
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
mkdir -p /opt/homebrew/var/www/kotoba
rsync -a --delete dist/ /opt/homebrew/var/www/kotoba/
cp deploy/nginx.conf /opt/homebrew/etc/nginx/servers/kotoba.conf
nginx -t
brew services list | grep -q '^nginx.*started' && nginx -s reload || brew services start nginx
pm2 startOrReload ecosystem.config.cjs
