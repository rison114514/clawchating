import { Bot, Hash, Users, Plus, Settings, Trash2, Star, Database } from 'lucide-react';
import { cn } from '../lib/utils';
import { Agent, Group, SessionType } from '../lib/types';
import { useState } from 'react';
import { CreateAgentModal } from './Modals/CreateAgentModal';
import { DeleteAgentModal } from './Modals/DeleteAgentModal';

interface SidebarProps {
  agents: Agent[];
  groups: Group[];
  modelOptions: Array<{ key: string; name?: string }>;
  isLoadingModelOptions: boolean;
  activeSession: SessionType;
  setActiveSession: (s: SessionType) => void;
  globalChannelId: string;
  setGlobalChannelId: (id: string) => void;
  setIsCreatingGroup: (val: boolean) => void;
  setConfigAgentId: (id: string | null) => void;
  openModelConfig: () => void;
  createAgent: (payload: {
    agentId: string;
    name?: string;
    workspace?: string;
    model?: string;
    bindings?: string[];
    setDefault?: boolean;
  }) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  setDefaultAgent: (agentId: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function Sidebar({
  agents,
  groups,
  modelOptions,
  isLoadingModelOptions,
  activeSession,
  setActiveSession,
  globalChannelId,
  setGlobalChannelId,
  setIsCreatingGroup,
  setConfigAgentId,
  openModelConfig,
  createAgent,
  deleteAgent,
  setDefaultAgent,
  logout,
}: SidebarProps) {
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [settingDefaultAgentId, setSettingDefaultAgentId] = useState<string | null>(null);

  return (
    <div className="w-64 bg-neutral-950 border-r border-neutral-800 flex flex-col flex-shrink-0 relative z-20">
      <CreateAgentModal
        isOpen={isCreatingAgent}
        onClose={() => setIsCreatingAgent(false)}
        onCreate={createAgent}
        modelOptions={modelOptions}
        isLoadingModels={isLoadingModelOptions}
      />
      <DeleteAgentModal
        isOpen={!!deletingAgent}
        agentId={deletingAgent?.id || ''}
        agentName={deletingAgent?.name || ''}
        isDeleting={isDeletingAgent}
        onClose={() => setDeletingAgent(null)}
        onConfirm={async () => {
          if (!deletingAgent) return;
          setIsDeletingAgent(true);
          try {
            await deleteAgent(deletingAgent.id);
            setDeletingAgent(null);
          } finally {
            setIsDeletingAgent(false);
          }
        }}
      />

      <div className="p-4 border-b border-neutral-800 flex items-center gap-3 shrink-0">
        <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30">
          <Bot className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="font-bold tracking-tight">ClawChat</h1>
          <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Local AI Cluster</p>
        </div>
      </div>
      
      {activeSession.type === 'agent' && (
        <div className="px-4 py-3 border-b border-neutral-800/60 bg-neutral-900/30 shrink-0">
           <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium mb-2 uppercase tracking-wider">
             <Hash className="w-3.5 h-3.5" /> 个人工作区 Channel
           </div>
           <select 
              value={globalChannelId} onChange={(e) => setGlobalChannelId(e.target.value)}
              className="w-full bg-neutral-900/50 border border-neutral-800 rounded-md text-sm px-2 py-1.5 focus:outline-none focus:border-indigo-500/50 text-neutral-300"
           >
              <option value="default-workspace">默认工作区 (Default)</option>
              <option value="codegen-channel">代码生成通道 (Codegen)</option>
              <option value="system-debug">系统调试 (Debug)</option>
           </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-6 my-2 mt-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 mb-2 px-3 uppercase tracking-wider">
            <span>团队空间 (Workspaces)</span>
            <button 
              onClick={() => setIsCreatingGroup(true)}
              className="hover:text-white transition-colors bg-neutral-800/50 hover:bg-neutral-700 w-5 h-5 flex items-center justify-center rounded"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          
          {groups.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-600 italic">暂无团队群组，点击 + 组建架构组/前端组等</div>
          ) : (
            groups.map((group) => (
              <button
                key={group.id} onClick={() => setActiveSession({ type: 'group', id: group.id })}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group outline-none",
                  (activeSession.type === 'group' && activeSession.id === group.id)
                    ? "bg-neutral-800 text-white font-medium shadow-sm border border-neutral-700/50" 
                    : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200 border border-transparent"
                )}
              >
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-orange-500" />
                  {group.name}
                </div>
                {(activeSession.type === 'group' && activeSession.id === group.id) && (
                   <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></div>
                )}
              </button>
            ))
          )}
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-neutral-500 mb-2 px-3 uppercase tracking-wider flex items-center justify-between">
            <span>独立助理 (Agents)</span>
            <span className="bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded text-[10px]">{agents.length}</span>
          </div>
          <div className="max-h-[290px] overflow-y-auto pr-1 space-y-1">
            {agents.map((agent) => (
              <div
                key={agent.id} 
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1 rounded-lg transition-all duration-200 group outline-none",
                  (activeSession.type === 'agent' && activeSession.id === agent.id)
                    ? "bg-neutral-800 text-white font-medium shadow-sm border border-neutral-700/50" 
                    : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200 border border-transparent"
                )}
              >
                <button 
                  className="flex-1 flex items-center gap-3 py-1.5 text-sm text-left truncate"
                  onClick={() => setActiveSession({ type: 'agent', id: agent.id })}
                >
                  {agent.hasAvatarImage ? (
                    <img
                      src={`/api/agents/avatar?agentId=${encodeURIComponent(agent.id)}`}
                      alt={agent.name}
                      className="w-5 h-5 rounded-full shrink-0 object-cover border border-neutral-700"
                    />
                  ) : agent.avatarEmoji ? (
                    <span className="w-5 h-5 shrink-0 text-base leading-5 text-center">{agent.avatarEmoji}</span>
                  ) : (
                    <agent.icon className={cn("w-4 h-4 shrink-0", agent.color)} />
                  )}
                  <span className="truncate">{agent.name}</span>
                  {agent.isDefault ? (
                    <span className="ml-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 text-[10px] shrink-0">
                      默认
                    </span>
                  ) : null}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (agent.isDefault || settingDefaultAgentId === agent.id) return;
                      setSettingDefaultAgentId(agent.id);
                      try {
                        await setDefaultAgent(agent.id);
                      } finally {
                        setSettingDefaultAgentId(null);
                      }
                    }}
                    className={cn(
                      'p-1 rounded transition-colors opacity-0 group-hover:opacity-100',
                      agent.isDefault
                        ? 'text-amber-400 opacity-100 cursor-default'
                        : 'text-neutral-500 hover:text-amber-300 hover:bg-neutral-700'
                    )}
                    title={agent.isDefault ? '当前默认助手' : '设为默认助手'}
                  >
                    <Star className={cn('w-3.5 h-3.5', agent.isDefault ? 'fill-current' : '')} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingAgent(agent); }}
                    className="p-1 hover:bg-neutral-700 rounded text-neutral-500 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="删除 Agent"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setConfigAgentId(agent.id); }}
                    className="p-1 hover:bg-neutral-700 rounded text-neutral-500 hover:text-indigo-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="配置工具权限"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  {(activeSession.type === 'agent' && activeSession.id === agent.id) && (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setIsCreatingAgent(true)}
            className="mt-2 w-full border border-dashed border-neutral-700 hover:border-indigo-500/60 rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-indigo-300 transition-colors flex items-center justify-center gap-2"
            title="新增 Agent"
          >
            <Plus className="w-4 h-4" />
            新增 Agent
          </button>
        </div>
      </div>

      <div className="p-3 border-t border-neutral-800 bg-neutral-950/80">
        <button
          onClick={() => logout()}
          className="w-full rounded-lg px-3 py-2 text-xs font-medium bg-neutral-800 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors mb-2"
          title="退出登录"
        >
          退出登录
        </button>
        <button
          onClick={openModelConfig}
          className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/30 hover:text-white transition-colors inline-flex items-center justify-center gap-2"
          title="OpenClaw 大模型配置"
        >
          <Database className="w-4 h-4" />
          大模型配置
        </button>
      </div>
    </div>
  );
}
