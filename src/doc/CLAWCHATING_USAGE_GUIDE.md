# Clawchating 使用与维护交接手册

本文档面向接手维护人员，目标是用一份文档覆盖以下内容：
- 现在系统有哪些核心能力
- 当前后端接口分别做什么
- 数据落盘位置在哪里
- 日常维护和故障排查应该怎么做

## 1. 系统边界与架构

### 1.1 角色边界
- OpenClaw 负责：agent 运行时、会话引擎、模型提供方、工具权限、网关。
- Clawchating 负责：Web UI、群组协作编排、业务路由、消息展示和恢复。

### 1.2 关键代码位置
- 前端入口：`src/app/page.tsx`
- 聊天主路由：`src/app/api/chat/route.ts`
- 消息读取：`src/app/api/messages/route.ts`
- 群组与共享工作区：`src/app/api/groups/route.ts`
- 定时任务：`src/app/api/crons/route.ts` 与 `src/cron-daemon.ts`
- OpenClaw 会话封装：`src/lib/session-runtime.ts`
- 模型配置接口：`src/app/api/models/config/route.ts`
- Agent 管理接口：`src/app/api/agents/route.ts`

## 2. 当前功能总览

### 2.1 聊天与会话
- 支持单聊与群聊两种会话。
- 群聊基于 `groupId + channelId + sender` 派生会话键。
- 聊天请求支持 traceId，便于串联前后端日志。
- 群聊支持 @ 提及解析与中继，带最大深度与目标上限保护。

### 2.2 群组协作
- 群组成员增删改查。
- 创建/更新群组时自动初始化成员会话。
- 自动创建共享工作区与 `GROUP_CONTEXT.md`。
- 自动复制本使用手册到组内工作区，便于成员阅读。

### 2.3 稳定性能力
- 请求超时可配置，当前聊天路由最大运行时间已放宽。
- 处理会话锁冲突（session lock）重试。
- 会话漂移检测（`returned_main_session`）与分层处理：
  - 主轮次可阻断并写入提示。
  - 中继轮次可容忍，避免整轮崩溃。
- 主会话回复兜底回读（main session fallback）。
- 手动恢复接口：从 session 文件恢复最近可用 assistant 消息到群时间线。

### 2.4 OpenClaw 配置与运维
- 前端支持 Agent 列表、默认 Agent、创建/删除 Agent。
- 前端支持 `tools.alsoAllow` 权限编辑（全开/全关/自定义）。
- 前端支持模型状态读取、默认模型/回退模型配置、Provider 鉴权。
- 前端支持执行 `openclaw config` 向导会话（wizard API）。

### 2.5 业务辅助功能
- 工作区文件浏览与 CRUD。
- 定时任务（间隔模式 + 每日模式）。
- 渠道注册 API（clawchating channel 一键注册脚本）。
- BIO-LI 标注脚本（离线批处理，支持断点续跑）。

## 3. 接口矩阵（按模块）

### 3.1 Chat 与消息

#### `POST /api/chat`
- 作用：统一聊天入口（单聊/群聊/中继）。
- 关键行为：
  - 构建 OpenClaw 原生提示并调用 `openclaw agent`。
  - 处理超时、锁冲突重试、会话漂移。
  - 群聊下写入 `.timeline-*.jsonl`。
  - 解析 @ 并触发 relay。

#### `POST /api/chat/recover`
- 作用：从指定 agent 历史 session 中恢复最近可用回复。
- 关键行为：
  - 优先扫描 group scoped session key。
  - 找不到再回退 main/default key。
  - 成功后写入群时间线，标记 `meta.recovered=true`。

#### `GET /api/messages`
- 作用：分页读取消息。
- 两种模式：
  - 群聊：`groupId + channelId`
  - 单聊：`agentId + sessionKey`

#### `POST /api/messages`
- 作用：向某 session 追加消息（底层写 jsonl）。

### 3.2 Group

#### `GET /api/groups`
- 返回所有群组配置。

#### `POST /api/groups`
- 创建群组。
- 自动做：
  - 保存到 `workspaces/groups.json`
  - 建立 group workspace
  - 初始化成员 session
  - 写 `GROUP_CONTEXT.md`
  - 复制 `OPENCLAW_USAGE_GUIDE.md`

#### `PUT /api/groups`
- 更新群组并处理新增成员初始化。

#### `DELETE /api/groups?id=...`
- 删除群组记录（不主动删除已有历史文件）。

### 3.3 Cron

#### `GET /api/crons`
- 读取定时任务列表。

#### `POST /api/crons`
- 新建任务。
- 支持 `scheduleType=interval|daily`。

#### `PUT /api/crons`
- 更新任务（含 active、scheduleType、intervalMin、dailyTime）。

#### `DELETE /api/crons?id=...`
- 删除任务。

#### 后台执行：`src/cron-daemon.ts`
- 每 30 秒扫描一次。
- 命中后通过 `POST /api/chat` 触发群聊任务。
- 结果追加到 `cron-execution.log`。

### 3.4 Agent 管理

#### `GET /api/agents`
- 返回 UI 需要的 agent 列表。
- 可带 `?resource=models` 获取模型列表。

#### `POST /api/agents`
- 调用 `openclaw agents add` 新建 agent。
- 可设置显示名与默认 agent。

#### `PATCH /api/agents`
- 设置默认 agent。

#### `DELETE /api/agents?agentId=...`
- 删除 agent（调用 OpenClaw CLI）。

#### `PUT /api/agents`
- 更新某 agent 的 `tools.alsoAllow`。
- 支持 `all-on` / `all-off` / 指定列表。

