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
- 待补充项：将 `clawchating-channel` 插件目录与清单文件纳入项目并提交，随后重新执行注册脚本。

### 备注
- 后续建议在发布前增加“插件完整性检查”，避免注册流程在缺失插件产物时直接失败。
