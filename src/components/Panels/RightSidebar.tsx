import { FolderClosed, Clock, Users, ChevronRight, Plus, Crown, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Agent, Group } from '../../lib/types';
import { useState } from 'react';

interface RightSidebarProps {
  currentGroup: Group;
  agents: Agent[];
  onOpenWorkspace: () => void;
  onOpenCrons: () => void;
  workspaceFileCount: number;
  cronTaskCount: number;
  onAddAgent: (agentId: string) => void;
  onSetLeader: (agentId: string) => void;
  onDeleteGroup: () => void;
}

export function RightSidebar({
  currentGroup,
  agents,
  onOpenWorkspace,
  onOpenCrons,
  workspaceFileCount,
  cronTaskCount,
  onAddAgent,
  onSetLeader,
  onDeleteGroup
}: RightSidebarProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const availableAgents = agents.filter(a => !currentGroup.members.includes(a.id));

  return (
    <div className="w-64 bg-neutral-900 border-l border-neutral-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-neutral-800 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" /> 群组成员 ({currentGroup.members.length})
          </h3>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {currentGroup.members.map(memberId => {
            const ag = agents.find(a => a.id === memberId);
            if (!ag) return null;
            const Icon = ag.icon;
            const isLeader = currentGroup.leaderId ? currentGroup.leaderId === memberId : currentGroup.members[0] === memberId;
            return (
              <div key={memberId} className="flex items-center gap-3 p-2 rounded-lg bg-neutral-800/50 border border-neutral-700/50 group relative">
                <div className={cn("p-1.5 rounded-md bg-neutral-900 shadow-sm flex-shrink-0", ag.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 pr-6">
                  <span className="text-sm text-neutral-200 truncate font-medium flex items-center gap-1">
                    {ag.name}
                    {isLeader && <Crown className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />}
                  </span>
                </div>
                {!isLeader && (
                  <button
                    onClick={() => onSetLeader(memberId)}
                    title="设为负责人"
                    className="absolute right-2 p-1.5 rounded-md text-neutral-500 hover:text-yellow-500 hover:bg-neutral-800 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Crown className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="relative mt-2">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-lg border border-dashed border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            添加 Agent
          </button>
          {showAddMenu && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-20 py-1 max-h-48 overflow-y-auto">
              {availableAgents.length > 0 ? (
                availableAgents.map(ag => {
                  const Icon = ag.icon;
                  return (
                    <button
                      key={ag.id}
                      onClick={() => {
                        onAddAgent(ag.id);
                        setShowAddMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-neutral-700/50 transition-colors text-left"
                    >
                      <div className={cn("p-1 rounded-md bg-neutral-900", ag.color)}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-sm text-neutral-200 truncate">{ag.name}</span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-3 text-sm text-neutral-500 text-center">
                  没有可添加的 Agent
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">空间与任务</h3>
        
        <button 
          onClick={onOpenWorkspace}
          className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-indigo-900/20 to-indigo-800/10 border border-indigo-500/20 hover:border-indigo-500/40 hover:from-indigo-900/40 transition-all group shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
              <FolderClosed className="w-4 h-4" />
            </div>
            <div className="flex flex-col items-start text-left">
              <span className="text-sm font-medium text-neutral-200 group-hover:text-indigo-300 transition-colors">工作区空间</span>
              <span className="text-xs text-neutral-500 mt-0.5">{workspaceFileCount} 个文件</span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-indigo-400 transition-colors" />
        </button>

        <button 
          onClick={onOpenCrons}
          className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-orange-900/20 to-orange-800/10 border border-orange-500/20 hover:border-orange-500/40 hover:from-orange-900/40 transition-all group shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/20 text-orange-400">
              <Clock className="w-4 h-4" />
            </div>
            <div className="flex flex-col items-start text-left">
              <span className="text-sm font-medium text-neutral-200 group-hover:text-orange-300 transition-colors">定时任务</span>
              <span className="text-xs text-neutral-500 mt-0.5">{cronTaskCount} 个活跃任务</span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-orange-400 transition-colors" />
        </button>
      </div>
      
      <div className="mt-auto p-4 border-t border-neutral-800">
        <button
          onClick={onDeleteGroup}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20 transition-all font-medium shadow-sm"
        >
          <Trash2 className="w-4 h-4" />
          删除当前群组
        </button>
      </div>
    </div>
  );
}
