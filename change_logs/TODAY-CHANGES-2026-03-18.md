# 2026-03-18 变更整理

## 修复群组初始化引导

### 问题
- Agent 入群后未能正确读取 `GROUP_CONTEXT.md`，直接输出虚假内容，导致无法获取群组上下文信息。

### 改动
- 修改 `src/app/api/groups/route.ts` 中的 `appendJoinInitializationPrompt` 逻辑。
- 将提示语改为强制性指令，明确要求 Agent 必须调用 `read_file` 工具读取挂载的上下文文件。
- 提供了文件的确切挂载路径，确保 Agent 能准确找到文件。
- 使用 `[系统通知]` 前缀增强提示权威性，避免被识别为普通用户闲聊。

## 群组多 Agent 协作闭环（@ 路由 + 群时间线）

### 目标
- 支持 Agent 在群组回复中通过 `@` 呼叫其他群成员。
- 被呼叫 Agent 的响应写回同一群时间线。
- 增加回环保护，避免 A@B、B@A 无限递归。
- 在系统提示中明确成员列表来源于系统，不依赖外部平台查询。

### 核心改动
- `src/app/api/chat/route.ts`
	- 新增群成员目录注入到 `nativePrompt`，并增加“不要查询飞书成员列表”约束。
	- 新增 assistant 输出 `@` 解析（支持 agentId 与显示名别名匹配）。
	- 实现受控 relay：
		- `MAX_RELAY_DEPTH = 2`
		- `MAX_RELAY_TARGETS = 2`
		- 使用 `relayChain` 去重防回环。
	- 新增日志类别：`mention_parse`、`relay_dispatch`、`relay_drop`。
	- 群聊模式下将用户输入、Agent 输出同步写入群时间线。

- `src/lib/session-runtime.ts`
	- 新增群时间线持久化接口：
		- `appendGroupTimelineMessage`
		- `loadGroupTimelineMessages`
	- 存储路径：`workspaces/<groupId>/.timeline-<channelId>.jsonl`

- `src/app/api/messages/route.ts`
	- GET 新增 `groupId` + `channelId` 查询支持，返回群时间线消息。
	- 原有 `agentId + sessionKey` 读取保持兼容。

- `src/app/page.tsx`
	- 群聊改为读取 `/api/messages?groupId=...&channelId=...`。
	- 发送后群聊场景改为刷新群时间线，保证 relay 结果可见。

- `src/components/ChatArea.tsx`
	- 区分本地用户消息与“Agent 代发 user 消息”（relay 输入）。
	- Agent 代发消息使用左侧样式与发送者标识，便于观察协作链路。

### 验证
- 执行 `npm run build` 通过（Next.js + TypeScript 均成功）。

## 定时任务接入群主会话（群时间线）修复

### 问题
- 定时任务执行仍是旧实现，没有写入当前群组主会话（群时间线）。
- 部分历史任务 `lastRun` 缺失时不会触发。

### 改动
- `src/cron-daemon.ts`
	- 重构为 OpenClaw 原生执行链路（`openclaw agent --json`），不再使用旧版 AI SDK 本地工具拼装执行。
	- 执行前确保群成员会话初始化（`initializeGroupSessions`）。
	- 定时任务触发时写入群时间线 user 事件：`[定时任务触发] @agentId ...`。
	- Agent 执行结果写回群时间线 assistant 消息（附 `meta.source = cron`）。
	- 同步写入目标 Agent 会话（保证会话记录完整）。
	- `lastRun` 容错：缺失时按 `0` 处理，避免任务永久不触发。
	- 配置读取修正为 `~/.openclaw/openclaw.json`。

### 验证
- 执行 `npm run build` 通过。

### 会话对齐修正（针对群主会话键）
- 修复 `src/cron-daemon.ts`：定时任务不再使用 `cron_task` 伪 peer，而是复用群组 owner peer（如 `ou_local_user`），与群主会话键保持一致。
- 目标 Agent 选择策略调整：优先 `cron.agentId`（且必须在群成员中），否则回退 `leaderId`/首成员，避免错误落到 `main`。
- OpenClaw 执行参数改为 `--session-id <session.sessionId>`，避免会话 ID 误传导致落入非预期会话命名空间。
- 进一步对齐：定时任务不再自行拼会话，改为直接复用 `initializeGroupSessions` 返回的 `sessionKey/sessionId`。
- 与群聊主链路一致，OpenClaw 调用改为使用群会话键（`sessionKey`）作为 `--session-id` 入参。

### 定时任务路由策略修正（按分配 Agent）
- 根据需求修正：定时任务会话归属以 `cron.agentId` 为唯一目标，不再回退到 leader/首成员。
- 这保证“任务分配给谁，就写入谁的 clawchating 群会话”。

### Cron CLI 会话参数修正
- 修复 `src/cron-daemon.ts`：`openclaw agent --session-id` 改为传 `sessionId (uuid)`，不再传 `sessionKey`。
- 避免 OpenClaw CLI 将无效 session-id 回退到默认会话（如 `agent:main:openai:*`）。

### Cron 会话归属诊断增强
- 增加 `cron_session_target` 结构化日志，打印 `cronId/configuredAgentId/resolvedAgentId/sessionKey/sessionId`，用于排查会话误路由。
- 增加目标 Agent 硬校验：若 `cron.agentId` 不存在于 OpenClaw agents.list，直接写入群时间线错误并跳过执行。
- 根据 chat 成功链路调整：cron 调用改为使用 `sessionKey` 作为 `openclaw agent --session-id` 入参。

### 定时任务执行链路重构（复用群组呼唤逻辑）
- `src/cron-daemon.ts` 改为直接调用 `src/app/api/chat/route.ts` 的 `POST`，不再单独维护一套 OpenClaw 调用链。
- 语义对齐：定时任务等价于“系统发起一次群内 @ 呼唤”，因此自动复用：
	- 群会话初始化与 session 归属
	- 群时间线写入
	- `@` 解析与 relay 协作
	- 能力与提示词约束
- 新增日志 `cron_dispatch_via_chat`，用于确认 cron 触发时传给 chat 路由的 agent/group/channel 参数。
