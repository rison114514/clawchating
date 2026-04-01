'use client';

import { useState, useRef, useEffect } from 'react';
import { Bot, Zap, Cpu, Code, PenTool, Image as ImageIcon, Terminal, Settings, Users } from 'lucide-react';
import { Agent, Group, SessionType, CronTask, WorkspaceEntry } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { SettingsView } from '../components/SettingsView';
import { CronTasksPanel } from '../components/Panels/CronTasksPanel';
import { WorkspaceFilesPanel } from '../components/Panels/WorkspaceFilesPanel';
import { CreateGroupModal } from '../components/Modals/CreateGroupModal';
import { ChatArea } from '../components/ChatArea';

const INITIAL_AGENTS: Agent[] = [
  { id: 'main', name: '爪爪 - 本地启动中...', icon: Bot, color: 'text-indigo-500', toolsAlsoAllow: [] }
];

type OpenClawModelConfig = {
  configPath: string;
  defaultModel: string;
  imageModel: string | null;
  fallbacks: string[];
  imageFallbacks: string[];
  allowed: string[];
  agentModels: Record<string, string>;
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

type ToolCatalogItem = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  source: 'core' | 'detected';
};

const MESSAGE_PAGE_SIZE = 50;

export default function Chat() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [activeSession, setActiveSession] = useState<SessionType>({ type: 'agent', id: 'main' });
  const [groups, setGroups] = useState<Group[]>([]);
  
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [configAgentId, setConfigAgentId] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<'capabilities' | 'files' | 'models'>('capabilities');
  const [activeConfigFileName, setActiveConfigFileName] = useState<string | null>(null);
  const [basicConfigContent, setBasicConfigContent] = useState<string>('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [toolCatalog, setToolCatalog] = useState<ToolCatalogItem[]>([]);
  const [savingToolsAgentId, setSavingToolsAgentId] = useState<string | null>(null);
  const [nativeSkills, setNativeSkills] = useState<Array<{ name: string; description?: string; source?: string }>>([]);
  const [modelOptions, setModelOptions] = useState<Array<{ key: string; name?: string }>>([]);
  const [isLoadingModelOptions, setIsLoadingModelOptions] = useState(false);
  const [openClawModelConfig, setOpenClawModelConfig] = useState<OpenClawModelConfig | null>(null);
  const [openClawModels, setOpenClawModels] = useState<OpenClawModelItem[]>([]);
  const [openClawProviders, setOpenClawProviders] = useState<OpenClawProviderOption[]>([]);
  const [isLoadingOpenClawModelConfig, setIsLoadingOpenClawModelConfig] = useState(false);
  const [isSavingOpenClawModelConfig, setIsSavingOpenClawModelConfig] = useState(false);

  const [crons, setCrons] = useState<CronTask[]>([]);
  const [isCronModalOpen, setIsCronModalOpen] = useState(false);
  
  const [mentionMenu, setMentionMenu] = useState({ show: false, query: '', index: -1 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [globalChannelId, setGlobalChannelId] = useState('default-workspace');
  
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceEntry[]>([]);
  const [viewingFile, setViewingFile] = useState<{name: string, content: string}|null>(null);

  const [messages, setMessages] = useState<any[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const resolveGroupDefaultAgentId = () => {
    if (!currentGroup) return 'main';
    if (currentGroup.leaderId && currentGroup.members.includes(currentGroup.leaderId)) {
      return currentGroup.leaderId;
    }
    return currentGroup.members[0] || 'main';
  };

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const resolveMentionedAgentId = (text: string): string | undefined => {
    if (activeSession.type !== 'group' || !currentGroup || !text) return undefined;

    let latestMatchIndex = -1;
    let matchedAgentId: string | undefined;

    for (const memberId of currentGroup.members) {
      const ag = agents.find(a => a.id === memberId);
      if (!ag) continue;

      const candidates = [ag.name, ag.id].filter(Boolean);
      for (const candidate of candidates) {
        const pattern = new RegExp(`(^|\\s)@${escapeRegExp(candidate)}(?=\\s|$|[，。,.!?！？:：;；])`, 'g');
        for (const match of text.matchAll(pattern)) {
          const index = match.index ?? -1;
          if (index > latestMatchIndex) {
            latestMatchIndex = index;
            matchedAgentId = ag.id;
          }
        }
      }
    }

    return matchedAgentId;
  };
  
  const currentGroup = activeSession.type === 'group' ? groups.find(g => g.id === activeSession.id) : null;
  const activeChannelId = activeSession.type === 'group' ? (currentGroup?.channelId || 'default') : globalChannelId;
  const workspaceFolderId = activeSession.type === 'group' ? activeSession.id : activeChannelId;

  const fetchWorkspaceFiles = async () => {
    try {
      const res = await fetch(`/api/workspace/files?scopedId=${workspaceFolderId}`);
      const data = await res.json();
      if (Array.isArray(data.files)) {
        const normalized: WorkspaceEntry[] = data.files
          .map((entry: any) => {
            if (typeof entry === 'string') {
              return { name: entry, isDirectory: false, path: entry };
            }
            return {
              name: String(entry?.name || ''),
              isDirectory: !!entry?.isDirectory,
              path: String(entry?.path || entry?.name || ''),
            };
          })
          .filter((entry: WorkspaceEntry) => !!entry.name && !!entry.path);
        setWorkspaceFiles(normalized);
      }
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

  const resolveUiPeerId = () => {
    if (activeSession.type === 'group' && currentGroup?.ownerId) return currentGroup.ownerId;
    if (activeChannelId.startsWith('ou_')) return activeChannelId;
    return 'ou_local_user';
  };

  const sanitizeSessionPeer = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

  const resolveScopedPeerId = () => {
    const basePeer = resolveUiPeerId();
    if (activeSession.type === 'group') {
      return sanitizeSessionPeer(`grp_${activeSession.id}__ch_${activeChannelId || 'default'}__${basePeer}`);
    }
    return sanitizeSessionPeer(basePeer);
  };

  const buildSessionKeyForAgent = (agentId: string) => `agent:${agentId}:clawchating:direct:${resolveScopedPeerId()}`;

  const loadAgentId = activeSession.type === 'group' ? resolveGroupDefaultAgentId() : activeSession.id;
  const sessionIdentifier = buildSessionKeyForAgent(loadAgentId);

  const normalizeLoadedMessages = (data: any[]) => {
    return data.map((m: any, index: number) => ({
      id: m.id || `${Date.now()}-${index}`,
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      name: typeof m.name === 'string' ? m.name : undefined,
      meta: m?.meta,
    }));
  };

  const loadCurrentMessages = async (traceId?: string) => {
    setIsRefreshingMessages(true);
    try {
      if (activeSession.type === 'group') {
        const traceParam = traceId ? `&traceId=${encodeURIComponent(traceId)}` : '';
        const res = await fetch(
          `/api/messages?groupId=${encodeURIComponent(activeSession.id)}&channelId=${encodeURIComponent(activeChannelId)}&limit=${MESSAGE_PAGE_SIZE}&offset=0${traceParam}`
        );
        const data = await res.json();
        const loaded = Array.isArray(data?.messages) ? normalizeLoadedMessages(data.messages) : [];
        setMessages(loaded);
        setHasMoreHistory(!!data?.hasMore);
        return;
      }

      const traceParam = traceId ? `&traceId=${encodeURIComponent(traceId)}` : '';
      const res = await fetch(
        `/api/messages?agentId=${loadAgentId}&sessionKey=${encodeURIComponent(sessionIdentifier)}&limit=${MESSAGE_PAGE_SIZE}&offset=0${traceParam}`
      );
      const data = await res.json();
      const loaded = Array.isArray(data?.messages) ? normalizeLoadedMessages(data.messages) : [];
      setMessages(loaded);
      setHasMoreHistory(!!data?.hasMore);
    } finally {
      setIsRefreshingMessages(false);
    }
  };

  const loadHistoryMessages = async () => {
    if (isLoadingHistory || !hasMoreHistory) return;
    setIsLoadingHistory(true);
    try {
      const currentCount = messages.length;
      if (activeSession.type === 'group') {
        const res = await fetch(
          `/api/messages?groupId=${encodeURIComponent(activeSession.id)}&channelId=${encodeURIComponent(activeChannelId)}&limit=${MESSAGE_PAGE_SIZE}&offset=${currentCount}`
        );
        const data = await res.json();
        const older = Array.isArray(data?.messages) ? normalizeLoadedMessages(data.messages) : [];
        setMessages((prev) => [...older, ...prev]);
        setHasMoreHistory(!!data?.hasMore);
        return;
      }

      const res = await fetch(
        `/api/messages?agentId=${loadAgentId}&sessionKey=${encodeURIComponent(sessionIdentifier)}&limit=${MESSAGE_PAGE_SIZE}&offset=${currentCount}`
      );
      const data = await res.json();
      const older = Array.isArray(data?.messages) ? normalizeLoadedMessages(data.messages) : [];
      setMessages((prev) => [...older, ...prev]);
      setHasMoreHistory(!!data?.hasMore);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleRecoverMessage = async (messageId: string, agentId: string) => {
    if (!currentGroup) return false;
    try {
      const res = await fetch('/api/chat/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          groupId: currentGroup.id,
          channelId: currentGroup.channelId,
          lookbackSeconds: 900
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (activeSession.type === 'group') {
          // Force reload current view
          await loadCurrentMessages();
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  useEffect(() => {
    loadCurrentMessages().catch(console.error);
  }, [activeSession.type, activeSession.id, activeChannelId, sessionIdentifier, loadAgentId]);

  const currentMentionedAgentId = resolveMentionedAgentId(input);

  const proxyHandleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) return;

    const latestInput = textareaRef.current?.value ?? input;
    if (!latestInput.trim()) return;

    const mentionedInSubmit = resolveMentionedAgentId(latestInput);
    const clientTraceId = `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetAgentIdForSubmit = mentionedInSubmit
      ? mentionedInSubmit
      : (activeSession.type === 'agent' ? activeSession.id : resolveGroupDefaultAgentId());

    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-user`,
        role: 'user',
        content: latestInput,
      },
    ]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputText: latestInput,
          agentId: targetAgentIdForSubmit,
          isMention: !!mentionedInSubmit,
          timeoutSeconds: 600,
          channelId: activeChannelId,
          sessionType: activeSession.type,
          groupId: activeSession.type === 'group' ? activeSession.id : undefined,
          groupMembers: activeSession.type === 'group' ? currentGroup?.members : undefined,
          senderId: resolveUiPeerId(),
          senderName: 'Clawchating User',
          autoMentionName: 'Clawchating User',
          traceId: clientTraceId,
        }),
      });

      const raw = await res.text();
      const data = raw
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return { error: raw };
            }
          })()
        : {};
      if (!res.ok) {
        throw new Error(data?.error || 'Chat request failed');
      }

      const effectiveTraceId = typeof data?.traceId === 'string' && data.traceId.trim()
        ? data.traceId
        : clientTraceId;

      if (activeSession.type === 'group') {
        await loadCurrentMessages(effectiveTraceId);
      } else {
        setMessages((current) => [
          ...current,
          {
            id: data?.message?.id || `${Date.now()}-assistant`,
            role: 'assistant',
            content: data?.message?.content || '系统未返回有效回复。',
            name: data?.message?.name || targetAgentIdForSubmit,
            meta: { traceId: effectiveTraceId },
          },
        ]);
      }
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : String(error || '未知错误');
      const userFacingError = /aborted|timeout|timed out|超时|中止/i.test(errorMessage)
        ? `请求超时或被中止：${errorMessage}`
        : `请求失败：${errorMessage}`;
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-error`,
          role: 'assistant',
          content: userFacingError,
          name: targetAgentIdForSubmit,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  useEffect(() => {
    if (activeSession.type === 'group' && currentGroup && !currentGroup.ownerId) {
      const patchedGroup = { ...currentGroup, ownerId: resolveUiPeerId(), ownerName: 'Clawchating User' };
      fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchedGroup),
      })
        .then(() => fetchGroups())
        .catch(console.error);
    }
  }, [activeSession.type, activeSession.id, currentGroup]);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAvailableTools(
        Array.isArray(data?.availableTools)
          ? data.availableTools.map((item: unknown) => String(item)).filter(Boolean)
          : []
      );
      setToolCatalog(
        Array.isArray(data?.toolCatalog)
          ? data.toolCatalog
              .map((item: any) => ({
                id: String(item?.id || ''),
                label: String(item?.label || item?.id || ''),
                description: String(item?.description || ''),
                sectionId: String(item?.sectionId || 'custom'),
                source: item?.source === 'core' ? 'core' : 'detected',
              }))
              .filter((item: ToolCatalogItem) => !!item.id)
          : []
      );
      if (data?.agents?.length > 0) {
        const ICON_MAP = { Bot, Cpu, Code, Terminal, Zap, Settings, PenTool, ImageIcon };
        const loadedAgents = data.agents.map((a: any) => ({
          id: a.id,
          name: a.name,
          icon: ICON_MAP[a.iconName as keyof typeof ICON_MAP] || Bot,
          color: a.color || 'text-indigo-500',
          avatarEmoji: typeof a.avatarEmoji === 'string' ? a.avatarEmoji : undefined,
          hasAvatarImage: !!a.hasAvatarImage,
          isDefault: !!a.isDefault,
          model: typeof a.model === 'string' ? a.model : undefined,
          toolsAlsoAllow: Array.isArray(a?.toolsAlsoAllow)
            ? a.toolsAlsoAllow.map((item: unknown) => String(item)).filter(Boolean)
            : [],
        }));
        setAgents(loadedAgents);
        if (activeSession.type === 'agent' && !loadedAgents.find((a: any) => a.id === activeSession.id)) {
          setActiveSession({ type: 'agent', id: loadedAgents[0].id });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchModelOptions = async () => {
    setIsLoadingModelOptions(true);
    try {
      const res = await fetch('/api/agents?resource=models');
      const data = await res.json();
      if (Array.isArray(data?.models)) {
        const normalized = data.models
          .map((model: any) => ({
            key: String(model?.key || ''),
            name: typeof model?.name === 'string' ? model.name : undefined,
          }))
          .filter((model: { key: string; name?: string }) => !!model.key);
        setModelOptions(normalized);
      } else {
        setModelOptions([]);
      }
    } catch (e) {
      console.error(e);
      setModelOptions([]);
    } finally {
      setIsLoadingModelOptions(false);
    }
  };

  const fetchOpenClawModelConfig = async () => {
    setIsLoadingOpenClawModelConfig(true);
    try {
      const res = await fetch('/api/models/config');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '加载模型配置失败');
      }

      const status = data?.status;
      const models = Array.isArray(data?.models) ? data.models : [];
      const providers = Array.isArray(data?.providers)
        ? data.providers
            .map((item: any) => ({
              value: String(item?.value || ''),
              label: String(item?.label || ''),
              hint: typeof item?.hint === 'string' ? item.hint : undefined,
              choices: Array.isArray(item?.choices) ? item.choices.map((choice: unknown) => String(choice)) : [],
            }))
            .filter((item: { value: string; label: string }) => item.value && item.label)
        : [];

      setOpenClawModelConfig({
        configPath: String(status?.configPath || ''),
        defaultModel: String(status?.defaultModel || ''),
        imageModel: typeof status?.imageModel === 'string' ? status.imageModel : null,
        fallbacks: Array.isArray(status?.fallbacks) ? status.fallbacks.map((item: unknown) => String(item)) : [],
        imageFallbacks: Array.isArray(status?.imageFallbacks) ? status.imageFallbacks.map((item: unknown) => String(item)) : [],
        allowed: Array.isArray(status?.allowed) ? status.allowed.map((item: unknown) => String(item)) : [],
        agentModels: status?.agentModels && typeof status.agentModels === 'object' && !Array.isArray(status.agentModels)
          ? Object.fromEntries(
              Object.entries(status.agentModels as Record<string, unknown>)
                .map(([agentId, model]) => [String(agentId), String(model || '').trim()])
                .filter(([agentId, model]) => !!agentId && !!model)
            )
          : {},
        authProviders: Array.isArray(status?.authProviders)
          ? status.authProviders.map((provider: any) => ({
              provider: String(provider?.provider || ''),
              effectiveKind: String(provider?.effectiveKind || ''),
              effectiveDetail: String(provider?.effectiveDetail || ''),
            })).filter((provider: { provider: string }) => provider.provider)
          : [],
      });

      setOpenClawModels(
        models
          .map((item: any) => ({
            key: String(item?.key || ''),
            name: typeof item?.name === 'string' ? item.name : undefined,
            input: typeof item?.input === 'string' ? item.input : undefined,
            contextWindow: typeof item?.contextWindow === 'number' ? item.contextWindow : undefined,
            available: typeof item?.available === 'boolean' ? item.available : undefined,
            local: typeof item?.local === 'boolean' ? item.local : undefined,
            tags: Array.isArray(item?.tags) ? item.tags.map((tag: unknown) => String(tag)) : [],
          }))
          .filter((item: OpenClawModelItem) => item.key)
      );
      setOpenClawProviders(providers);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoadingOpenClawModelConfig(false);
    }
  };

  const saveOpenClawModelConfig = async (payload: {
    defaultModel: string;
    imageModel: string | null;
    fallbacks: string[];
    imageFallbacks: string[];
    allowed: string[];
    agentModels: Record<string, string>;
  }) => {
    setIsSavingOpenClawModelConfig(true);
    try {
      const res = await fetch('/api/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '保存模型配置失败');
      }

      await fetchOpenClawModelConfig();
    } finally {
      setIsSavingOpenClawModelConfig(false);
    }
  };

  const saveOpenClawProviderAuth = async (payload: {
    provider: string;
    apiKey: string;
    profileId?: string;
  }) => {
    setIsSavingOpenClawModelConfig(true);
    try {
      const res = await fetch('/api/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'save-auth',
          provider: payload.provider,
          apiKey: payload.apiKey,
          profileId: payload.profileId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '保存供应商鉴权失败');
      }

      await fetchOpenClawModelConfig();
    } finally {
      setIsSavingOpenClawModelConfig(false);
    }
  };

  useEffect(() => {
    fetchAgents();
    fetchModelOptions();
    fetchOpenClawModelConfig();

    fetch('/api/skills?eligible=true')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data?.skills)) {
          setNativeSkills(
            data.skills.map((s: any) => ({
              name: String(s.name || ''),
              description: typeof s.description === 'string' ? s.description : '',
              source: typeof s.source === 'string' ? s.source : '',
            })).filter((s: any) => s.name)
          );
        }
      })
      .catch(console.error);
  }, []);

  const createAgent = async (payload: {
    agentId: string;
    name?: string;
    workspace?: string;
    model?: string;
    bindings?: string[];
    setDefault?: boolean;
  }) => {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || '创建 Agent 失败');
    }

    await fetchAgents();
    setActiveSession({ type: 'agent', id: payload.agentId });
  };

  const deleteAgent = async (agentId: string) => {
    const res = await fetch(`/api/agents?agentId=${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || '删除 Agent 失败');
    }
    await fetchAgents();
  };

  const setDefaultAgent = async (agentId: string) => {
    const res = await fetch('/api/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || '设置默认 Agent 失败');
    }
    await fetchAgents();
  };

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
    const newGroupInfo = {
      name,
      members,
      channelId,
      ownerId: resolveUiPeerId(),
      ownerName: 'Clawchating User',
    };
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

  const handleRemoveAgent = async (memberId: string) => {
    if (!currentGroup) return;
    if (!currentGroup.members.includes(memberId)) return;
    if (currentGroup.members.length <= 1) {
      alert('群组至少需要保留 1 个成员。');
      return;
    }

    const nextMembers = currentGroup.members.filter((id) => id !== memberId);
    const nextLeaderId = currentGroup.leaderId === memberId
      ? (nextMembers[0] || undefined)
      : currentGroup.leaderId;

    const updatedGroup = {
      ...currentGroup,
      members: nextMembers,
      leaderId: nextLeaderId,
    };

    try {
      await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedGroup),
      });
      fetchGroups();
    } catch (e) {
      console.error('Failed to remove agent from group', e);
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

  const updateAgentToolsAllow = async (agentId: string, payload: { alsoAllow?: string[]; action?: 'all-on' | 'all-off' }) => {
    if (savingToolsAgentId === agentId) return;

    const currentAgent = agents.find((a) => a.id === agentId);
    if (!currentAgent) return;
    const previousTools = Array.isArray(currentAgent.toolsAlsoAllow) ? currentAgent.toolsAlsoAllow : [];

    const optimisticTools = payload.action === 'all-off'
      ? []
      : payload.action === 'all-on'
        ? availableTools
        : (payload.alsoAllow || previousTools);

    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, toolsAlsoAllow: optimisticTools } : a)));
    setSavingToolsAgentId(agentId);

    try {
      const res = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          ...payload,
          availableTools,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || 'Failed to persist tools allowlist');
      }

      const persisted = Array.isArray((data as any)?.alsoAllow)
        ? (data as any).alsoAllow.map((item: unknown) => String(item)).filter(Boolean)
        : optimisticTools;
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, toolsAlsoAllow: persisted } : a)));
      if (Array.isArray((data as any)?.availableTools)) {
        setAvailableTools((data as any).availableTools.map((item: unknown) => String(item)).filter(Boolean));
      }
      if (Array.isArray((data as any)?.toolCatalog)) {
        setToolCatalog(
          (data as any).toolCatalog
            .map((item: any) => ({
              id: String(item?.id || ''),
              label: String(item?.label || item?.id || ''),
              description: String(item?.description || ''),
              sectionId: String(item?.sectionId || 'custom'),
              source: item?.source === 'core' ? 'core' : 'detected',
            }))
            .filter((item: ToolCatalogItem) => !!item.id)
        );
      }
    } catch (e) {
      console.error('Failed to persist tools allowlist', e);
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, toolsAlsoAllow: previousTools } : a)));
      alert('工具权限保存失败，已回滚本地修改。');
    } finally {
      setSavingToolsAgentId(null);
    }
  };

  const toggleAgentTool = async (agentId: string, toolName: string) => {
    const currentAgent = agents.find((a) => a.id === agentId);
    if (!currentAgent) return;
    const currentTools = Array.isArray(currentAgent.toolsAlsoAllow) ? currentAgent.toolsAlsoAllow : [];
    const nextTools = currentTools.includes(toolName)
      ? currentTools.filter((item) => item !== toolName)
      : [...currentTools, toolName];

    await updateAgentToolsAllow(agentId, { alsoAllow: nextTools });
  };

  const setAllAgentTools = async (agentId: string, enabled: boolean) => {
    await updateAgentToolsAllow(agentId, { action: enabled ? 'all-on' : 'all-off' });
  };

  const setAgentToolsAllow = async (agentId: string, tools: string[]) => {
    await updateAgentToolsAllow(agentId, { alsoAllow: Array.from(new Set(tools.map((item) => String(item).trim()).filter(Boolean))) });
  };

  const openModelConfig = () => {
    const preferredAgentId = activeSession.type === 'agent'
      ? activeSession.id
      : (resolveGroupDefaultAgentId() || agents[0]?.id || 'main');
    setConfigTab('models');
    setConfigAgentId(preferredAgentId);
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
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
        modelOptions={modelOptions}
        isLoadingModelOptions={isLoadingModelOptions}
        refreshModelOptions={fetchModelOptions}
        activeSession={activeSession}
        setActiveSession={setActiveSession}
        globalChannelId={globalChannelId}
        setGlobalChannelId={setGlobalChannelId}
        setIsCreatingGroup={setIsCreatingGroup}
        setConfigAgentId={setConfigAgentId}
        openModelConfig={openModelConfig}
        createAgent={createAgent}
        deleteAgent={deleteAgent}
        setDefaultAgent={setDefaultAgent}
        logout={logout}
      />

      {configAgentId ? (
        <SettingsView 
          agents={agents}
          nativeSkills={nativeSkills}
          configAgentId={configAgentId}
          setConfigAgentId={setConfigAgentId}
          configTab={configTab}
          setConfigTab={setConfigTab}
          openClawModelConfig={openClawModelConfig}
          openClawModels={openClawModels}
          openClawProviders={openClawProviders}
          isLoadingOpenClawModelConfig={isLoadingOpenClawModelConfig}
          isSavingOpenClawModelConfig={isSavingOpenClawModelConfig}
          refreshOpenClawModelConfig={fetchOpenClawModelConfig}
          saveOpenClawModelConfig={saveOpenClawModelConfig}
          saveOpenClawProviderAuth={saveOpenClawProviderAuth}
          activeConfigFileName={activeConfigFileName}
          basicConfigContent={basicConfigContent}
          setBasicConfigContent={setBasicConfigContent}
          isSavingConfig={isSavingConfig}
          loadAgentConfigFile={loadAgentConfigFile}
          saveAgentConfigFile={saveAgentConfigFile}
          availableTools={availableTools}
          toolCatalog={toolCatalog}
          toggleAgentTool={toggleAgentTool}
          setAllAgentTools={setAllAgentTools}
          setAgentToolsAllow={setAgentToolsAllow}
          isUpdatingTools={savingToolsAgentId === configAgentId}
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
          hasMoreHistory={hasMoreHistory}
          isLoadingHistory={isLoadingHistory}
          isRefreshingMessages={isRefreshingMessages}
          onLoadHistoryMessages={loadHistoryMessages}
          onRefreshMessages={loadCurrentMessages}
          isLoading={isLoading}
          mentionedAgentId={currentMentionedAgentId}
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
          onRemoveAgent={handleRemoveAgent}
          onDeleteGroup={handleDeleteGroup}
          onRecoverMessage={handleRecoverMessage}
        />
      )}
    </div>
  );
}
