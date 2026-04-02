# 2026-04-01 变更整理

## Clawchating Channel 注册失败问题记录

### 现象
- 在「大模型配置 -> Clawchating Channel 注册」中执行注册时报错：
  - `ENOENT: no such file or directory, access '/home/rison/.openclaw/extensions/clawchating-channel/openclaw.plugin.json'`

### 原因确认
- 问题并非 OpenClaw 本身不支持该流程。
- 当前仓库内未包含 `clawchating-channel` 插件产物（`openclaw.plugin.json` / 插件目录未随项目提交）。
- 结论：属于本地自创插件文件缺失（遗漏上传）导致注册脚本无法完成插件加载。

### 处理状态
- 已定位根因并确认。
- 已完成修复：
  - 将 `extensions/clawchating-channel/` 插件产物（`openclaw.plugin.json`、`package.json`、`dist/index.js`）纳入仓库，支持新用户零预装场景。
  - 增强 `scripts/register-clawchating-channel.mjs`：
    - 增加仓库相对路径候选，避免非项目根目录执行时找不到本地插件。
    - 增加混合输出 JSON 解析能力，兼容 OpenClaw CLI 在 JSON 前输出告警日志的场景。
    - 当安装返回 "plugin already exists" 时转为回收已存在插件目录并继续注册。
  - 已本地验证注册脚本可成功执行。

### 备注
- 后续建议在发布前增加“插件完整性检查”，避免注册流程在缺失插件产物时直接失败。
