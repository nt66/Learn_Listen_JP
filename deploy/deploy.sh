#!/usr/bin/env bash
# 构建并更新 Docker 中的 API、Web 和 Cloudflare Tunnel。
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose build
docker compose up -d
docker compose ps
