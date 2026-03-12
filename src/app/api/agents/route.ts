import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

export async function GET() {
  try {
    const homedir = os.homedir();
    const configPath = path.join(homedir, '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      return NextResponse.json({ agents: [] });
    }
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    
    // Convert openclaw agent list into our front-end structure
    const systemAgents = config.agents?.list || [];
    
    // We add icons based on some keywords or randomly just to keep the UI looking nice.
    const UI_AGENTS = systemAgents.map((agent: any, index: number) => {
      // Pick a color based on index or default
      const colors = ['text-indigo-500', 'text-purple-500', 'text-blue-500', 'text-emerald-500', 'text-yellow-500', 'text-slate-500', 'text-sky-500', 'text-rose-500'];
      
      const configName = agent.name || agent.id;
      
      // Default guess an icon name based on ID
      let iconName = 'Bot';
      if (agent.id.includes('architect')) iconName = 'Cpu';
      if (agent.id.includes('dev')) iconName = 'Code';
      if (agent.id.includes('test')) iconName = 'Zap';
      if (agent.id.includes('vision') || agent.id.includes('image')) iconName = 'ImageIcon';

      return {
        id: agent.id,
        name: configName,
        iconName: iconName,
        color: colors[index % colors.length]
      };
    });

    // Make sure we have at least one fallback agent if parsing failed but system has config
    if (UI_AGENTS.length === 0) {
      UI_AGENTS.push({ id: 'main', name: '默认节点', iconName: 'Bot', color: 'text-indigo-500' });
    }
    
    return NextResponse.json({ agents: UI_AGENTS });
  } catch (error) {
    console.error('Failed to parse openclaw config:', error);
    return NextResponse.json(
      { agents: [{ id: 'main', name: '系统节点', iconName: 'Bot', color: 'text-indigo-500' }] }
    );
  }
}