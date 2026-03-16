import { Settings, X, Check, FolderClosed, Save, FileEdit } from 'lucide-react';
import { cn } from '../lib/utils';
import { Agent } from '../lib/types';

interface SettingsViewProps {
  agents: Agent[];
  nativeSkills?: Array<{ name: string; description?: string; source?: string }>;
  configAgentId: string;
  setConfigAgentId: (id: string | null) => void;
  configTab: 'capabilities' | 'files';
  setConfigTab: (tab: 'capabilities' | 'files') => void;
  activeConfigFileName: string | null;
  basicConfigContent: string;
  setBasicConfigContent: (content: string) => void;
  isSavingConfig: boolean;
  loadAgentConfigFile: (agentId: string, filename: string) => void;
  saveAgentConfigFile: (agentId: string) => void;
  toggleAgentCapability: (agentId: string, cap: 'read'|'write'|'exec'|'invite'|'skills') => void;
  isUpdatingCapabilities?: boolean;
}

export function SettingsView({
  agents,
  nativeSkills = [],
  configAgentId,
  setConfigAgentId,
  configTab,
  setConfigTab,
  activeConfigFileName,
  basicConfigContent,
  setBasicConfigContent,
  isSavingConfig,
  loadAgentConfigFile,
  saveAgentConfigFile,
  toggleAgentCapability,
  isUpdatingCapabilities = false,
}: SettingsViewProps) {
  const agent = agents.find(a => a.id === configAgentId);

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-900 relative z-10 shadow-2xl">
      <header className="h-16 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur flex items-center justify-between px-6 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setConfigAgentId(null)} 
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-white"
            title="返回聊天"
          >
            <X className="w-5 h-5" />
          </button>
          <h3 className="text-lg font-semibold flex items-center gap-2 text-white">
            <Settings className="w-5 h-5 text-indigo-400" /> 
            {agent?.name} 的配置中心
          </h3>
        </div>
        <div className="flex bg-neutral-800 rounded-lg p-1 gap-1">
          <button 
            onClick={() => setConfigTab('capabilities')} 
            className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", configTab === 'capabilities' ? "bg-neutral-700 text-white shadow" : "text-neutral-400 hover:text-white")}
          >
            工具权限
          </button>
          <button 
            onClick={() => {
              setConfigTab('files');
              if (!activeConfigFileName) {
                loadAgentConfigFile(configAgentId, 'SOUL.md');
              }
            }} 
            className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", configTab === 'files' ? "bg-neutral-700 text-white shadow" : "text-neutral-400 hover:text-white")}
          >
            人设与配置
          </button>
        </div>
      </header>
      
      <div className="flex-1 overflow-hidden flex flex-col bg-[#0b0b0b]">
        {configTab === 'capabilities' ? (
          <div className="p-8 max-w-4xl mx-auto w-full space-y-8 overflow-y-auto">
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex gap-3 text-orange-200/80 text-sm">
              <div className="mt-0.5">⚠️</div>
              <div>
                此设置将全局改变该 Agent 的行为和权限，它在单聊和各个群组组别内通常生效。由于底层接口权限控制可能涉及风险，建议仅为受信任的 Agent 开启相关执行权限。未来我们将在此页面预留更多的大模型微调设定。
              </div>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-neutral-200 mb-2 mt-4">工作区操作权限</h4>
              <p className="text-sm text-neutral-400 mb-6">配置该 Agent 在系统中的本地文件读写与命令执行权限。</p>
              {isUpdatingCapabilities && (
                <p className="text-xs text-indigo-400/90 mb-4">正在写入 .openclaw/openclaw.json...</p>
              )}
            </div>
            
            <div className="space-y-4">
              {[
                { key: 'read', label: '文件目录读取 (Read)', desc: '允许读取所处工作区内所有的代码以及文档。关闭此功能此会使Agent无法记忆上下文工作内容。' },
                { key: 'write', label: '文件内容写入 (Write)', desc: '允许在工作区中创建、更新、删除或覆写文件。通常需要搭配 Read 开启以正常工作。' },
                { key: 'exec', label: '系统命令执行 (Exec)', desc: '高危: 允许执行终端底层命令 (例如 npm run build)。开启此功能时请确保底层在沙箱内，否则非常危险！' },
                { key: 'invite', label: '拉取进群 (Invite)', desc: '允许 Agent 调用工具将其他已知 Agent 拉入群聊。默认关闭。' },
                { key: 'skills', label: '原生技能通道 (Skills)', desc: '允许 Agent 使用 OpenClaw 原生 Skills（如 feishu-doc、weather 等）及其技能说明上下文。建议仅对可信 Agent 开启。' }
              ].map((cap) => {
                const isEnabled = agent?.capabilities?.[cap.key as 'read'|'write'|'exec'|'invite'|'skills'] ?? false;
                return (
                  <label key={cap.key} className="flex items-center gap-4 cursor-pointer group p-5 rounded-xl border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-800 hover:border-neutral-700 transition-colors">
                    <div className={cn("w-6 h-6 rounded border flex items-center justify-center transition-colors shrink-0", isEnabled ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-600 bg-neutral-800")}>
                      {isEnabled && <Check className="w-4 h-4" />}
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={isEnabled}
                      disabled={isUpdatingCapabilities}
                      onChange={() => toggleAgentCapability(configAgentId, cap.key as 'read'|'write'|'exec'|'invite'|'skills')}
                    />
                    <div>
                      <div className="text-base font-medium text-neutral-200 group-hover:text-white transition-colors">{cap.label}</div>
                      <div className="text-sm text-neutral-500 mt-1">{cap.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="text-sm font-semibold text-neutral-200 mb-2">当前可用原生技能</div>
              <p className="text-xs text-neutral-500 mb-3">此列表来自 OpenClaw 原生 skills，开关开启后该 Agent 可在对话中调用。</p>
              {nativeSkills.length === 0 ? (
                <div className="text-sm text-neutral-500">暂无可用技能（或 OpenClaw 未就绪）。</div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {nativeSkills.map((skill) => (
                    <div key={skill.name} className="rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
                      <div className="text-sm text-neutral-200 font-medium">{skill.name}</div>
                      <div className="text-xs text-neutral-500 mt-1">{(skill.description || '').trim() || '无描述'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-64 bg-neutral-950 border-r border-neutral-800 p-3 overflow-y-auto space-y-1.5 shrink-0 flex flex-col">
              <div className="text-xs font-semibold text-neutral-500/80 uppercase tracking-wider mb-3 px-3 pt-2">底层性格文件</div>
              {['SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'AGENTS.md', 'MEMORY.md'].map(file => (
                <button 
                  key={file}
                  onClick={() => loadAgentConfigFile(configAgentId, file)}
                  className={cn("w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-3", activeConfigFileName === file ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20" : "text-neutral-400 border border-transparent hover:bg-neutral-800/80 hover:text-neutral-200")}
                >
                  <FileEdit className={cn("w-4 h-4", activeConfigFileName === file ? "opacity-100" : "opacity-60")} />
                  {file}
                </button>
              ))}
            </div>
            <div className="flex-1 flex flex-col bg-neutral-900 border-l border-neutral-800/50">
              <div className="h-14 border-b border-neutral-800 flex justify-between items-center px-6 bg-neutral-900/50 shrink-0">
                <span className="text-sm font-mono text-emerald-400/90 flex items-center gap-2">
                   <FolderClosed className="w-4 h-4 opacity-70" />
                   workspace-{configAgentId} / {activeConfigFileName}
                </span>
                <button 
                  onClick={() => saveAgentConfigFile(configAgentId)}
                  disabled={isSavingConfig}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-all shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  {isSavingConfig ? '存入底层...' : '保存更改'}
                </button>
              </div>
              <textarea 
                value={basicConfigContent}
                onChange={(e) => setBasicConfigContent(e.target.value)}
                className="flex-1 bg-neutral-900 text-[14px] font-mono text-neutral-300 p-6 resize-none focus:outline-none leading-relaxed"
                spellCheck={false}
                placeholder={activeConfigFileName ? `正在编辑 ${activeConfigFileName}... (如果空白说明仍未生成或文件为空)` : '请在左侧选择需要修改的配置文件...'}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
