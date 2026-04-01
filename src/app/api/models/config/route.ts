import { NextResponse } from 'next/server';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

type OpenClawModelStatus = {
  configPath?: string;
  defaultModel?: string;
  fallbacks?: string[];
  imageModel?: string | null;
  imageFallbacks?: string[];
  allowed?: string[];
  auth?: {
    providers?: Array<{
      provider?: string;
      effective?: {
        kind?: string;
        detail?: string;
      };
    }>;
  };
  agentModels?: Record<string, string>;
};

type OpenClawConfig = {
  agents?: {
    list?: Array<{
      id?: string;
      model?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type OpenClawModelListItem = {
  key: string;
  name?: string;
  input?: string;
  contextWindow?: number;
  available?: boolean;
  local?: boolean;
  tags?: string[];
};

type OpenClawProviderChoice = {
  value: string;
  label: string;
  hint?: string;
  choices: string[];
};

function parseJsonFromMixedOutput(stdout: string, stderr: string) {
  const directCandidates = [stdout.trim(), stderr.trim()].filter(Boolean);
  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // ignore
    }
  }

  const extractFromLines = (text: string) => {
    const lines = text.split('\n');
    const startIndex = lines.findIndex((line) => {
      const trimmed = line.trim();
      return (
        trimmed === '{' ||
        trimmed === '[' ||
        trimmed.startsWith('{"') ||
        trimmed.startsWith('[{') ||
        trimmed.startsWith('["')
      );
    });

    if (startIndex === -1) return null;
    const candidateLines = lines.slice(startIndex);
    for (let end = candidateLines.length; end > 0; end--) {
      const candidate = candidateLines.slice(0, end).join('\n').trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // continue trimming tail lines
      }
    }
    return null;
  };

  return extractFromLines(stdout) || extractFromLines(stderr);
}

async function runOpenClawJson(args: string[], timeout = 30000) {
  const { stdout, stderr } = await execFileAsync('openclaw', args, {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 1024 * 1024,
  });
  const parsed = parseJsonFromMixedOutput(stdout, stderr);
  if (!parsed) {
    throw new Error(`Failed to parse JSON output for command: openclaw ${args.join(' ')}`);
  }
  return parsed;
}

async function runOpenClawCommand(args: string[], timeout = 30000) {
  await execFileAsync('openclaw', args, {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 1024 * 1024,
  });
}

async function runOpenClawConfigSet(path: string, value: unknown) {
  await execFileAsync(
    'openclaw',
    ['config', 'set', '--strict-json', path, JSON.stringify(value)],
    {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }
  );
}

function normalizeAgentModels(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([agentId, model]) => [String(agentId).trim(), String(model || '').trim()])
      .filter(([agentId, model]) => !!agentId && !!model)
  );
}

async function loadOpenClawConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as OpenClawConfig;
  } catch {
    return null;
  }
}

async function loadAgentModelMapFromConfig() {
  const config = await loadOpenClawConfig();
  const list = Array.isArray(config?.agents?.list) ? config!.agents!.list! : [];
  const agentModels: Record<string, string> = {};

  for (const agent of list) {
    const id = String(agent?.id || '').trim();
    const model = String(agent?.model || '').trim();
    if (id && model) {
      agentModels[id] = model;
    }
  }

  return agentModels;
}

async function applyAgentModelOverrides(agentModels: Record<string, string>) {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  const config = await loadOpenClawConfig();
  if (!config || !Array.isArray(config.agents?.list)) return;

  const nextList = config.agents!.list!.map((agent) => {
    const id = String(agent?.id || '').trim();
    if (!id || !Object.prototype.hasOwnProperty.call(agentModels, id)) {
      return agent;
    }

    const model = String(agentModels[id] || '').trim();
    if (model) {
      return { ...agent, model };
    }

    const nextAgent = { ...agent };
    delete nextAgent.model;
    return nextAgent;
  });

  config.agents!.list = nextList;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function normalizeModelList(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [] as OpenClawModelListItem[];
  const modelsRaw = Array.isArray((raw as Record<string, unknown>).models)
    ? (raw as Record<string, unknown>).models as unknown[]
    : [];

  return modelsRaw
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        key: typeof row.key === 'string' ? row.key : '',
        name: typeof row.name === 'string' ? row.name : undefined,
        input: typeof row.input === 'string' ? row.input : undefined,
        contextWindow: typeof row.contextWindow === 'number' ? row.contextWindow : undefined,
        available: typeof row.available === 'boolean' ? row.available : undefined,
        local: typeof row.local === 'boolean' ? row.local : undefined,
        tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
      } as OpenClawModelListItem;
    })
    .filter((item) => item.key);
}

