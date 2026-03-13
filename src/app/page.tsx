'use client';

import { useChat } from '@ai-sdk/react';
import { useState, useRef, useEffect } from 'react';
import { Bot, Zap, Cpu, Code, PenTool, Image as ImageIcon, Terminal, Settings, Users } from 'lucide-react';
import { Agent, Group, SessionType, CronTask } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { SettingsView } from '../components/SettingsView';
import { CronTasksPanel } from '../components/Panels/CronTasksPanel';
import { WorkspaceFilesPanel } from '../components/Panels/WorkspaceFilesPanel';
import { CreateGroupModal } from '../components/Modals/CreateGroupModal';
import { ChatArea } from '../components/ChatArea';

const INITIAL_AGENTS: Agent[] = [
  { id: 'main', name: '爪爪 - 本地启动中...', icon: Bot, color: 'text-indigo-500', capabilities: { read: true, write: true, exec: false, invite: false } }
];

export default function Chat() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [activeSession, setActiveSession] = useState<SessionType>({ type: 'agent', id: 'main' });
  const [groups, setGroups] = useState<Group[]>([]);
  
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<'capabilities' | 'files'>('capabilities');
  const [activeConfigFileName, setActiveConfigFileName] = useState<string | null>(null);
  const [basicConfigContent, setBasicConfigContent] = useState<string>('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [crons, setCrons] = useState<CronTask[]>([]);
  const [isCronModalOpen, setIsCronModalOpen] = useState(false);
  
  const [mentionMenu, setMentionMenu] = useState({ show: false, query: '', index: -1 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [globalChannelId, setGlobalChannelId] = useState('default-workspace');
  
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [viewingFile, setViewingFile] = useState<{name: string, content: string}|null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTargetAgentRef = useRef<string>('');
  
  const currentGroup = activeSession.type === 'group' ? groups.find(g => g.id === activeSession.id) : null;
  const activeChannelId = activeSession.type === 'group' ? (currentGroup?.channelId || 'default') : globalChannelId;
  const workspaceFolderId = activeSession.type === 'group' ? currentGroup!.id : activeChannelId;

  const fetchWorkspaceFiles = async () => {
    try {
      const res = await fetch(`/api/workspace/files?scopedId=${workspaceFolderId}`);
      const data = await res.json();
      if (data.files) setWorkspaceFiles(data.files);
    } catch (e) {
      console.error(e);
    }
  };

  const openFile = async (filename: string) => {
    try {
      const res = await fetch(`/api/workspace/files?scopedId=${workspaceFolderId}&filename=${filename}`);
      const data = await res.json();
      setViewingFile({ name: filename, content: data.content });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isWorkspaceOpen) {
      fetchWorkspaceFiles();
      const interval = setInterval(fetchWorkspaceFiles, 3000);
      return () => clearInterval(interval);
    }
  }, [isWorkspaceOpen, workspaceFolderId]);

  useEffect(() => {
    setViewingFile(null);
  }, [activeSession.id]);

  let mentionedAgentId = undefined;

  const { messages, setMessages, input, setInput, handleInputChange, handleSubmit, isLoading, append } = useChat({
    id: activeSession.type === 'group' ? activeSession.id : activeChannelId,
    api: '/api/chat',
    body: {
      channelId: activeChannelId,
      sessionType: activeSession.type,
      groupId: activeSession.type === 'group' ? activeSession.id : undefined,
      groupMembers: activeSession.type === 'group' ? currentGroup?.members : undefined,
    },
    onFinish: (message) => {
      setMessages(current => current.map(m => m.id === message.id ? { ...m, name: lastTargetAgentRef.current } : m));
    }
  });

  const sessionIdentifier = activeSession.type === 'group' ? activeSession.id : activeChannelId;

  useEffect(() => {
    fetch(`/api/messages?sessionType=${activeSession.type}&id=${sessionIdentifier}`)
      .then(res => res.json())
      .then(data => {
        setMessages(Array.isArray(data) ? data : []);
      })
      .catch(console.error);
  }, [sessionIdentifier, activeSession.type, setMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timeoutMsg = setTimeout(() => {
      fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionType: activeSession.type, id: sessionIdentifier })
      }).catch(console.error);
    }, 1000);
    return () => clearTimeout(timeoutMsg);
  }, [messages, sessionIdentifier, activeSession.type]);

  if (activeSession.type === 'group' && currentGroup) {
    for (const memberId of currentGroup.members) {
      const ag = agents.find(a => a.id === memberId);
      if (ag && input.includes(`@${ag.name}`)) {
        mentionedAgentId = ag.id;
        break; 
      }
    }
  }

  const targetAgentId = mentionedAgentId 
    ? mentionedAgentId 
    : (activeSession.type === 'agent' ? activeSession.id : (currentGroup?.leaderId || currentGroup?.members[0] || 'main'));

  const proxyHandleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    lastTargetAgentRef.current = targetAgentId;
    const targetAgent = agents.find(a => a.id === targetAgentId);
    handleSubmit(e, {
      body: {
        agentId: targetAgentId,
        isMention: !!mentionedAgentId,
        capabilities: targetAgent?.capabilities || { read: true, write: true, exec: false, invite: false }
      }
    });
  };

  useEffect(() => {
    fetch('/api/agents')
      .then(res => res.json())
      .then(data => {
        if (data?.agents?.length > 0) {
          const ICON_MAP = { Bot, Cpu, Code, Terminal, Zap, Settings, PenTool, ImageIcon };
          const loadedAgents = data.agents.map((a: any) => ({
            id: a.id,
            name: a.name,
            icon: ICON_MAP[a.iconName as keyof typeof ICON_MAP] || Bot,
            color: a.color || 'text-indigo-500',
            capabilities: { read: true, write: true, exec: false, invite: false }
          }));
          setAgents(loadedAgents);
          if (activeSession.type === 'agent' && !loadedAgents.find((a: any) => a.id === activeSession.id)) {
            setActiveSession({ type: 'agent', id: loadedAgents[0].id });
          }
        }
      })
      .catch(console.error);
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/groups');
      setGroups(await res.json());
    } catch (e) {
      console.error('Failed to fetch groups', e);
    }
  };

  useEffect(() => { fetchGroups(); }, []);

  const fetchCrons = async () => {
    try {
      const res = await fetch('/api/crons');
      setCrons(await res.json());
    } catch (e) {
      console.error('Failed to fetch crons', e);
    }
  };

  useEffect(() => { fetchCrons(); }, []);

  const addCron = async (cronData: any) => {
    try {
      const res = await fetch('/api/crons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cronData)
      });
      if (res.ok) fetchCrons();
    } catch (e) {
      console.error(e);
    }
  };

  const updateCron = async (id: string, updates: any) => {
    try {
      const res = await fetch('/api/crons', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates })
      });
      if (res.ok) fetchCrons();
    } catch (e) {
      console.error(e);
    }
  };

  const removeCron = async (id: string) => {
    try {
      await fetch(`/api/crons?id=${id}`, { method: 'DELETE' });
      fetchCrons();
    } catch (e) {
      console.error(e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => { scrollToBottom(); }, [messages]);

  const loadAgentConfigFile = async (agentId: string, filename: string) => {
    setActiveConfigFileName(filename);
    setBasicConfigContent('Loading...');
    try {
      const res = await fetch(`/api/agents/config?agentId=${agentId}&filename=${filename}`);
      const data = await res.json();
      if (data.error) setBasicConfigContent(`Error: ${data.error}`);
      else setBasicConfigContent(data.content || '');
    } catch (e) {
      setBasicConfigContent('Failed to load file.');
    }
  };

  const saveAgentConfigFile = async (agentId: string) => {
    if (!activeConfigFileName) return;
    setIsSavingConfig(true);
    try {
      await fetch('/api/agents/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, filename: activeConfigFileName, content: basicConfigContent })
      });
      setIsSavingConfig(false);
    } catch (e) {
      setIsSavingConfig(false);
    }
  };

  const handleCreateGroup = async (name: string, members: string[], channelId: string) => {
    const newGroupInfo = { name, members, channelId };
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGroupInfo)
      });
      if (res.ok) {
        const { group } = await res.json();
        setGroups([...groups, group]);
        setIsCreatingGroup(false);
        setActiveSession({ type: 'group', id: group.id });
      }
    } catch (e) {
      console.error('Failed to create group', e);
    }
  };

  const handleAddAgent = async (newAgentId: string) => {
    if (!currentGroup) return;
    if (newAgentId && !currentGroup.members.includes(newAgentId)) {
      const updatedGroup = { ...currentGroup, members: [...currentGroup.members, newAgentId] };
      try {
        await fetch('/api/groups', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedGroup)
        });
        fetchGroups();
      } catch (e) {
        console.error('Failed to add agent to group', e);
      }
    } else if (newAgentId) {
      alert("Agent 已在群组内或输入无效");
    }
  };

  const handleSetLeader = async (agentId: string) => {
    if (!currentGroup) return;
    const updatedGroup = { ...currentGroup, leaderId: agentId };
    try {
      await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedGroup)
      });
      fetchGroups();
    } catch (e) {
      console.error('Failed to set group leader', e);
    }
  };

  const handleDeleteGroup = async () => {
    if (!currentGroup) return;
    if (!confirm('确定要删除这个群组吗？聊天记录和相关文件将被保留，但群组本身将被解散。')) return;
    try {
      await fetch(`/api/groups?id=${currentGroup.id}`, { method: 'DELETE' });
      fetchGroups();
      setActiveSession({ type: 'agent', id: 'main' });
    } catch (e) {
      console.error('Failed to delete group', e);
    }
  };

  const handleInputTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(e); 
    if (activeSession.type === 'group') {
      const val = e.target.value;
      const cursor = e.target.selectionStart;
      const textBeforeCursor = val.slice(0, cursor);
      const match = textBeforeCursor.match(/@([^\s@]*)$/);
      if (match) {
        setMentionMenu({ show: true, query: match[1], index: match.index ?? -1 });
      } else {
        setMentionMenu({ show: false, query: '', index: -1 });
      }
    } else {
       setMentionMenu({ show: false, query: '', index: -1 });
    }
  };

  const insertMention = (agentName: string) => {
    if (mentionMenu.index !== -1) {
      const textBefore = input.slice(0, mentionMenu.index);
      const textAfter = input.slice(textareaRef.current?.selectionStart || input.length);
      const newText = `${textBefore}@${agentName} ${textAfter}`;
      
      setInput(newText); 
      setMentionMenu({ show: false, query: '', index: -1 });
      setTimeout(() => textareaRef.current?.focus(), 0); 
    }
  };

  const renderUserTextWithMentions = (content: string) => {
    if (activeSession.type !== 'group' || !currentGroup) return <span className="whitespace-pre-wrap">{content}</span>;
    let result: React.ReactNode[] = [content];
    
    currentGroup.members.forEach(memberId => {
      const ag = agents.find(a => a.id === memberId);
      if (ag) {
        const mentionStr = `@${ag.name}`;
        const newResult: React.ReactNode[] = [];
        result.forEach((part, index) => {
          if (typeof part === 'string') {
             const splits = part.split(mentionStr);
             splits.forEach((s, i) => {
                newResult.push(s);
                if (i < splits.length - 1) {
                   newResult.push(
                      <span key={`${memberId}-${index}-${i}`} className="text-indigo-300 font-semibold bg-indigo-500/20 px-1.5 py-0.5 rounded-md mx-px shadow-sm">
                        {mentionStr}
                      </span>
                   );
                }
             });
          } else {
             newResult.push(part);
          }
        });
        result = newResult;
      }
    });
    return <span className="whitespace-pre-wrap leading-relaxed">{result}</span>;
  };

  const activeAgentInfo = activeSession.type === 'agent' 
    ? (agents.find(a => a.id === activeSession.id) || agents[0])
    : { name: currentGroup?.name || '未知群聊', id: currentGroup?.id, icon: Users, color: 'text-orange-500' };

  const toggleAgentCapability = (agentId: string, cap: 'read' | 'write' | 'exec' | 'invite') => {
    setAgents(agents.map(a => {
      if (a.id === agentId && a.capabilities) {
        return { ...a, capabilities: { ...a.capabilities, [cap]: !a.capabilities[cap] } };
      }
      return a;
    }));
  };

  return (
    <div className="flex h-screen bg-neutral-900 text-neutral-100 overflow-hidden font-sans relative">
      <CronTasksPanel 
        isOpen={isCronModalOpen}
        onClose={() => setIsCronModalOpen(false)}
        crons={crons}
        agents={agents}
        activeSession={activeSession}
        globalChannelId={globalChannelId}
        currentGroupMembers={currentGroup?.members}
        addCron={addCron}
        removeCron={removeCron}
        updateCron={updateCron}
      />

      <WorkspaceFilesPanel
        isOpen={isWorkspaceOpen}
        onClose={() => setIsWorkspaceOpen(false)}
        workspaceId={workspaceFolderId}
      />

      {isCreatingGroup && (
        <CreateGroupModal
          agents={agents}
          closeModal={() => setIsCreatingGroup(false)}
          handleCreateGroup={handleCreateGroup}
        />
      )}

      <Sidebar 
        agents={agents}
        groups={groups}
        activeSession={activeSession}
        setActiveSession={setActiveSession}
        globalChannelId={globalChannelId}
        setGlobalChannelId={setGlobalChannelId}
        setIsCreatingGroup={setIsCreatingGroup}
        setConfigAgentId={setConfigAgentId}
      />

      {configAgentId ? (
        <SettingsView 
          agents={agents}
          configAgentId={configAgentId}
          setConfigAgentId={setConfigAgentId}
          configTab={configTab}
          setConfigTab={setConfigTab}
          activeConfigFileName={activeConfigFileName}
          basicConfigContent={basicConfigContent}
          setBasicConfigContent={setBasicConfigContent}
          isSavingConfig={isSavingConfig}
          loadAgentConfigFile={loadAgentConfigFile}
          saveAgentConfigFile={saveAgentConfigFile}
          toggleAgentCapability={toggleAgentCapability}
        />
      ) : (
        <ChatArea 
          activeSession={activeSession}
          agents={agents}
          currentGroup={currentGroup}
          activeAgentInfo={activeAgentInfo}
          activeChannelId={activeChannelId}
          setConfigAgentId={setConfigAgentId}
          fetchGroups={fetchGroups}
          isWorkspaceOpen={isWorkspaceOpen}
          setIsWorkspaceOpen={setIsWorkspaceOpen}
          setIsCronModalOpen={setIsCronModalOpen}
          crons={crons}
          messages={messages}
          isLoading={isLoading}
          mentionedAgentId={mentionedAgentId}
          renderUserTextWithMentions={renderUserTextWithMentions}
          messagesEndRef={messagesEndRef}
          workspaceFiles={workspaceFiles}
          openFile={openFile}
          viewingFile={viewingFile}
          setViewingFile={setViewingFile}
          mentionMenu={mentionMenu}
          insertMention={insertMention}
          proxyHandleSubmit={proxyHandleSubmit}
          textareaRef={textareaRef}
          input={input}
          handleInputTextChange={handleInputTextChange}
          onAddAgent={handleAddAgent}
          onSetLeader={handleSetLeader}
          onDeleteGroup={handleDeleteGroup}
        />
      )}
    </div>
  );
}
