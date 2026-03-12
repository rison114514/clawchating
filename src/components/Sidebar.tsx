import { Bot, Hash, Users, Plus, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { Agent, Group, SessionType } from '../lib/types';

interface SidebarProps {
  agents: Agent[];
  groups: Group[];
  activeSession: SessionType;
  setActiveSession: (s: SessionType) => void;
  globalChannelId: string;
  setGlobalChannelId: (id: string) => void;
  setIsCreatingGroup: (val: boolean) => void;
  setConfigAgentId: (id: string | null) => void;
}

export function Sidebar({
  agents,
  groups,
  activeSession,
  setActiveSession,
  globalChannelId,
  setGlobalChannelId,
  setIsCreatingGroup,
  setConfigAgentId
}: SidebarProps) {
  return (
    <div className="w-64 bg-neutral-950 border-r border-neutral-800 flex flex-col flex-shrink-0 relative z-20">
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
                <agent.icon className={cn("w-4 h-4 shrink-0", agent.color)} />
                <span className="truncate">{agent.name}</span>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={(e) => { e.stopPropagation(); setConfigAgentId(agent.id); }}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-500 hover:text-indigo-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="配置能力"
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
      </div>
    </div>
  );
}
