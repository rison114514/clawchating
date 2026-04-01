# Clawchating

Clawchating 是一个基于 Next.js 与 OpenClaw 的本地多 Agent 协作平台。

它的目标不是简单的对话 UI，而是围绕「群组 + Channel + Agent 绑定 + 时间线持久化 + 定时任务」建立可运行的协作工作台，行为上接近团队机器人（如飞书机器人协作）模式。

## 核心能力

- 群组聊天与 Agent 指向路由（支持 @ 指向、组内协作 relay、防回环）
- 群组时间线持久化（按 groupId + channelId 读取/写入）
- Agent 会话持久化与恢复
- 群组创建时自动初始化成员会话，并注入群上下文
- 定时任务 Cron（interval / daily）并复用聊天主链路执行
- Agent 权限治理（read / write / exec / invite / skills）
- OpenClaw 模型配置与鉴权桥接
- channel 注册能力（含 clawchating channel 注册脚本 API）
- 认证会话接口（登录态检测/登录/登出）

## 技术栈

- Next.js 16（App Router）
- React 19
- TypeScript
- Tailwind CSS 4
- AI SDK（ai, @ai-sdk/openai, @ai-sdk/react）
- OpenClaw CLI + OpenClaw Gateway

## 关键目录

- src/app/page.tsx
	- 前端主容器，管理会话、群组、消息加载与发送
- src/app/api/chat/route.ts
	- 聊天主链路，执行 Agent 调度、权限裁剪、relay、时间线写入
- src/app/api/messages/route.ts
	- 消息查询与写入（群时间线 + 直聊会话）
- src/app/api/groups/route.ts
	- 群组增删改查、会话初始化、群上下文写入、workspace 挂载
- src/app/api/crons/route.ts
	- Cron 配置管理
- src/cron-daemon.ts
	- 后台定时触发器，定时任务调度并转发到聊天链路
- src/app/api/models/config/route.ts
	- 模型状态读取、模型配置写入、provider 相关桥接
- src/app/api/channels/register/route.ts
	- 调用脚本注册 clawchating channel
- src/lib/session-runtime.ts
	- 会话键、消息持久化、群时间线 IO 的核心运行时
- workspaces/
	- 项目侧持久化目录（groups.json、crons.json、群组目录、timeline 等）
- change_logs/
	- 项目迭代计划与变更记录

## 环境依赖

- Node.js 18+
- npm 9+
- 本机已安装并可执行 openclaw CLI
- 已完成 OpenClaw 初始化配置（~/.openclaw/openclaw.json 存在）

可选环境变量：

- OPENCLAW_API_KEY
	- 部分网关/上游调用会使用该变量作为兜底 key
- CLAWCHATING_CHAT_TRACE
	- 为 1/true/yes 时开启聊天链路追踪日志

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 启动开发环境

```bash
npm run dev
```

3. 打开浏览器

- http://localhost:3000

说明：

- 启动后会在 Node Runtime 下注册并启动 Cron Daemon。
- 群组消息与任务状态会写入 workspaces 目录。

## 常用脚本

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run plugin:clawchating-ws
npm run qmd:enable
npm run qmd:enable:restart
```

## API 概览

### 聊天与消息

- POST /api/chat
	- 聊天执行主入口
- GET /api/messages
	- 查询群时间线或直聊会话消息
- POST /api/messages
	- 追加会话消息
- POST /api/chat/recover
	- 聊天恢复相关能力

### 群组与任务

- GET/POST/PUT/DELETE /api/groups
- GET/POST/PUT/DELETE /api/crons
- GET/POST/PUT/DELETE /api/workspace/files

### Agent 与模型

- GET/PUT /api/agents
- GET/PUT /api/agents/config
- GET /api/agents/avatar
- GET/POST /api/models/config
- GET/POST /api/models/config/wizard
- GET /api/skills

### 通道与认证

- POST /api/channels/register
- POST /api/auth/login
- GET /api/auth/session
- POST /api/auth/logout

## 数据与持久化

项目侧持久化主要在 workspaces 目录：

- workspaces/groups.json
- workspaces/crons.json
- workspaces/<groupId>/
- 群时间线文件与执行日志

OpenClaw 主配置在：

- ~/.openclaw/openclaw.json

## 已知问题与排查

### 1) 启动时报 CSS 解析错误（xterm）

症状：

- Can't resolve '@xterm/xterm/css/xterm.css' in src/app/globals.css

处理建议：

- 不要在 globals.css 内使用该 @import
- 在 src/app/layout.tsx 通过模块导入全局样式：
	- import '@xterm/xterm/css/xterm.css'

### 2) /api/chat 返回 Not Found

症状：

- AI_APICallError: 404 Not Found

排查方向：

- 检查 OpenClaw provider/model 配置是否有效
- 检查 openclaw gateway 是否正常运行
- 检查 openclaw.json 中 agents 与 models 配置是否一致

### 3) 群聊消息没有出现在时间线

排查方向：

- 检查 groupId 与 channelId 是否一致
- 检查 /api/messages 查询参数是否按群模式传入
- 检查 workspaces 下群时间线文件是否创建

## 迭代记录

- 综合开发日志：change_logs/CHANGELOG.md
- 日更变更：change_logs/TODAY-CHANGES-*.md
- 计划文档：change_logs/PLAN_*.MD

建议将重大改动同步写入 change_logs，再在本 README 做能力级摘要，保持文档一致性。

## 参考文档

- https://docs.openclaw.ai/concepts/memory
- https://docs.openclaw.ai/cli/memory
- https://docs.openclaw.ai/gateway/configuration-reference
