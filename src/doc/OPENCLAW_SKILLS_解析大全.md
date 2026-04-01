# OpenClaw Skills 解析大全（含 ClawHub 与实战维护）

更新时间：2026-03-29
适用版本：OpenClaw 2026.3.8（已在本机命令实测）

## 0. 结论先看

- Skills 是 OpenClaw 中“任务能力包”，核心文件是 SKILL.md。
- 你的本机 OpenClaw 2026.3.8 在 skills 子命令上以本地管理为主：list/info/check。
- 安装、搜索、发布技能的主力工具是 ClawHub CLI（clawhub 命令），而不是本机 openclaw skills install。
- 给 agent 装技能，本质上有两层：
  - 能否触发 Skills（global 开关与 agent 工具权限）
  - Skill 本体是否已存在于可见目录并满足依赖

## 1. Skills 是什么

从官方与 ClawHub 信息归纳，Skills 可以理解为：

- 一个可触发的任务能力单元。
- 以 SKILL.md 为核心入口，描述“何时用”和“怎么做”。
- 可带可执行脚本、参考文档、资源文件，形成完整工作流。

典型收益：

- 把高重复、易错、多步骤任务固化。
- 降低模型上下文成本（只在触发后按需加载）。
- 让 agent 从“会聊天”变成“可执行任务”。

## 2. Skills 目录与触发机制

### 2.1 Skill 最小结构

最小要求：

- skill-name/SKILL.md

推荐结构：

- skill-name/SKILL.md
- skill-name/scripts/
- skill-name/references/
- skill-name/assets/

### 2.2 SKILL.md 的关键点

来自 ClawHub 的 skill-creator 说明，触发最关键的是 frontmatter：

- name
- description

重点：

- description 里要写清“在什么场景触发”。
- body 是触发后才加载，触发逻辑不能只写在 body。
- 不要把 SKILL.md 写成超长文档，推荐渐进披露，把细节放 references。

## 3. 本机 2026.3.8 命令实测结论

### 3.1 openclaw skills 当前可用命令

实测可用：

- openclaw skills list
- openclaw skills list --eligible --json
- openclaw skills info <name> --json
- openclaw skills check --json

实测现象：

- openclaw skills search/install/update 在本机版本不会进入对应子命令（仍返回 skills 主帮助）。
- 说明文档与本机版本存在命令差异。

维护建议：

- 每次升级后先跑：openclaw skills --help
- 文档里标注“版本差异矩阵”，不要盲抄线上命令。

### 3.2 skills list 输出里你要关注什么

你项目里已接入了 skills 列表解析，关键字段包括：

- name
- description
- eligible
- disabled
- blockedByAllowlist
- source
- bundled
- missing（依赖缺失项）

可直接用于前端可视化“可用/不可用”状态。

## 4. ClawHub 是什么（官方与仓库）

综合 clawhub.ai 与 openclaw/clawhub 仓库信息：

- ClawHub 是公开技能注册中心与分发平台。
- 支持技能发布、版本化、搜索、安装、更新。
- 仓库开源（MIT），并有安全扫描与治理相关机制。
- 网站有技能市场、可疑技能提示、政策约束（about 页面列出禁用场景）。

你可以把 ClawHub 理解为“技能生态层”，而 OpenClaw 本体负责“运行时加载与触发”。

## 5. 如何给 agent 装技能（实战流程）

这里给出项目可落地、风险最低的一套流程。

### 5.1 安装/同步技能

优先使用 clawhub 命令（而非依赖 openclaw skills install）：

- clawhub login
- clawhub search <keyword>
- clawhub inspect <slug>
- clawhub install <slug>
- clawhub update --all
- clawhub list

如果你用 npx 方式：

- npx clawhub@latest install <slug>

### 5.2 确认本机 OpenClaw 可见

- openclaw skills list --eligible --json
- openclaw skills info <name> --json
- openclaw skills check --json

### 5.3 给目标 agent 打开 skills 能力

在你当前项目实现里，skills 可用受两层控制：

