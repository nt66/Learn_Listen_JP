# Kotoba Flow

一个以“听觉辨认 + 主动提取”为核心的日语单词播放器。前端使用 React、Vite 与 TypeScript，数据保存在浏览器 `localStorage` 中。

## 功能

- CSV 批量导入与本地词库编辑
- 日文、平假名、罗马音、中文释义卡片
- 日文播报（听音辨义）与中文播报（提示后说日文）
- 系统语音与 Gemini 高自然度 TTS 双引擎
- 1 / 3 / 5 秒间隔，0.5×–3× 语速
- 顺序或随机连续播放
- 可选 Gemini 批量生成平假名、罗马音和中文释义
- 响应式桌面与移动端界面

## 启动

```bash
npm install
npm run dev
```
打开 `http://localhost:5173`。

## 配置 Gemini（可选）

在项目根目录新建 `.env.local`：

```bash
GEMINI_API_KEY=你的密钥
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_TTS_VOICE=Aoede
```

重启开发服务器后，CSV 导入窗口会显示 Gemini 已连接，“播放设置”中也会启用 AI 自然语音。首次播放某个词需要生成音频，之后服务器会复用内存缓存。密钥只由 Vite 服务端中间件读取，不会进入浏览器构建产物。正式部署时，应把 `/api/enrich` 与 `/api/tts` 迁移到受保护的后端或 Serverless Function，并加入身份验证、持久缓存、配额与速率限制。

## CSV 格式

支持以下表头及常见的中日文别名：

```csv
japanese,kana,romaji,chinese
先生,せんせい,sensei,老师
給与,,,
```

只提供 `japanese` 列时，需要启用 Gemini 自动补全。未配置 Gemini 时，建议填写全部四列；假名词和片假名词可在浏览器中自动转换罗马音。

## 构建检查

```bash
npm run check
npm run build
```

语音由浏览器 Web Speech API 提供。可用声线和高倍速表现取决于操作系统与浏览器，推荐 Chrome、Edge 或 Safari。
