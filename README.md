# Kotoba Flow

一个以“听觉辨认 + 主动提取”为核心的日语单词播放器。前端使用 React、Vite 与 TypeScript，数据保存在浏览器 `localStorage` 中。

## 功能

- CSV 批量导入与本地词库编辑
- 日文、平假名、罗马音、中文释义卡片
- 日文播报（听音辨义）与中文播报（提示后说日文）
- 系统语音与 Google Cloud TTS 预生成语音双引擎
- 1 / 3 / 5 秒间隔，0.5×–3× 语速
- 顺序或随机连续播放
- 响应式桌面与移动端界面

## 启动

```bash
npm install
npm run dev
```
打开 `http://localhost:5173`。

## 配置 API 服务

在项目根目录新建 `.env.local`，然后用 `npm run server` 启动 API 服务（开发时 Vite 会把 `/api/books`、`/api/admin` 代理过去）：

```bash
FIREBASE_PROJECT_ID=william-japanese-learn
# 服务账号 JSON，同时用于 Firestore 和 Google Cloud Text-to-Speech
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
PORT=8787

# 管理后台 /admin 的登录账号，由 API 服务（npm run server）校验
ADMIN_USER=admin
ADMIN_PASSWORD=你的密码
```

在 `/admin` 上传单词书后，服务端会用 Google Cloud TTS 在后台生成每个单词的 MP3 并存入 Firestore；失败项可用 `npm run audio -- <bookId>` 补跑。

## CSV 格式

支持以下表头及常见的中日文别名：

```csv
japanese,kana,romaji,chinese
先生,せんせい,sensei,老师
給与,,,
```

建议填写全部四列；假名词和片假名词可在浏览器中自动转换罗马音。

## 构建检查

```bash
npm run check
npm run build
```

语音由浏览器 Web Speech API 提供。可用声线和高倍速表现取决于操作系统与浏览器，推荐 Chrome、Edge 或 Safari。

## Docker 部署

正式环境由三个容器组成：Cloudflare Tunnel、Nginx 静态站点和 Node API。所有服务仅在 Docker 网络内通信，不向宿主机发布端口。

部署所需的两个凭据文件不会进入镜像，也已被 Git 忽略：

```text
secrets/cloudflared-token
secrets/firebase-service-account.json
```

构建或更新服务：

```bash
./deploy/deploy.sh
```

查看状态和日志：

```bash
docker compose ps
docker compose logs -f
```

Cloudflare Tunnel 的 Published Application 源站必须是 `http://web:8080`。开发服务器仍然可以使用 `npm run dev`，与 Docker 部署互不影响。
