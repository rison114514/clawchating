# 2026-03-13 变更整理

## 背景与目标
- 修复群组聊天中 @ 指向 agent 失效、被默认转到 main 的问题。
- 修复/优化 OpenClaw agent 的工具权限读取与执行逻辑。
- 让设置页权限开关持久化到后端配置，而非仅前端会话内生效。
- 增强群组的 channel 会话语义。

## 主要改动

### 1) 群聊路由与 @ 指向修复
文件: src/app/page.tsx

- 新增更稳健的 mention 解析逻辑：支持按 agent 名称与 agent id 匹配，并采用“最近一次命中”作为路由目标。
- 提交时实时按输入框最新文本解析目标 agent，避免渲染态与提交态不同步导致错路由。
- 群聊默认路由优先 leaderId，其次成员首位，再兜底 main。
- isMention 与 agentId 在提交 body 中显式传递。

### 2) Chat API 的 agent 校验与能力收敛
文件: src/app/api/chat/route.ts

- 新增 agentId 参数校验：
  - 缺失时返回 400。
  - 不存在于 openclaw 配置中的 agentId 返回 400。
- 能力执行改为“前端请求能力 ∩ openclaw agent 实际授权能力”的交集。
- system prompt 注入 resolved agent 展示名，增强 agent 身份一致性。

### 3) OpenClaw 模型选择与 404 规避
文件: src/app/api/chat/route.ts

- 不再仅依赖固定本地 gateway 模式。
- 增加从 ~/.openclaw/openclaw.json 解析 provider/model 的逻辑：
  - 读取 agents.defaults.model 与 providers 映射。
  - 解析 providerId/modelId 后调用对应上游 baseUrl/v1。
  - 若无法解析，保留回退到本地 gateway 的路径。
- 目的: 避免本地 gateway 路径差异导致 404，并与实际 openclaw 配置对齐。

### 4) Agent 列表能力映射增强
文件: src/app/api/agents/route.ts

- GET /api/agents 返回中新增 capabilities 字段。
- 从 tools.alsoAllow 映射 read/write/exec/invite。
- 前端加载 agents 时不再使用硬编码权限默认值。

### 5) 设置页权限开关持久化
文件: src/app/api/agents/route.ts, src/app/page.tsx, src/components/SettingsView.tsx

- 新增 PUT /api/agents：
  - 入参 agentId + capabilities。
  - 写回 ~/.openclaw/openclaw.json 中对应 agent.tools.alsoAllow。
  - 仅增删映射范围内的工具，不影响其他工具项。
- 前端 toggle 改为异步持久化：
  - 乐观更新 UI。
  - 请求失败时回滚并提示。
- 设置页新增“正在写入配置”状态与临时禁用复选框。

### 6) 群组消息会话改为 channel 维度
文件: src/app/page.tsx

- useChat id 与消息持久化 sessionIdentifier 改为 group-channel:{channelId}。
- 使群组会话具有更明确的 channel 语义，减少按 groupId 固定分桶导致的串会话问题。

### 7) 安全与配置细节
文件: src/cron-daemon.ts, src/app/api/chat/route.ts

- 移除硬编码 API Key，改为环境变量 OPENCLAW_API_KEY。

## 额外说明
- 本次改动覆盖了路由、模型解析、能力持久化、会话标识四条链路。
- 已完成相关文件的编译级检查。
- 项目仍有部分历史 lint 项（与本次功能无直接耦合），未在此次提交中做全量风格化重构。

## 建议验证清单
1. 群组中分别 @不同 agent，确认响应身份和工具能力符合预期。
2. 切换设置页权限后刷新页面，确认能力状态仍保持。
3. 修改 group channel 后发送消息，确认消息进入对应 channel 会话桶。
4. 验证未知 agentId 请求应返回 400，而非静默回退 main。
