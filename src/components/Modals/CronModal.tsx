import { X, Clock, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Agent, CronTask, SessionType } from '../../lib/types';
import { useState } from 'react';

interface CronModalProps {
  crons: CronTask[];
  agents: Agent[];
  activeSession: SessionType;
  globalChannelId: string;
  addCron: (cron: Omit<CronTask, 'id' | 'lastRun' | 'active'>) => void;
  removeCron: (id: string) => void;
  closeModal: () => void;
  currentGroupMembers?: string[];
}

export function CronModal({
  crons, agents, activeSession, globalChannelId, addCron, removeCron, closeModal, currentGroupMembers
}: CronModalProps) {
  const [newCron, setNewCron] = useState({ agentId: '', intervalMin: 5, prompt: '' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-[480px] p-6 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-400" /> 群组/频道定时任务
          </h3>
          <button onClick={closeModal} className="text-neutral-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="max-h-64 overflow-y-auto space-y-2">
          {crons.filter(c => c.groupId === (activeSession.type === 'group' ? activeSession.id : globalChannelId)).length === 0 ? (
            <div className="text-sm text-neutral-500 text-center py-4">当前无正在运行的定时任务...</div>
          ) : (
            crons.filter(c => c.groupId === (activeSession.type === 'group' ? activeSession.id : globalChannelId)).map(cron => (
              <div key={cron.id} className="flex flex-col bg-neutral-950 border border-neutral-800 p-3 rounded-lg gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-indigo-400 font-medium">@{agents.find(a => a.id === cron.agentId)?.name || cron.agentId}</span>
                    <span className="text-neutral-400 text-xs bg-neutral-800 px-1.5 py-0.5 rounded">每 {cron.intervalMin} 分钟</span>
                  </div>
                  <button 
                    onClick={() => removeCron(cron.id)}
                    className="text-red-400/70 hover:text-red-400 text-xs"
                  >
                    删除
                  </button>
                </div>
                <div className="text-xs text-neutral-300 truncate" title={cron.prompt}>指令: {cron.prompt}</div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-neutral-800 pt-4 space-y-3 mt-2">
          <div className="flex gap-2">
            <select 
              value={newCron.agentId} 
              onChange={e => setNewCron({...newCron, agentId: e.target.value})}
              className="bg-neutral-950 border border-neutral-800 rounded-lg text-sm px-2 py-1.5 focus:outline-none focus:border-orange-500/50 flex-1"
            >
              <option value="">-- 选择目标 Agent --</option>
              {(activeSession.type === 'group' ? currentGroupMembers : [activeSession.id])?.map(id => {
                const a = agents.find(ag => ag.id === id);
                return a ? <option key={id} value={id}>{a.name}</option> : null;
              })}
            </select>
            <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-lg px-2 text-sm">
              <input 
                type="number" min="1" 
                value={newCron.intervalMin} 
                onChange={e => setNewCron({...newCron, intervalMin: Number(e.target.value)})}
                className="w-12 bg-transparent focus:outline-none text-center" 
              />
              <span className="text-neutral-500 pr-1">分钟</span>
            </div>
          </div>
          <textarea 
            value={newCron.prompt} 
            onChange={e => setNewCron({...newCron, prompt: e.target.value})}
            placeholder="例如: 请总结刚刚大家讨论的内容，或者检查最新收到的工单。"
            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 resize-none h-16"
          />
          <button 
            disabled={!newCron.agentId || !newCron.prompt.trim() || newCron.intervalMin < 1}
            onClick={() => {
              const newTask = {
                groupId: activeSession.type === 'group' ? activeSession.id : globalChannelId,
                agentId: newCron.agentId,
                intervalMin: newCron.intervalMin,
                prompt: newCron.prompt
              };
              addCron(newTask);
              setNewCron({ agentId: '', intervalMin: 5, prompt: '' });
            }}
            className="w-full py-2 rounded-lg text-sm bg-orange-600/20 text-orange-500 border border-orange-500/30 hover:bg-orange-600/30 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> 新增定时任务
          </button>
        </div>
      </div>
    </div>
  );
}