function normalizeModelStatus(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      configPath: '',
      defaultModel: '',
      fallbacks: [],
      imageModel: null,
      imageFallbacks: [],
      allowed: [],
      authProviders: [],
    };
  }

  const status = raw as OpenClawModelStatus;
  const authProviders = Array.isArray(status.auth?.providers)
    ? status.auth!.providers!
      .map((provider) => ({
        provider: String(provider.provider || ''),
        effectiveKind: String(provider.effective?.kind || ''),
        effectiveDetail: String(provider.effective?.detail || ''),
      }))
      .filter((provider) => provider.provider)
    : [];

  return {
    configPath: typeof status.configPath === 'string' ? status.configPath : '',
    defaultModel: typeof status.defaultModel === 'string' ? status.defaultModel : '',
    fallbacks: Array.isArray(status.fallbacks) ? status.fallbacks.map((item) => String(item)).filter(Boolean) : [],
    imageModel: typeof status.imageModel === 'string' ? status.imageModel : null,
    imageFallbacks: Array.isArray(status.imageFallbacks)
      ? status.imageFallbacks.map((item) => String(item)).filter(Boolean)
      : [],
    allowed: Array.isArray(status.allowed) ? status.allowed.map((item) => String(item)).filter(Boolean) : [],
    authProviders,
    agentModels: normalizeAgentModels(status.agentModels),
  };
}

async function resolveOpenClawDistDir() {
  try {
    const { stdout } = await execFileAsync('which', ['openclaw'], {
      cwd: process.cwd(),
      timeout: 5000,
      maxBuffer: 1024 * 64,
    });
    const binPath = stdout.trim();
    if (!binPath) return '';
    const realBinPath = await fs.realpath(binPath);

    const candidates = [
      path.resolve(realBinPath, '..', '..', 'dist'),
      path.resolve(realBinPath, '..', 'dist'),
      path.resolve(path.dirname(realBinPath), '..', 'dist'),
    ];

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) return candidate;
      } catch {
        // continue
      }
    }
    return '';
  } catch {
    return '';
  }
}

function parseProviderChoicesFromSource(source: string) {
  const anchor = 'const AUTH_CHOICE_GROUP_DEFS = [';
  const startIndex = source.indexOf(anchor);
  if (startIndex === -1) return [] as OpenClawProviderChoice[];

  const arrayStart = source.indexOf('[', startIndex);
  const arrayEnd = source.indexOf('];', arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) return [] as OpenClawProviderChoice[];

  const section = source.slice(arrayStart + 1, arrayEnd);
  const objectRegex = /\{\s*value:\s*"([^"]+)",\s*label:\s*"([^"]+)"(?:,\s*hint:\s*"([^"]*)")?,\s*choices:\s*\[([^\]]*)\]\s*\}/g;
  const results: OpenClawProviderChoice[] = [];

  for (const match of section.matchAll(objectRegex)) {
    const rawChoices = match[4] || '';
    const choices = rawChoices
      .split(',')
      .map((item) => item.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);

    results.push({
      value: match[1],
      label: match[2],
      hint: match[3] || undefined,
      choices,
    });
  }

  return results;
}

async function loadProviderChoicesFromOpenClawDist() {
  const distDir = await resolveOpenClawDistDir();
  if (!distDir) return [] as OpenClawProviderChoice[];

  try {
    const files = await fs.readdir(distDir);
    const target = files.find((file) => file.startsWith('auth-choice-options-') && file.endsWith('.js'));
    if (!target) return [] as OpenClawProviderChoice[];

    const content = await fs.readFile(path.join(distDir, target), 'utf-8');
    return parseProviderChoicesFromSource(content);
  } catch {
    return [] as OpenClawProviderChoice[];
  }
}

