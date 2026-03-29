export type Agent = {
  id: string;
  name: string;
  icon: any; 
  color: string;
  avatarEmoji?: string;
  hasAvatarImage?: boolean;
  isDefault?: boolean;
  toolsAlsoAllow: string[];
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
  scheduleType?: 'interval' | 'daily';
  intervalMin?: number;
  dailyTime?: string;
  prompt: string;
  lastRun?: number;
  active?: boolean;
};

export type WorkspaceEntry = {
  name: string;
  isDirectory: boolean;
  path: string;
};
