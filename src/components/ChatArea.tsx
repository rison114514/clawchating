import { User, Send, Terminal, AtSign, FolderClosed, Plus, Clock, FileText, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Agent, Group, SessionType, CronTask, WorkspaceEntry } from '../lib/types';
import ReactMarkdown from 'react-markdown';
import React from 'react';
import { RightSidebar } from './Panels/RightSidebar';

interface ChatAreaProps {
  activeSession: SessionType;
  agents: Agent[];
  currentGroup: Group | null | undefined;
  activeAgentInfo: any;
  activeChannelId: string;
  setConfigAgentId: (id: string) => void;
  fetchGroups: () => void;
  isWorkspaceOpen: boolean;
  setIsWorkspaceOpen: (v: boolean) => void;
  setIsCronModalOpen: (v: boolean) => void;
  crons: CronTask[];
  messages: any[];
  isLoading: boolean;
  mentionedAgentId?: string;
  renderUserTextWithMentions: (content: string) => React.ReactNode;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  workspaceFiles: WorkspaceEntry[];
  openFile: (filename: string) => void;
  viewingFile: { name: string; content: string } | null;
  setViewingFile: (val: any) => void;
  mentionMenu: { show: boolean; query: string; index: number };
  insertMention: (name: string) => void;
  proxyHandleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  handleInputTextChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onAddAgent: (agentId: string) => void;
  onSetLeader: (agentId: string) => void;
  onRemoveAgent: (agentId: string) => void;
  onDeleteGroup: () => void;
}

