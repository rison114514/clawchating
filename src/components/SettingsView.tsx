import { Settings, X, Check, FolderClosed, Save, FileEdit, Database, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { Agent } from '../lib/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { OpenClawTerminal } from './OpenClawTerminal';

type OpenClawModelConfig = {
  configPath: string;
  defaultModel: string;
  imageModel: string | null;
  fallbacks: string[];
  imageFallbacks: string[];
  allowed: string[];
  authProviders: Array<{ provider: string; effectiveKind: string; effectiveDetail: string }>;
};

type OpenClawModelItem = {
  key: string;
  name?: string;
  input?: string;
  contextWindow?: number;
  available?: boolean;
  local?: boolean;
  tags?: string[];
};

type OpenClawProviderOption = {
  value: string;
  label: string;
  hint?: string;
  choices: string[];
};

interface SettingsViewProps {
  agents: Agent[];
  nativeSkills?: Array<{ name: string; description?: string; source?: string }>;
  configAgentId: string;
  setConfigAgentId: (id: string | null) => void;
  configTab: 'capabilities' | 'files' | 'models';
  setConfigTab: (tab: 'capabilities' | 'files' | 'models') => void;
  openClawModelConfig: OpenClawModelConfig | null;
  openClawModels: OpenClawModelItem[];
  openClawProviders: OpenClawProviderOption[];
  isLoadingOpenClawModelConfig: boolean;
  isSavingOpenClawModelConfig: boolean;
  refreshOpenClawModelConfig: () => Promise<void>;
  saveOpenClawModelConfig: (payload: {
    defaultModel: string;
    imageModel: string | null;
    fallbacks: string[];
    imageFallbacks: string[];
    allowed: string[];
  }) => Promise<void>;
  saveOpenClawProviderAuth: (payload: {
    provider: string;
    apiKey: string;
    profileId?: string;
  }) => Promise<void>;
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
  openClawModelConfig,
  openClawModels,
  openClawProviders,
  isLoadingOpenClawModelConfig,
  isSavingOpenClawModelConfig,
  refreshOpenClawModelConfig,
  saveOpenClawModelConfig,
  saveOpenClawProviderAuth,
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
  const [draftDefaultModel, setDraftDefaultModel] = useState('');
  const [draftImageModel, setDraftImageModel] = useState('');
  const [draftFallbacksText, setDraftFallbacksText] = useState('');
  const [draftImageFallbacksText, setDraftImageFallbacksText] = useState('');
  const [draftAllowedModels, setDraftAllowedModels] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerProfileId, setProviderProfileId] = useState('');
  const [wizardSessionId, setWizardSessionId] = useState('');
  const [wizardChunk, setWizardChunk] = useState('');
  const [wizardHasOutput, setWizardHasOutput] = useState(false);
  const [wizardOffset, setWizardOffset] = useState(0);
  const [wizardExited, setWizardExited] = useState(false);
  const [wizardExitCode, setWizardExitCode] = useState<number | null>(null);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardPollTick, setWizardPollTick] = useState(0);

  useEffect(() => {
    if (!openClawModelConfig) return;
    setDraftDefaultModel(openClawModelConfig.defaultModel || '');
    setDraftImageModel(openClawModelConfig.imageModel || '');
    setDraftFallbacksText((openClawModelConfig.fallbacks || []).join('\n'));
    setDraftImageFallbacksText((openClawModelConfig.imageFallbacks || []).join('\n'));
    setDraftAllowedModels(openClawModelConfig.allowed || []);
  }, [openClawModelConfig]);

  useEffect(() => {
    if (!openClawProviders.length) {
      setSelectedProvider('');
      return;
    }
    const providerValues = openClawProviders.map((item) => item.value);
    setSelectedProvider((current) => (current && providerValues.includes(current) ? current : providerValues[0]));
  }, [openClawProviders]);

  const selectedProviderOption = useMemo(
    () => openClawProviders.find((item) => item.value === selectedProvider),
    [openClawProviders, selectedProvider]
  );

  const startOpenClawWizard = async () => {
    setWizardBusy(true);
    try {
      if (wizardSessionId && !wizardExited) {
        await stopOpenClawWizard();
      }

      const res = await fetch('/api/models/config/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', bootstrap: 'local-model' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '启动 openclaw config 失败');

      setWizardSessionId(String(data?.sessionId || ''));
      setWizardChunk('');
      setWizardHasOutput(false);
      setWizardOffset(0);
      setWizardExited(false);
      setWizardExitCode(null);
      setWizardPollTick((tick) => tick + 1);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setWizardBusy(false);
    }
  };

  const stopOpenClawWizard = async () => {
    if (!wizardSessionId) return;
    try {
      await fetch('/api/models/config/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', sessionId: wizardSessionId }),
      });
    } catch {
      // ignore
    }
  };

  const sendWizardInput = async (text: string) => {
    if (!wizardSessionId || !text) return;
    const res = await fetch('/api/models/config/wizard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'input', sessionId: wizardSessionId, input: text }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || '发送输入失败');
    }
  };

  const handleTerminalInput = useCallback((data: string) => {
    sendWizardInput(data).catch((error) => {
      console.error(error);
    });
  }, [wizardSessionId]);

  useEffect(() => {
    if (configTab !== 'models') return;
    if (wizardSessionId) return;
    startOpenClawWizard().catch(console.error);
  }, [configTab]);

  useEffect(() => {
    if (!wizardSessionId || wizardExited) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/models/config/wizard?sessionId=${encodeURIComponent(wizardSessionId)}&since=${wizardOffset}&waitMs=15000`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(data?.error || '拉取向导输出失败');
        }
        if (typeof data?.chunk === 'string' && data.chunk) {
          setWizardChunk(data.chunk);
          setWizardHasOutput(true);
        } else {
          setWizardChunk('');
        }
        if (typeof data?.nextOffset === 'number') {
          setWizardOffset(data.nextOffset);
        }
        if (data?.exited) {
          setWizardExited(true);
          setWizardExitCode(typeof data?.exitCode === 'number' ? data.exitCode : null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setTimeout(() => {
            if (!cancelled) {
              setWizardPollTick((tick) => tick + 1);
            }
          }, 1000);
        }
        return;
      }

      if (!cancelled && !wizardExited) {
        setWizardPollTick((tick) => tick + 1);
      }
    };

    poll().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [wizardSessionId, wizardOffset, wizardExited, wizardPollTick]);

  useEffect(() => {
    return () => {
      if (!wizardSessionId) return;
      fetch('/api/models/config/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', sessionId: wizardSessionId }),
      }).catch(() => undefined);
    };
  }, [wizardSessionId]);

  const modelSelectOptions = useMemo(() => {
    const dedup = new Map<string, OpenClawModelItem>();
    for (const model of openClawModels) {
      dedup.set(model.key, model);
    }
    return Array.from(dedup.values());
  }, [openClawModels]);

  const toggleAllowedModel = (modelKey: string) => {
    setDraftAllowedModels((current) => {
      if (current.includes(modelKey)) {
        return current.filter((item) => item !== modelKey);
      }
      return [...current, modelKey];
    });
  };

  const normalizeLines = (text: string) => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  };

  const handleSaveModelConfig = async () => {
    if (!draftDefaultModel.trim()) {
      alert('默认模型不能为空。');
      return;
    }

    await saveOpenClawModelConfig({
      defaultModel: draftDefaultModel.trim(),
      imageModel: draftImageModel.trim() || null,
      fallbacks: normalizeLines(draftFallbacksText),
      imageFallbacks: normalizeLines(draftImageFallbacksText),
      allowed: Array.from(new Set(draftAllowedModels.map((item) => item.trim()).filter(Boolean))),
    });
  };

  const handleSaveProviderAuth = async () => {
    if (!selectedProvider.trim()) {
      alert('请选择供应商。');
      return;
    }
    if (!providerApiKey.trim()) {
      alert('请输入 API Key。');
      return;
    }

    await saveOpenClawProviderAuth({
      provider: selectedProvider.trim(),
      apiKey: providerApiKey.trim(),
      profileId: providerProfileId.trim() || `${selectedProvider.trim()}:default`,
    });
    setProviderApiKey('');
  };

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
          <button
            onClick={() => setConfigTab('models')}
            className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", configTab === 'models' ? "bg-neutral-700 text-white shadow" : "text-neutral-400 hover:text-white")}
          >
            大模型配置
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
        ) : configTab === 'files' ? (
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
        ) : (
          <div className="p-8 max-w-5xl mx-auto w-full space-y-6 overflow-y-auto">
            <div className="rounded-xl border border-cyan-600/40 bg-cyan-950/10 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-cyan-200">OpenClaw 向导命令行</div>
                  <div className="text-xs text-cyan-100/70 mt-1">
                    点击大模型配置后会自动执行 openclaw config，并尝试自动选择 Local + Model，后续由你继续操作。
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startOpenClawWizard()}
                    disabled={wizardBusy}
                    className="px-3 py-1.5 rounded-lg border border-cyan-400/40 text-xs text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-60"
                  >
                    重新启动向导
                  </button>
                  <button
                    type="button"
                    onClick={() => stopOpenClawWizard()}
                    disabled={!wizardSessionId || wizardExited}
                    className="px-3 py-1.5 rounded-lg border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-60"
                  >
                    停止
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-3">
                <OpenClawTerminal
                  chunk={wizardChunk}
                  sessionId={wizardSessionId}
                  onInput={handleTerminalInput}
                  disabled={!wizardSessionId || wizardExited}
                  className="h-72 w-full"
                />
              </div>

              {!wizardHasOutput ? (
                <div className="text-xs text-neutral-500">等待 openclaw config 输出...</div>
              ) : null}

              <div className="text-xs text-neutral-500">
                在终端区域内点击后可直接使用键盘操作（上下选择、空格勾选、回车确认、Ctrl+C 终止）。
              </div>

              <div className="text-xs text-neutral-500">
                会话状态：{wizardSessionId ? '运行中' : '未启动'}{wizardExited ? `（已退出，code=${wizardExitCode ?? 'n/a'}）` : ''}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-neutral-200 flex items-center gap-2">
                    <Database className="w-5 h-5 text-cyan-400" /> OpenClaw 模型配置
                  </h4>
                  <p className="text-sm text-neutral-500 mt-1">该页面直接映射 OpenClaw `models status` 和 `config set` 配置路径。</p>
                  <p className="text-xs text-neutral-600 mt-1 font-mono">{openClawModelConfig?.configPath || '配置路径加载中...'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => refreshOpenClawModelConfig()}
                  disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                  className="px-3 py-2 rounded-lg border border-neutral-700 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-60 inline-flex items-center gap-2"
                >
                  <RefreshCw className={cn('w-4 h-4', isLoadingOpenClawModelConfig ? 'animate-spin' : '')} />
                  刷新
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-4">
                <div className="text-sm font-semibold text-neutral-200">供应商与 API 鉴权初始化</div>
                <p className="text-xs text-neutral-500">对应 OpenClaw 配置向导中的 Model/Auth Provider + Paste API Key 过程。</p>

                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">模型供应商</label>
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60"
                    disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                  >
                    <option value="">请选择供应商</option>
                    {openClawProviders.map((provider) => (
                      <option key={provider.value} value={provider.value}>{provider.label}</option>
                    ))}
                  </select>
                  {selectedProviderOption?.hint ? (
                    <div className="text-xs text-neutral-500 mt-1">{selectedProviderOption.hint}</div>
                  ) : null}
                </div>

                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">Profile ID（可选）</label>
                  <input
                    value={providerProfileId}
                    onChange={(e) => setProviderProfileId(e.target.value)}
                    placeholder={selectedProvider ? `${selectedProvider}:default` : 'provider:default'}
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60"
                    disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                  />
                </div>

                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">API Key 粘贴</label>
                  <input
                    type="password"
                    value={providerApiKey}
                    onChange={(e) => setProviderApiKey(e.target.value)}
                    placeholder="输入后将写入 OpenClaw auth profiles"
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60"
                    disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSaveProviderAuth()}
                    disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                    className="px-3 py-2 rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-60 text-sm"
                  >
                    写入供应商 API Key
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-4">
                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">默认模型（primary）</label>
                  <select
                    value={draftDefaultModel}
                    onChange={(e) => setDraftDefaultModel(e.target.value)}
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60"
                    disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                  >
                    <option value="">请选择默认模型</option>
                    {modelSelectOptions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name ? `${item.name} (${item.key})` : item.key}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-neutral-300 mb-1.5">图像模型（image，可选）</label>
                  <select
                    value={draftImageModel}
                    onChange={(e) => setDraftImageModel(e.target.value)}
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60"
                    disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                  >
                    <option value="">不指定图像模型</option>
                    {modelSelectOptions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name ? `${item.name} (${item.key})` : item.key}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
                <label className="block text-sm text-neutral-300 mb-2">允许模型列表（agents.defaults.models）</label>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {modelSelectOptions.map((item) => {
                    const checked = draftAllowedModels.includes(item.key);
                    return (
                      <label key={item.key} className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAllowedModel(item.key)}
                          disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="text-sm text-neutral-200">{item.name || item.key}</div>
                          <div className="text-xs text-neutral-500 font-mono">{item.key}</div>
                        </div>
                      </label>
                    );
                  })}
                  {modelSelectOptions.length === 0 ? (
                    <div className="text-sm text-neutral-500">暂无可用模型列表。</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-2">
                <label className="block text-sm text-neutral-300">文本回退模型（每行一个）</label>
                <textarea
                  value={draftFallbacksText}
                  onChange={(e) => setDraftFallbacksText(e.target.value)}
                  className="w-full h-36 rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60 resize-none"
                  placeholder="例如:\nsglang/Qwen3.5-27B-FP8\nzai/glm-4.6v"
                  disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                />
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-2">
                <label className="block text-sm text-neutral-300">图像回退模型（每行一个）</label>
                <textarea
                  value={draftImageFallbacksText}
                  onChange={(e) => setDraftImageFallbacksText(e.target.value)}
                  className="w-full h-36 rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-cyan-500/60 resize-none"
                  placeholder="例如:\nprovider/image-model-a"
                  disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                />
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <div className="text-sm font-semibold text-neutral-200 mb-2">Provider 鉴权状态（只读）</div>
              {openClawModelConfig?.authProviders?.length ? (
                <div className="space-y-2">
                  {openClawModelConfig.authProviders.map((provider) => (
                    <div key={provider.provider} className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
                      <div className="text-sm text-neutral-200">{provider.provider}</div>
                      <div className="text-xs text-neutral-500">{provider.effectiveKind || 'unknown'} · {provider.effectiveDetail || 'n/a'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-neutral-500">暂无鉴权信息。</div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => handleSaveModelConfig()}
                disabled={isLoadingOpenClawModelConfig || isSavingOpenClawModelConfig}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-medium inline-flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {isSavingOpenClawModelConfig ? '正在写入 OpenClaw 配置...' : '保存模型配置'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
