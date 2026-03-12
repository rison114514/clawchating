import { useState } from 'react';
import { X, Clock, Plus, Trash, Edit2, PlayCircle, Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Agent, CronTask, SessionType } from '../../lib/types';

interface CronTasksPanelProps {
  isOpen: boolean;
  onClose: () => void;
  crons: CronTask[];
  agents: Agent[];
  activeSession: SessionType;
  globalChannelId: string;
  currentGroupMembers?: string[];
  addCron: (cron: any) => void;
  removeCron: (id: string) => void;
  updateCron: (id: string, updates: any) => void;
}

export function CronTasksPanel({
  isOpen, onClose, crons, agents, activeSession, globalChannelId, currentGroupMembers, addCron, removeCron, updateCron
}: CronTasksPanelProps) {
  const [newCron, setNewCron] = useState({ agentId: '', intervalMin: 5, prompt: '' });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCron, setEditCron] = useState<any>({});

  const groupId = activeSession.type === 'group' ? activeSession.id : globalChannelId;
  const filteredCrons = crons.filter(c => c.groupId === groupId);

  const startEdit = (cron: CronTask) => {
    setEditingId(cron.id);
    setEditCron({ ...cron });
  };

  const handleSaveEdit = () => {
    if (editingId) {
      updateCron(editingId, { 
        agentId: editCron.agentId, 
        intervalMin: editCron.intervalMin, 
        prompt: editCron.prompt 
      });
      setEditingId(null);
    }
  };

  return (
    <div className={cn(
      "absolute inset-y-0 right-0 w-[450px] bg-neutral-900 border-l border-neutral-800 shadow-2xl flex flex-col transition-transform duration-300 z-50",
      isOpen ? "translate-x-0" : "translate-x-full"
    )}>
      <div className="h-16 px-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/80 backdrop-blur shrink-0">
        <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-400" />
          定时任务
        </h2>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Task List */}
        <div>
          <h3 className="text-sm font-semibold text-neutral-400 mb-3 uppercase tracking-wider">进行中的任务 ({filteredCrons.length})</h3>
          {filteredCrons.length === 0 ? (
            <div className="p-6 text-sm text-neutral-500 text-center border border-neutral-800 border-dashed rounded-xl bg-neutral-900/50">
              当前暂无正在运行的定时任务
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCrons.map(cron => {
                const isEditing = editingId === cron.id;
                return (
                  <div key={cron.id} className="flex flex-col bg-neutral-950 border border-neutral-800 p-4 rounded-xl gap-3 shadow-sm hover:border-neutral-700 transition-colors">
                    
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <select 
                            value={editCron.agentId} 
                            onChange={e => setEditCron({...editCron, agentId: e.target.value})}
                            className="bg-neutral-900 border border-neutral-700 rounded-lg text-sm px-2 py-1.5 focus:outline-none focus:border-orange-500/50 flex-1"
                          >
                            {(activeSession.type === 'group' ? currentGroupMembers : [activeSession.id])?.map(id => {
                              const a = agents.find(ag => ag.id === id);
                              return a ? <option key={id} value={id}>{a.name}</option> : null;
                            })}
                          </select>
                          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-lg px-2 text-sm">
                            <input 
                              type="number" min="1" 
                              value={editCron.intervalMin} 
                              onChange={e => setEditCron({...editCron, intervalMin: Number(e.target.value)})}
                              className="w-12 bg-transparent focus:outline-none text-center" 
                            />
                            <span className="text-neutral-500 pr-1">分</span>
                          </div>
                        </div>
                        <textarea 
                          value={editCron.prompt} 
                          onChange={e => setEditCron({...editCron, prompt: e.target.value})}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 resize-none h-20"
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors">取消</button>
                          <button onClick={handleSaveEdit} className="px-3 py-1.5 text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-md transition-colors flex items-center gap-1">
                            <Save className="w-3.5 h-3.5" /> 保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                              {(() => {
                                const ag = agents.find(a => a.id === cron.agentId);
                                const Icon = ag?.icon || Clock;
                                return <Icon className={cn("w-4 h-4", ag?.color || "text-indigo-400")} />;
                              })()}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-neutral-200">
                                @{agents.find(a => a.id === cron.agentId)?.name || cron.agentId}
                              </span>
                              <span className="text-xs text-orange-400/80 flex items-center gap-1">
                                <PlayCircle className="w-3 h-3" /> 每 {cron.intervalMin} 分钟
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEdit(cron)} className="p-1.5 text-neutral-500 hover:text-indigo-400 transition-colors" title="编辑">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => removeCron(cron.id)} className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors" title="删除">
                              <Trash className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="text-sm text-neutral-400 bg-neutral-900 border border-neutral-800 rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                          {cron.prompt}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add New Task */}
        <div className="pt-6 border-t border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-400 mb-4 uppercase tracking-wider">新建任务</h3>
          <div className="space-y-4">
            <div className="flex gap-2">
              <select 
                value={newCron.agentId} 
                onChange={e => setNewCron({...newCron, agentId: e.target.value})}
                className="bg-neutral-950 border border-neutral-800 rounded-xl text-sm px-3 py-2 focus:outline-none focus:border-orange-500/50 flex-1 transition-colors"
              >
                <option value="">-- 分派给 Agent --</option>
                {(activeSession.type === 'group' ? currentGroupMembers : [activeSession.id])?.map(id => {
                  const a = agents.find(ag => ag.id === id);
                  return a ? <option key={id} value={id}>{a.name}</option> : null;
                })}
              </select>
              <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-xl px-2 text-sm focus-within:border-orange-500/50 transition-colors">
                <input 
                  type="number" min="1" 
                  value={newCron.intervalMin} 
                  onChange={e => setNewCron({...newCron, intervalMin: Number(e.target.value)})}
                  className="w-12 bg-transparent focus:outline-none text-center" 
                />
                <span className="text-neutral-500 pr-2">分钟</span>
              </div>
            </div>
            
            <textarea 
              value={newCron.prompt} 
              onChange={e => setNewCron({...newCron, prompt: e.target.value})}
              placeholder="任务内容说明，如：总结刚刚的讨论、或者拉取最新数据..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500/50 resize-none h-24 transition-colors placeholder:text-neutral-600"
            />
            
            <button 
              disabled={!newCron.agentId || !newCron.prompt.trim() || newCron.intervalMin < 1}
              onClick={() => {
                const newTask = {
                  groupId,
                  agentId: newCron.agentId,
                  intervalMin: newCron.intervalMin,
                  prompt: newCron.prompt
                };
                addCron(newTask);
                setNewCron({ agentId: '', intervalMin: 5, prompt: '' });
              }}
              className="w-full py-3 rounded-xl text-sm bg-orange-500 hover:bg-orange-400 text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
            >
              <Plus className="w-4 h-4" /> 添加任务
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
