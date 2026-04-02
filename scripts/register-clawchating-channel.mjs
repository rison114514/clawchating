#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_HOME, 'openclaw.json');
const PLUGIN_ID = 'clawchating-channel';
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const DEFAULT_PLUGIN_SPEC_CANDIDATES = [
  process.env.CLAWCHATING_CHANNEL_PLUGIN_SPEC,
  path.join(REPO_ROOT, 'extensions', 'clawchating-channel'),
  path.join(REPO_ROOT, 'plugins', 'clawchating-channel'),
  path.join(process.cwd(), 'extensions', 'clawchating-channel'),
  path.join(process.cwd(), 'plugins', 'clawchating-channel'),
  '@openclaw/clawchating-channel',
  'clawchating-channel',
].filter((item) => typeof item === 'string' && item.trim());

function runCommand(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${code}`));
      }
    });
  });
}

function parseJsonFromMixedOutput(stdout = '', stderr = '') {
  const directCandidates = [String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean);
  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  const extractFromLines = (text) => {
    const lines = String(text || '').split('\n');
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
        return JSON.parse(candidate);
      } catch {
        // continue trimming tail lines
      }
    }

    return null;
  };

  return extractFromLines(stdout) || extractFromLines(stderr);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function parseJsonOutput(command, args) {
  try {
    const { stdout, stderr } = await runCommand(command, args, process.cwd());
    return parseJsonFromMixedOutput(stdout, stderr);
  } catch {
    return null;
  }
}

async function resolvePluginPathFromInfo() {
  const info = await parseJsonOutput('openclaw', ['plugins', 'info', PLUGIN_ID, '--json']);
  if (!info || typeof info !== 'object') return null;

  const source = typeof info.source === 'string'
    ? info.source
    : (info.plugin && typeof info.plugin === 'object' && typeof info.plugin.source === 'string' ? info.plugin.source : '');

  const candidates = [];
  if (source) {
    const sourceDir = path.dirname(source);
    candidates.push(sourceDir, path.dirname(sourceDir), path.dirname(path.dirname(sourceDir)));
  }
  candidates.push(path.join(OPENCLAW_HOME, 'extensions', PLUGIN_ID));

  for (const candidate of candidates) {
    if (!candidate) continue;
    const manifestPath = path.join(candidate, 'openclaw.plugin.json');
    if (await pathExists(manifestPath)) {
      return candidate;
    }
  }

  return null;
}

async function ensurePluginInstalled() {
  const existingPath = await resolvePluginPathFromInfo();
  if (existingPath) {
    return { pluginPath: existingPath, installedFrom: null };
  }

  const installErrors = [];
  const uniqueCandidates = Array.from(new Set(DEFAULT_PLUGIN_SPEC_CANDIDATES.map((item) => String(item))));
  for (const rawCandidate of uniqueCandidates) {
    const candidate = String(rawCandidate || '').trim();
    if (!candidate) continue;

    const isLocalPath = candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../');
    if (isLocalPath) {
      const exists = await pathExists(candidate);
      if (!exists) {
        installErrors.push(`skip ${candidate}: local path not found`);
        continue;
      }
    }

    try {
      await runCommand('openclaw', ['plugins', 'install', candidate]);
      const installedPath = await resolvePluginPathFromInfo();
      if (installedPath) {
        return { pluginPath: installedPath, installedFrom: candidate };
      }
      installErrors.push(`installed ${candidate} but plugin path unresolved`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/plugin already exists/i.test(message)) {
        const localDefault = path.join(OPENCLAW_HOME, 'extensions', PLUGIN_ID);
        const manifestPath = path.join(localDefault, 'openclaw.plugin.json');
        if (await pathExists(manifestPath)) {
          return { pluginPath: localDefault, installedFrom: candidate };
        }
      }
      installErrors.push(`install ${candidate} failed: ${message}`);
    }
  }

  throw new Error(
    [
      'Failed to install clawchating-channel plugin automatically.',
      'Tried candidates:',
      ...installErrors.map((item) => `- ${item}`),
      'You can set CLAWCHATING_CHANNEL_PLUGIN_SPEC to a valid npm spec or local path.',
    ].join('\n')
  );
}

async function main() {
  const { pluginPath, installedFrom } = await ensurePluginInstalled();

  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  const cfg = JSON.parse(raw);

  cfg.plugins = cfg.plugins && typeof cfg.plugins === 'object' ? cfg.plugins : {};
  cfg.plugins.load = cfg.plugins.load && typeof cfg.plugins.load === 'object' ? cfg.plugins.load : {};

  const paths = Array.isArray(cfg.plugins.load.paths) ? cfg.plugins.load.paths : [];
  if (!paths.includes(pluginPath)) {
    paths.push(pluginPath);
  }
  cfg.plugins.load.paths = paths;

  cfg.plugins.entries = cfg.plugins.entries && typeof cfg.plugins.entries === 'object' ? cfg.plugins.entries : {};
  cfg.plugins.entries[PLUGIN_ID] = {
    enabled: true,
    ...(cfg.plugins.entries[PLUGIN_ID] || {}),
  };

  // If plugins.allow is configured, include clawchating plugin explicitly.
  // Otherwise channel plugin can be silently blocked and cause "Unknown channel: clawchating".
  const allow = Array.isArray(cfg.plugins.allow) ? cfg.plugins.allow : [];
  if (!allow.includes(PLUGIN_ID)) {
    allow.push(PLUGIN_ID);
  }
  cfg.plugins.allow = allow;

  cfg.channels = cfg.channels && typeof cfg.channels === 'object' ? cfg.channels : {};
  cfg.channels.clawchating = cfg.channels.clawchating && typeof cfg.channels.clawchating === 'object'
    ? cfg.channels.clawchating
    : {};
  cfg.channels.clawchating.enabled = true;

  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');

  // Best-effort channel account registration via official CLI.
  await runCommand('openclaw', ['channels', 'add', '--channel', 'clawchating', '--account', 'default', '--name', 'Clawchating Local'], process.cwd());

  console.log(JSON.stringify({
    success: true,
    configPath: CONFIG_PATH,
    pluginPath,
    installedFrom,
    pluginId: PLUGIN_ID,
    channel: 'clawchating',
    accountId: 'default',
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