export function ChatArea({
  activeSession, agents, currentGroup, activeAgentInfo, activeChannelId, setConfigAgentId, fetchGroups, isWorkspaceOpen, setIsWorkspaceOpen, setIsCronModalOpen, crons, messages, isLoading, mentionedAgentId, renderUserTextWithMentions, messagesEndRef, workspaceFiles, openFile, viewingFile, setViewingFile, mentionMenu, insertMention, proxyHandleSubmit, textareaRef, input, handleInputTextChange, onAddAgent, onSetLeader, onRemoveAgent, onDeleteGroup
}: ChatAreaProps) {
  const ActiveIcon = activeAgentInfo.icon;
  const isLocalUserMessage = (message: any) => {
    if (message.role !== 'user') return false;
    if (activeSession.type !== 'group') return true;
    const sender = (message?.name || '').trim();
    if (!sender) return true;
    return sender === 'Clawchating User' || sender === 'You';
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-neutral-900 relative z-10">
      {/* Header */}
      <header className="h-16 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur flex items-center justify-between px-6 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => activeSession.type === 'agent' && setConfigAgentId(activeSession.id)}
            className={cn("p-1.5 -ml-1.5 rounded-lg transition-colors", activeSession.type === 'agent' ? "hover:bg-neutral-800 cursor-pointer" : "cursor-default")}
            title={activeSession.type === 'agent' ? "配置能力" : undefined}
          >
            <ActiveIcon className={activeSession.type === 'group' ? "w-5 h-5 text-orange-500" : cn("w-5 h-5", activeAgentInfo.color)} />
          </button>
          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold text-neutral-100">{activeAgentInfo.name}</h2>
              <span className="text-emerald-500/80 text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                CH: {activeChannelId}
              </span>
            </div>
            {activeSession.type === 'group' && (
              <span className="text-neutral-500 text-[10px] uppercase tracking-wider mt-0.5">
                Shared Workspace Mode active
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           {activeSession.type === 'group' && currentGroup && (
             <div className="flex items-center gap-2 mr-2 min-w-0">
               <div className="text-[11px] text-neutral-500 shrink-0">{currentGroup.members.length} 成员</div>
               <div className="flex items-center gap-1 overflow-x-auto max-w-[260px] pr-1">
                  {currentGroup.members.map(memberId => {
                    const ag = agents.find(a => a.id === memberId);
                    return (
                      <button 
                        key={memberId} 
                        title={ag ? `配置 ${ag.name} 能力` : `未知成员 ${memberId}`} 
                        onClick={() => setConfigAgentId(memberId)}
                        className="inline-flex rounded-full bg-neutral-800 border border-neutral-700 p-1.5 hover:border-indigo-500 transition-colors shrink-0"
                      >
                        {ag ? (
                          <ag.icon className={cn("w-3 h-3", ag.color)} />
                        ) : (
                          <User className="w-3 h-3 text-neutral-400" />
                        )}
                      </button>
                    );
                  })}
               </div>
             </div>
           )}
        </div>
      </header>

      {/* Messaging Area + Right Sidebar wrapper */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Main Chat Flow */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 gap-4">
              <div className="p-6 rounded-3xl bg-neutral-800/30 border border-neutral-800 border-dashed animate-pulse relative">
                {activeSession.type === 'group' && <AtSign className="absolute -top-3 -right-3 w-8 h-8 text-indigo-500 bg-neutral-900 rounded-full p-1 border border-neutral-800" />}
                <ActiveIcon className={activeSession.type === 'group' ? "w-16 h-16 opacity-50 text-orange-500" : cn("w-16 h-16 opacity-50", activeAgentInfo.color)} />
              </div>
              <p className="text-lg text-neutral-400 text-center">
                {activeSession.type === 'group' 
                  ? `工作台群组「${activeAgentInfo.name}」已就绪。\n群组共享独立文件夹、并维护专属记忆 Memory.md。\n输入 @ 或直接指派指令让 Bot 开始工作。` 
                  : `你好，我是 ${activeAgentInfo.name}，正在监听 ${activeChannelId} 频道。`}
              </p>
            </div>
          ) : (
            <>
              {messages.map(m => (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-2 max-w-4xl mx-auto w-full",
                    m.role === 'user' && isLocalUserMessage(m) ? 'items-end' : 'items-start'
                  )}
                >
                  <div className="flex items-center gap-2 px-1">
                    {m.role === 'user' && isLocalUserMessage(m) ? (
                      <>
                        <span className="text-xs font-medium text-neutral-500">You</span>
                        <div className="w-5 h-5 rounded flex items-center justify-center bg-indigo-600/20">
                          <User className="w-3.5 h-3.5 text-indigo-400" />
                        </div>
                      </>
                    ) : m.role === 'user' ? (
                      <>
                        <div className="w-5 h-5 rounded flex items-center justify-center bg-neutral-800 border border-neutral-700">
                          {(() => {
                            const senderName = String(m.name || '').trim();
                            const senderAgent = agents.find(a => a.id === senderName || a.name === senderName);
                            if (!senderAgent) {
                              return <User className="w-3.5 h-3.5 text-neutral-400" />;
                            }
                            return <senderAgent.icon className={cn("w-3.5 h-3.5", senderAgent.color)} />;
                          })()}
                        </div>
                        <span className="text-xs font-medium text-neutral-400">{m.name || '群成员'}</span>
                      </>
                    ) : (
                      <>
                        <div className="w-5 h-5 rounded flex items-center justify-center bg-neutral-800 border border-neutral-700">
                           <ActiveIcon className={activeSession.type === 'group' ? "w-3.5 h-3.5 text-orange-500" : cn("w-3.5 h-3.5", activeAgentInfo.color)} />
                        </div>
                        <span className="text-xs font-medium text-neutral-400">
                           {activeSession.type === 'group' ? (m.name ? `${agents.find(a=>a.id===m.name)?.name || m.name}` : (isLoading && m === messages[messages.length - 1] ? activeAgentInfo.name : `${currentGroup?.name} (组内响应)`)) : activeAgentInfo.name}
                        </span>
                      </>
                    )}
                  </div>

                  <div className={cn(
                    "px-4 py-3 text-[15px] leading-relaxed max-w-full overflow-hidden",
                    m.role === 'user' && isLocalUserMessage(m)
                      ? "bg-indigo-600 text-white rounded-2xl rounded-tr-sm" 
                      : "bg-[#252525] text-neutral-200 rounded-2xl rounded-tl-sm border border-neutral-800 shadow-sm"
                  )}>
                    {m.role === 'user' ? (
                      <div>{renderUserTextWithMentions(m.content)}</div>
                    ) : (
                      <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-[#1a1a1a] prose-pre:border prose-pre:border-neutral-800 max-w-none">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                        {m.toolInvocations?.map((tool: any) => (
                           <div key={tool.toolCallId} className="mt-3 p-3 bg-neutral-900 border border-emerald-500/30 rounded-xl text-xs font-mono">
                             <div className="flex items-center gap-2 text-emerald-400 mb-1">
                               <Terminal className="w-3 h-3" /> 使用终端工具: {tool.toolName}
                             </div>
                             <div className="text-neutral-500">{JSON.stringify(tool.args)}</div>
                           </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {isLoading && messages[messages.length - 1]?.role === 'user' && (
                <div className="flex flex-col gap-2 items-start max-w-4xl mx-auto w-full">
                   <div className="flex items-center gap-2 px-1">
                      <div className="w-5 h-5 rounded flex items-center justify-center bg-neutral-800 border border-neutral-700">
                        <ActiveIcon className={activeSession.type === 'group' ? "w-3.5 h-3.5 text-orange-500" : cn("w-3.5 h-3.5", activeAgentInfo.color)} />
                      </div>
                      <span className="text-xs font-medium text-neutral-500">
                         {mentionedAgentId ? `Routing to @${agents.find(a=>a.id===mentionedAgentId)?.name}...` : `Processing in ${activeChannelId}...`}
                      </span>
                   </div>
                   <div className="px-5 py-4 text-sm rounded-2xl rounded-tl-sm bg-[#252525] border border-neutral-800 flex items-center gap-1.5 w-max">
                     <div className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                     <div className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                     <div className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-bounce"></div>
                   </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </main>

        {activeSession.type === 'group' && currentGroup && (
          <RightSidebar
            currentGroup={currentGroup}
            agents={agents}
            onOpenWorkspace={() => setIsWorkspaceOpen(true)}
            onOpenCrons={() => setIsCronModalOpen(true)}
            workspaceFileCount={workspaceFiles.filter((entry) => !entry.isDirectory).length}
            cronTaskCount={crons.filter(c => c.groupId === activeSession.id).length}
            onAddAgent={onAddAgent}
            onSetLeader={onSetLeader}
            onRemoveAgent={onRemoveAgent}
            onDeleteGroup={onDeleteGroup}
          />
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 sm:p-6 bg-neutral-900 border-t border-neutral-800 shrink-0">
        <div className="max-w-4xl mx-auto relative">
          
          {/* Mention Dropdown Menu */}
          {mentionMenu.show && activeSession.type === 'group' && (
            <div className="absolute bottom-[calc(100%+12px)] left-0 w-64 bg-[#1a1a1a] border border-neutral-700/50 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
               <div className="px-3 py-2 text-xs font-semibold text-neutral-400 bg-neutral-900/80 border-b border-neutral-800/80">
                 向组内成员发送指向性指令
               </div>
               <div className="max-h-48 overflow-y-auto p-1.5 space-y-0.5">
                 {currentGroup?.members
                   .map(m => agents.find(a => a.id === m))
                   .filter(ag => ag && (ag.name.toLowerCase().includes(mentionMenu.query.toLowerCase()) || ag.id.toLowerCase().includes(mentionMenu.query.toLowerCase())))
                   .map(ag => {
                     const Icon = ag!.icon;
                     return (
                       <button
                         key={ag!.id}
                         type="button"
                         onClick={() => insertMention(ag!.name)}
                         className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-lg hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors text-neutral-300 group outline-none"
                       >
                         <Icon className="w-4 h-4 text-indigo-400/70 group-hover:text-indigo-400" />
                         <span className="flex-1 truncate">{ag!.name}</span>
                       </button>
                     );
                   })}
                 {currentGroup?.members.filter(m => {
                    const ag = agents.find(a => a.id === m);
                    return ag && (ag.name.toLowerCase().includes(mentionMenu.query.toLowerCase()) || ag.id.toLowerCase().includes(mentionMenu.query.toLowerCase()));
                 }).length === 0 && (
                    <div className="px-3 py-4 text-xs text-neutral-500 text-center italic">无匹配对应成员...</div>
                 )}
               </div>
            </div>
          )}

          <form
            onSubmit={proxyHandleSubmit}
            className="relative flex items-end gap-2 bg-[#1a1a1a] rounded-2xl p-2.5 border border-neutral-700/50 shadow-sm focus-within:border-indigo-500/50 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all"
          >
            <textarea
              ref={textareaRef}
              className="w-full bg-transparent text-neutral-100 py-3 px-4 resize-none focus:outline-none min-h-[52px] max-h-48 overflow-y-auto placeholder:text-neutral-500 leading-relaxed"
              placeholder={
                activeSession.type === 'group' 
                ? `向群组内的 ${currentGroup?.members.length} 位成员发布任务 (可生成文件/代码)... 使用 @ 定向呼叫`
                : `向 ${activeAgentInfo.name} 发送指令...`
              }
              value={input}
              onChange={handleInputTextChange}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !isLoading) {
                    proxyHandleSubmit(e as any);
                  }
                }
              }}
              rows={1}
              style={{ height: 'auto' }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shrink-0 mb-0.5 shadow-sm"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <div className="flex justify-between items-center mt-3 px-1 text-xs text-neutral-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 hover:text-neutral-300 transition-colors cursor-pointer" title="Available tools: read_file, write_file, list_files, execute_command">
                <Terminal className="w-3 h-3" /> Tools Enabled: fs (Read/Write) & exec
              </span>
              <span className="flex items-center gap-1 text-emerald-500/80">
                <FolderClosed className="w-3 h-3" /> 工作区隔离域就绪
              </span>
            </div>
            <div className="hidden sm:inline-block">Built with Next.js AI SDK</div>
          </div>
        </div>
      </div>
    </div>
  );
}
