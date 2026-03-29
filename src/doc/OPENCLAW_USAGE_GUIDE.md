# OpenClaw 操作与使用指南（含与 Clawchating 的区别）

## 1. 文档目的

本文档总结近期在实际项目中验证过的 OpenClaw 使用方法、常见问题处理、稳定性建议，以及与 Clawchating 项目的边界划分。

适用对象：

- 新加入项目的开发者
- 需要排查 agent 调用问题的同学
- 需要理解 OpenClaw 与 Clawchating 协作关系的维护者

## 2. 基础概念

OpenClaw 是 Agent Runtime 与网关系统，负责：

- agent 定义与会话状态
- 模型提供方与模型路由
- 网关通信与插件系统
- 工具权限与会话执行

Clawchating 是上层业务应用，负责：

- Web UI（聊天、群组、设置、历史）
- 会话路由与群组协作协议（如 @ 路由）
- 业务功能（群组、定时任务、消息分页等）

## 3. 常用命令速查

### 3.1 环境与健康检查

```bash
openclaw --version
openclaw doctor --fix
openclaw agents
openclaw agents list --json
```

### 3.2 Agent 相关

```bash
openclaw agents add <agentId> --non-interactive --workspace <path> --json
openclaw agents set-identity --agent <agentId> --name "显示名" --json
openclaw agent --agent <agentId> --message "hello" --json --timeout 30
```

### 3.3 Skills 与配置

```bash
openclaw skills list --eligible --json
openclaw config
```

### 3.4 网关

```bash
openclaw gateway install --force
openclaw gateway status
```

## 4. openclaw.json 关键配置说明

路径：~/.openclaw/openclaw.json

### 4.1 常见关键字段

- agents.defaults.timeoutSeconds
  - 建议设置为 180-300，避免长任务在默认短超时下被中止。
- agents.list[].tools.alsoAllow
  - 决定工具能力（read/write/exec/subagents/skills 等）。
- models.providers
  - 模型提供方、API、模型列表及输入能力（text/image）。
- gateway
  - 网关端口、鉴权模式、通信限制。

### 4.2 已验证的高频坑

1. 配置严格校验
- OpenClaw 2026.3.8 会严格校验 agents.list 下字段。
- 非官方字段会触发 Config invalid，导致 agent 调用直接失败。

2. 不要在 agents.list 项写自定义字段
- 例如 clawchating 这类自定义字段可能导致校验失败。
- 能力控制应通过 tools.alsoAllow 与 commands.nativeSkills。

3. session 锁冲突
- 并发调用同一 agent 时，可能出现 session file locked。
- 需要在上层路由做重试或隔离 session-id。

## 5. 在 Clawchating 中如何正确调用 OpenClaw

### 5.1 单聊

- Web 提交后由 /api/chat 统一转发到 openclaw agent。
- 推荐在后端使用可配置超时，避免硬编码短超时。

### 5.2 群聊与多 @ 协作

- Clawchating 会先解析 @ 提及对象，再在群成员范围内过滤。
- 中继应具备 fail-soft 机制：
  - 单个目标失败时跳过，不应让整轮失败。

### 5.3 配置一致性要求

- Clawchating 读写 openclaw.json 时，必须遵循 OpenClaw schema。
- 不应把业务私有字段写回 OpenClaw 配置。

## 6. 与 Clawchating 的职责区分

| 维度 | OpenClaw | Clawchating |
|---|---|---|
| 核心定位 | Agent Runtime / 网关 / 工具系统 | 业务 Web 应用与协作编排 |
| 配置主文件 | ~/.openclaw/openclaw.json | 项目内 src 与 workspaces 数据 |
| 消息执行 | openclaw agent 命令与会话引擎 | /api/chat 路由与前端交互 |
| 群组协作 | 提供 agent 能力基础 | @ 解析、成员过滤、中继队列 |
| 权限控制 | tools.alsoAllow、nativeSkills | UI 侧配置入口与策略映射 |
| 失败处理 | 返回底层错误与诊断信息 | 统一错误展示、重试与降级策略 |

简要原则：

- OpenClaw 管“执行引擎与规则”；
- Clawchating 管“产品交互与业务编排”。

## 7. 建议的排障流程

1. 先看配置合法性
- 运行 openclaw doctor --fix。
- 检查 openclaw.json 是否包含非 schema 字段。

2. 再看会话与锁
- 若出现 session file locked，优先判断并发冲突与 session-id 复用。

3. 再看模型与超时
- 是否模型可用、是否 timeoutSeconds 太短。

4. 最后看业务路由
- 检查 Clawchating 群组成员过滤、relay 深度、失败兜底逻辑。

## 8. 生产稳定性建议

- 所有调用统一返回结构化 JSON 错误。
- 前端展示真实错误原因，不要只显示通用失败文案。
- 群组多目标中继必须支持局部失败继续。
- 对超时与 session 锁冲突做有限重试并记录日志。
- 避免在 openclaw.json 写入任何未被 OpenClaw 官方识别的字段。

## 9. 近期实践结论（可直接复用）

- 多 agent 呼叫失败，常见并非 @ 解析失败，而是某个目标执行失败拖垮全局。
- 将 relay 调整为 fail-soft 后，系统鲁棒性显著提升。
- OpenClaw 配置 schema 兼容性是基础前置条件；配置非法时所有上层优化都无效。

## 10. 维护建议

- 每次升级 OpenClaw 后，先跑 doctor 与一次最小 smoke test。
- 若改动了配置写入逻辑，务必验证生成的 openclaw.json 可被 OpenClaw 接受。
- 在 Clawchating 项目中保留本文件，作为 onboarding 与排障入口。