- global：commands.nativeSkills 不能是 off
- agent：tools.alsoAllow 包含 skills（并结合项目内权限逻辑）

你项目已有管理入口：

- 接口：src/app/api/agents/route.ts
- 前端：Settings 里的 tools 权限配置

### 5.4 运行时确认

你项目聊天路由会把可用技能注入提示区：

- 逻辑位置：src/app/api/chat/route.ts
- 注入段：EligibleSkills

可通过开启 trace 观察是否带入技能列表。

## 6. 如何创造技能（从 0 到可发布）

下面是可执行的标准流程。

### 6.1 设计阶段

- 先定义触发语句样本（用户怎么说会触发）。
- 把流程拆成：固定步骤 vs 可变步骤。
- 固定步骤尽量脚本化（scripts）。

### 6.2 目录初始化

创建 skill 目录，并至少包含：

- SKILL.md

可选：

- scripts（可执行步骤）
- references（按需加载知识）
- assets（模板/素材）

### 6.3 编写 SKILL.md

必须做到：

- name 与 description 准确。
- description 里覆盖触发条件、适用边界、禁止行为。
- body 保持简洁，复杂说明外置到 references。

### 6.4 本地验证

最少验证三件事：

- 语法结构正确（frontmatter 可解析）。
- 依赖声明完整（env/bin）。
- 关键脚本可运行（不要只靠静态检查）。

### 6.5 发布到 ClawHub

建议流程：

- clawhub publish <path>
- 发布后用 clawhub inspect 与 clawhub install 做回归。
- 记录版本变更与回滚策略。

## 7. 安全治理（必须执行）

网络社区与平台信息都反复强调：技能供应链是高风险面。

建议你采用以下强制流程：

- 安装前先 inspect 源码与依赖。
- 检查是否声明了敏感 env 与网络访问。
- 仅安装可追溯作者、可读源码、维护活跃的技能。
- 给 skills 最小权限，不做全量通配授权。
- 对高风险技能单独 sandbox。
- 定期复审已安装技能（尤其涉及外网、凭据、文件系统）。

## 8. 你项目中的 Skills 相关实现（交接要点）

### 8.1 API 与前端

- API：src/app/api/skills/route.ts
  - 代理 openclaw skills list
  - 返回 eligible/source/bundled/missing 等字段
- 前端：src/app/page.tsx + src/components/SettingsView.tsx
  - 拉取并展示 native skills

### 8.2 聊天注入链路

- src/app/api/chat/route.ts
  - 根据 agent 权限与全局配置，决定是否注入 EligibleSkills
  - 这会直接影响模型是否“意识到”可用技能

### 8.3 会话快照

- src/lib/session-runtime.ts
  - 维护 skillsSnapshot 字段
  - 便于追踪当时会话启用的能力上下文

## 9. 版本差异与兼容矩阵（当前）

当前环境（2026.3.8）实测：

- openclaw skills list/info/check：可用
- openclaw skills search/install/update：本机不可用或未暴露
- clawhub CLI：建议作为安装/发布主入口

维护策略：

- 把“命令可用性检查”加入升级后 smoke test。
- 文档按“本机实测优先，线上文档补充”原则维护。

## 10. 推荐的接手维护清单

每次接手或升级后，按顺序执行：

1. openclaw --version
2. openclaw skills --help
3. openclaw skills list --eligible --json
4. clawhub --help
5. clawhub list
6. 在 UI 触发一次含技能的任务，检查 chat trace 里 EligibleSkills
7. 随机抽样 1-2 个已装技能做安全复核

## 11. 外部资料可信度分层（给维护者）

- 高可信：
  - docs.openclaw.ai 官方文档
  - github.com/openclaw/clawhub 仓库文档
  - 本机 CLI 实测输出

- 中可信：
  - clawhub.ai 技能详情页与 about 政策页

- 低可信（需交叉验证）：
  - 社区博客/帖子（包含大量经验文、观点文、安全事件文）

原则：

- 博客可用于经验启发，不可直接当“事实标准”。
- 任何关键命令、版本行为、权限模型，必须以本机实测与官方仓库为准。