async function runOpenClawAuthPasteToken(params: {
  provider: string;
  profileId?: string;
  apiKey: string;
}) {
  const args = ['models', 'auth', 'paste-token', '--provider', params.provider];
  if (params.profileId && params.profileId.trim()) {
    args.push('--profile-id', params.profileId.trim());
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('openclaw', args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `openclaw exited with code ${code}`));
      }
    });

    child.stdin.write(`${params.apiKey.trim()}\n`);
    child.stdin.end();
  });
}

export async function GET() {
  try {
    const [statusRaw, listRaw, providerChoices, agentModels] = await Promise.all([
      runOpenClawJson(['models', 'status', '--json'], 30000),
      runOpenClawJson(['models', 'list', '--json'], 30000),
      loadProviderChoicesFromOpenClawDist(),
      loadAgentModelMapFromConfig(),
    ]);

    const models = normalizeModelList(listRaw);
    const status = normalizeModelStatus(statusRaw);

    return NextResponse.json({
      status: {
        ...status,
        agentModels,
      },
      models,
      providers: providerChoices,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      mode?: 'save-models' | 'save-auth';
      defaultModel?: string;
      imageModel?: string | null;
      fallbacks?: string[];
      imageFallbacks?: string[];
      allowed?: string[];
      agentModels?: Record<string, string>;
      provider?: string;
      apiKey?: string;
      profileId?: string;
    };

    const mode = body.mode || 'save-models';

    if (mode === 'save-auth') {
      const provider = String(body.provider || '').trim();
      const apiKey = String(body.apiKey || '').trim();
      const profileId = String(body.profileId || '').trim();
      if (!provider || !apiKey) {
        return NextResponse.json({ error: 'provider and apiKey are required for save-auth' }, { status: 400 });
      }

      await runOpenClawAuthPasteToken({ provider, profileId: profileId || undefined, apiKey });
      const statusRaw = await runOpenClawJson(['models', 'status', '--json'], 30000);
      return NextResponse.json({
        success: true,
        status: normalizeModelStatus(statusRaw),
      });
    }

    const defaultModel = String(body.defaultModel || '').trim();
    const imageModel = typeof body.imageModel === 'string' ? body.imageModel.trim() : null;
    const fallbacks = Array.isArray(body.fallbacks)
      ? body.fallbacks.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const imageFallbacks = Array.isArray(body.imageFallbacks)
      ? body.imageFallbacks.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const allowed = Array.isArray(body.allowed)
      ? body.allowed.map((item) => String(item).trim()).filter(Boolean)
      : [];

    if (!defaultModel) {
      return NextResponse.json({ error: 'defaultModel is required' }, { status: 400 });
    }

    const allowedMap = Object.fromEntries(allowed.map((modelKey) => [modelKey, {}]));

    await runOpenClawCommand(['models', 'set', defaultModel]);

    await runOpenClawCommand(['models', 'fallbacks', 'clear']);
    for (const fallback of fallbacks) {
      await runOpenClawCommand(['models', 'fallbacks', 'add', fallback]);
    }

    await runOpenClawCommand(['models', 'image-fallbacks', 'clear']);
    for (const fallback of imageFallbacks) {
      await runOpenClawCommand(['models', 'image-fallbacks', 'add', fallback]);
    }

    // OpenClaw CLI currently has no explicit clear-image command; only set when provided.
    if (imageModel) {
      await runOpenClawCommand(['models', 'set-image', imageModel]);
    }

    await runOpenClawConfigSet('agents.defaults.models', allowedMap);

    const nextAgentModels = normalizeAgentModels(body.agentModels);
    if (Object.keys(nextAgentModels).length > 0 || typeof body.agentModels === 'object') {
      await applyAgentModelOverrides(nextAgentModels);
    }

    const statusRaw = await runOpenClawJson(['models', 'status', '--json'], 30000);
    const agentModels = await loadAgentModelMapFromConfig();
    return NextResponse.json({
      success: true,
      status: {
        ...normalizeModelStatus(statusRaw),
        agentModels,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
