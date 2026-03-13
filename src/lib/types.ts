export type Agent = {
  id: string;
  name: string;
  icon: any; 
  color: string;
  capabilities: { read: boolean; write: boolean; exec: boolean; invite: boolean };
};

export type Group = {
  id: string;
  name: string;
  members: string[];
  leaderId?: string; // Agent IDs
  channelId: string;
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
