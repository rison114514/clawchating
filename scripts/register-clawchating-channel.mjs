#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_HOME, 'openclaw.json');
const PLUGIN_PATH = path.join(OPENCLAW_HOME, 'extensions', 'clawchating-channel');
const PLUGIN_ID = 'clawchating-channel';

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

async function main() {
  // Ensure plugin artifacts exist before mutating config.
  await fs.access(path.join(PLUGIN_PATH, 'openclaw.plugin.json'));
  await fs.access(path.join(PLUGIN_PATH, 'dist', 'index.js'));

  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  const cfg = JSON.parse(raw);

  cfg.plugins = cfg.plugins && typeof cfg.plugins === 'object' ? cfg.plugins : {};
  cfg.plugins.load = cfg.plugins.load && typeof cfg.plugins.load === 'object' ? cfg.plugins.load : {};

  const paths = Array.isArray(cfg.plugins.load.paths) ? cfg.plugins.load.paths : [];
  if (!paths.includes(PLUGIN_PATH)) {
    paths.push(PLUGIN_PATH);
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
    pluginPath: PLUGIN_PATH,
    pluginId: PLUGIN_ID,
    channel: 'clawchating',
    accountId: 'default',
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