#### `GET /api/agents/config` 与 `PUT /api/agents/config`
- 读写 agent 工作区中的以下文件：
  - `AGENTS.md`
  - `SOUL.md`
  - `TOOLS.md`
  - `IDENTITY.md`
  - `USER.md`
  - `HEARTBEAT.md`
  - `BOOTSTRAP.md`

#### `GET /api/agents/avatar?agentId=...`
- 读取 agent 头像文件（带路径越界与符号链接安全校验）。

### 3.5 模型与配置

#### `GET /api/models/config`
- 返回模型状态、模型列表、provider 选项。

#### `POST /api/models/config`
- `mode=save-models`：保存默认模型、fallback、imageFallback、allowed。
- `mode=save-auth`：写 provider token。

#### `GET /api/models/config/wizard` 与 `POST /api/models/config/wizard`
- 管理 openclaw config 向导交互会话（start/input/stop/poll）。

### 3.6 其他接口

#### `POST /api/channels/register`
- 执行 `scripts/register-clawchating-channel.sh` 完成渠道注册。

#### `GET /api/skills`
- 读取 OpenClaw skills 列表（默认 eligible）。

#### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- 依赖环境变量：`CLAWCHATING_ADMIN_PASSWORD`

#### Workspace 文件
- `GET /api/workspace/files`
- `POST /api/workspace/files`
- `PUT /api/workspace/files`
- `DELETE /api/workspace/files`

## 4. 数据与文件落盘位置

### 4.1 项目内
- 群组定义：`workspaces/groups.json`
- 定时任务：`workspaces/crons.json`
- 群时间线：`workspaces/<groupId>/.timeline-<channelId>.jsonl`
- 群共享目录：`workspaces/<groupId>/`
- 定时执行日志：`workspaces/<groupId>/cron-execution.log`

### 4.2 OpenClaw 侧
- 主配置：`~/.openclaw/openclaw.json`
- agent sessions：`~/.openclaw/agents/<agentId>/sessions/`
- 每 agent 工作区：`~/.openclaw/workspace-<agentId>/`

## 5. 已知关键约束

1. OpenClaw 配置校验严格
- `agents.list` 下写入非 schema 字段会导致调用失败。
- 业务能力请写入 `tools.alsoAllow`，不要写自定义字段。

2. 会话漂移不是前端问题
- 在 channel/to 模式下，部分回包可能回到 `agent:<id>:main`。
- 已做 drift retry + 容忍策略，但仍需观察日志。

3. 超时感知
- `/api/chat` 与 OpenClaw 超时要一致。
- 前端长超时时，某些按钮会长时间处于 loading 态，属预期交互影响。

## 6. 日常维护流程（建议）

### 6.1 每日巡检
1. 检查 `openclaw channels list` 与 `openclaw status`。
2. 抽样发送单聊、群聊各 1 条。
3. 检查最近群时间线是否有 `failed_timeout` 或 `drift_blocked`。
4. 检查 `workspaces/crons.json` 的 lastRun 是否持续推进。

### 6.2 变更前后必做
1. 改动路由后执行最小 smoke test：
   - `/api/chat`
   - `/api/messages`
   - `/api/groups`
2. 涉及模型或权限时，验证 `openclaw.json` 可被 OpenClaw 接受。
3. 涉及群聊链路时，验证中继失败不会拖垮整轮（fail-soft）。

### 6.3 交接给新同学的最小步骤
1. 阅读本文件。
2. 跑通以下命令：
   - `openclaw agents list`
   - `openclaw channels list`
   - `openclaw doctor --fix`
3. 在 UI 里完成一次：
   - 创建群组
   - 发送群消息并 @ 1 个成员
   - 点击恢复按钮验证 recover 路由

## 7. 故障定位速查

### 7.1 报错 `Unknown channel: clawchating`
- 先执行注册接口或脚本：`POST /api/channels/register`。
- 确认 `openclaw.json` 内：
  - `plugins.allow` 包含 `clawchating-channel`
  - `plugins.load.paths` 包含插件路径
  - `channels.clawchating.enabled=true`

### 7.2 群聊超时多
- 查 `/api/chat` 的 timeout 配置与请求 payload。
- 查 timeline 中 `executionState=failed_timeout`。
- 先确认模型可用再判断业务问题。

### 7.3 群聊出现 `drift_blocked`
- 说明响应落到了 main session。
- 观察是否已经触发 drift retry。
- 如在 relay depth>0，原则上可容忍继续；若 depth=0 会阻断并提示。

### 7.4 恢复不生效
- 看 `POST /api/chat/recover` 是否找到 scoped session。
- 检查目标 agent session 文件是否有最近 assistant 文本消息。

## 8. BIO-LI 标注脚本维护说明

文件：`scripts/annotate_entities.py`

当前能力：
- 根据文件名自动识别任务类型（EQU/PER/ORG）。
- 调用 `openclaw agent --agent bio-li --json --local` 批量标注。
- 自动提取混合输出中的 JSON。
- 支持断点续跑（检测 `_annotated.txt` 已有行数并继续）。

建议：
- 批任务前先做 5 行试跑，确认返回格式稳定。
- 长任务建议保留中间产物，避免中断重跑。

## 9. 后续维护建议（优先级）

P0
- 给 `/api/chat` 增加更细粒度 metrics（超时、漂移、重试计数）。
- 将聊天与中继流程拆分为独立 service 层，降低路由复杂度。

P1
- 为关键 API 增加集成测试：chat/messages/groups/crons。
- 为 recover 逻辑增加可观测字段（命中 session key、候选数量）。

P2
- 将组内上下文、计划文件与运行日志做结构化归档。
- 为交接人员提供一键健康检查脚本。
