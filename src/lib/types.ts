export type Agent = {
  id: string;
  name: string;
  icon: any; 
  color: string;
  avatarEmoji?: string;
  hasAvatarImage?: boolean;
  isDefault?: boolean;
  capabilities: { read: boolean; write: boolean; exec: boolean; invite: boolean; skills: boolean };
};

export type Group = {
  id: string;
  name: string;
  members: string[];
  leaderId?: string; // Agent IDs
  channelId: string;
  ownerId?: string;
  ownerName?: string;
};

export type SessionType = {
  type: 'agent' | 'group';
  id: string;
};

export type CronTask = {
  id: string;
  groupId: string;
  agentId: string;
  intervalMin: number;
  prompt: string;
  lastRun?: number;
  active?: boolean;
};

export type WorkspaceEntry = {
  name: string;
  isDirectory: boolean;
  path: string;
};
