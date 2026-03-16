# 2026-03-15 变更整理

## 背景与目标

- 将 Clawchating 与 OpenClaw 的会话、技能、Agent 生命周期进一步对齐。
- 完成群组/Agent 管理可视化闭环（创建、删除、默认设置、成员管理）。
- 增强工具权限与工作区隔离能力，避免跨目录和越权行为。
- 提升前端可观测性与可用性（头像、技能列表、未知成员占位、滚动与交互反馈）。

## 主要改动

### 1) 会话运行时重构（Session Runtime）

涉及文件：

- src/lib/session-runtime.ts（新增）
- [route.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [route.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [route.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)

改动说明：

- 新增统一会话运行时模块，提供：
  - 会话确保与复用（ensureAgentSession）
  - 消息追加（appendSessionMessage）
  - 历史读取（loadSessionMessages）
  - 群组成员批量会话预初始化（initializeGroupSessions）
  - 语义增强输入封装（toSemanticInput）
- 聊天接口改为基于会话键与语义输入驱动，替代原先流式 useChat 直连方案。
- 消息接口从工作区 messages.json 迁移为按 agentId + sessionKey 查询与写入，避免串会话。
- 群组创建与成员新增时触发会话预初始化，提升首轮响应稳定性。

### 2) Chat API 能力模型与工具体系增强

涉及文件：

- [route.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)

改动说明：

- 能力模型新增 skills 开关，并参与前端请求能力与后端授权能力交集计算。
- 新增共享/Agent 双工作区作用域：
  - 文件读写与命令执行支持 scope=shared|agent
  - 路径解析加入越界防护，禁止路径逃逸
- 新增原生技能工具链：
  - list_native_skills
  - read_native_skill
  - use_native_skill
- 系统提示词增加当前 Agent 身份、可用能力、工作区与技能上下文说明。
- 继续保留上游 provider/model 解析与本地 gateway 回退策略。

### 3) Agent 管理 API 全面升级

涉及文件：

- [route.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- src/app/api/agents/avatar/route.ts（新增）
- src/app/api/skills/route.ts（新增）

改动说明：

- Agent 列表聚合 openclaw 配置与 native agents list 结果，支持：
  - identityName / identityEmoji / identityAvatar / isDefault
- 能力配置持久化扩展至 skills，并写入 clawchating.skillsEnabled。
- 新增 Agent 生命周期接口：
  - POST 创建 Agent（支持 model、workspace、bindings、可选设为默认）
  - PATCH 设为默认 Agent
  - DELETE 删除 Agent
- 新增头像读取 API，支持 workspace 内相对路径头像文件读取并做路径安全校验。
- 新增技能查询 API，返回可用原生 skills 列表与元信息。

### 4) 前端聊天与状态流重构

涉及文件：

- [page.tsx](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [ChatArea.tsx](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [RightSidebar.tsx](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [Sidebar.tsx](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [SettingsView.tsx](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [types.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)

改动说明：

- 页面层改为手动请求聊天接口，统一处理消息加载、提交、失败兜底与消息落库。
- Agent 类型扩展：avatarEmoji、hasAvatarImage、isDefault、skills capability。
- 群组 owner 信息补齐并回写，保证会话归属语义一致。
- 新增 Agent 可视化管理能力：
  - 侧边栏新增“创建 Agent”入口
  - 删除 Agent 弹窗确认
  - 设置默认 Agent（星标）
  - 显示头像图片或 emoji
- 设置页新增 skills 能力开关与原生技能列表展示。
- 群组右侧面板新增成员移除操作；负责人可切换；未知成员可占位显示。
- 群聊顶部成员芯片改为可滚动区域，避免数量大时裁剪丢失。

### 5) 群组创建默认注入 skills 目录与说明文件

涉及文件：

- [route.ts](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)

改动说明：

- 新增群组创建后初始化逻辑：
  - 自动创建 workspaces/{groupId}/skills 目录
  - 自动写入 skills/README.md（Clawchating 专属技能使用方法模板）
- 实现“每个新群组默认具备技能说明文件”的基础设施。

### 6) WebSocket 插件与依赖补全

涉及文件：

- src/plugins/clawchating-ws-plugin.ts（新增）
- [package.json](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)
- [package-lock.json](vscode-file://vscode-app/c:/Users/rison/AppData/Local/Programs/Microsoft VS Code/ce099c1ed2/resources/app/out/vs/code/electron-browser/workbench/workbench.html)

改动说明：

- 新增 clawchating-ws-plugin，提供 RPC 风格能力：
  - session.ensure / session.history / session.append
  - skills.list / skills.invoke
- 新增依赖：
  - ws
  - @types/ws
  - tsx
- 新增脚本：
  - plugin:clawchating-ws

### 7) 中间脚本清理

已删除文件：

- patchGroups.js
- patchGroups2.js
- patchRightSidebarLeader.js
- rewrite.js

改动说明：

- 清理临时补丁脚本，避免后续误用与仓库噪音。
- 已确认不被源码引用后再删除。

## 验证结果

- 本次相关改动已完成编译验证，next build 通过。
- 群组成员移除、默认 Agent 设置、技能列表读取、头像读取路径保护等关键路径已完成基本流程验证。

## 建议回归清单

1. 新建群组后检查是否自动生成 skills/README.md。
2. 在设置页切换 skills/read/write/exec/invite 后刷新，确认状态持久化。
3. 在群聊中分别测试 shared/agent 作用域的工具调用，确认目录隔离正确。
4. 验证创建 Agent 时不勾选“设为默认”不会覆盖原默认 Agent。
5. 验证删除群成员后 leader 回退逻辑与成员卡片显示一致。
6. 验证头像文件路径越界请求被拒绝。
   EOF