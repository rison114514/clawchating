import { X, Users, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Agent } from '../../lib/types';
import { useState } from 'react';

interface CreateGroupModalProps {
  agents: Agent[];
  closeModal: () => void;
  handleCreateGroup: (name: string, members: string[], channelId: string) => void;
}

export function CreateGroupModal({
  agents,
  closeModal,
  handleCreateGroup
}: CreateGroupModalProps) {
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [newGroupChannel, setNewGroupChannel] = useState('group-project-alpha');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-[420px] p-6 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-orange-500" /> 创建群组 & 协作空间
          </h3>
          <button onClick={closeModal} className="text-neutral-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-xs text-neutral-400 font-medium mb-1.5 block">群聊名称</label>
            <input 
              type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="例如: 前后端协同小组"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-400 font-medium mb-1.5 flex items-center justify-between">
              <span>绑定独立 Channel 隔离域</span>
            </label>
            <input 
              type="text" value={newGroupChannel} onChange={(e) => setNewGroupChannel(e.target.value)}
              placeholder="如: team-backend-channel"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 text-emerald-400"
            />
            <p className="text-[10px] text-neutral-500 mt-1">每个群组将根据此 Channel 分配专属持久化记忆空间，互不干扰。</p>
          </div>

          <div>
            <label className="text-xs text-neutral-400 font-medium mb-1.5 block">拉取 Agents ({newGroupMembers.length} 已选)</label>
            <div className="h-40 overflow-y-auto space-y-1.5 bg-neutral-950 p-2 rounded-lg border border-neutral-800">
              {agents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => {
                    if (newGroupMembers.includes(agent.id)) setNewGroupMembers(newGroupMembers.filter(id => id !== agent.id));
                    else setNewGroupMembers([...newGroupMembers, agent.id]);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded-md transition-colors border outline-none text-left",
                    newGroupMembers.includes(agent.id) ? "bg-indigo-500/10 border-indigo-500/50" : "hover:bg-neutral-800 border-transparent"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <agent.icon className={cn("w-4 h-4", agent.color)} />
                    <span className="text-sm">{agent.name}</span>
                  </div>
                  {newGroupMembers.includes(agent.id) && <Check className="w-4 h-4 text-indigo-400" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={closeModal} className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:bg-neutral-800 transition-colors">取消</button>
          <button 
            onClick={() => handleCreateGroup(newGroupName, newGroupMembers, newGroupChannel)} 
            disabled={!newGroupName.trim() || newGroupMembers.length === 0 || !newGroupChannel.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            生成工作区并创建
          </button>
        </div>
      </div>
    </div>
  );
}
