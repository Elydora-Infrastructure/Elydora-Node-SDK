import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentPlugin, InstallConfig, PluginStatus } from './base.js';
import { SUPPORTED_AGENTS } from './registry.js';

const AGENT_KEY = 'codex';
const GUARD_STATUS = 'Checking Elydora agent state';
const AUDIT_STATUS = 'Recording Elydora tool use';
const entry = SUPPORTED_AGENTS.get(AGENT_KEY)!;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveConfigPath(): string {
  const configDir = entry.configDir.replace(/^~/, os.homedir());
  return path.join(configDir, entry.configFile);
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildHandler(scriptPath: string, statusMessage: string): JsonObject {
  return {
    type: 'command',
    command: `${quotePosix(process.execPath)} ${quotePosix(scriptPath)}`,
    commandWindows: `${quoteWindows(process.execPath)} ${quoteWindows(scriptPath)}`,
    timeout: 10,
    statusMessage,
  };
}

function eventGroups(hooks: JsonObject, event: string): JsonObject[] {
  const value = hooks[event];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isObject)) {
    throw new Error(`Codex hooks config field "hooks.${event}" must be an array of objects`);
  }
  return value;
}

function isElydoraHandler(handler: JsonObject, agentId?: string): boolean {
  if (handler.statusMessage !== GUARD_STATUS && handler.statusMessage !== AUDIT_STATUS) return false;
  if (!agentId) return true;
  return [handler.command, handler.commandWindows].some(
    (command) => typeof command === 'string' && command.includes(agentId),
  );
}

function withoutElydora(groups: JsonObject[], agentId?: string): JsonObject[] {
  const result: JsonObject[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.hooks) || !group.hooks.every(isObject)) {
      throw new Error('Codex hook matcher group must contain a hooks array');
    }
    const handlers = group.hooks.filter((handler) => !isElydoraHandler(handler, agentId));
    if (handlers.length > 0) result.push({ ...group, hooks: handlers });
  }
  return result;
}

function findHandler(groups: JsonObject[], statusMessage: string): JsonObject | undefined {
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) continue;
    const handler = group.hooks.find(
      (candidate) => isObject(candidate) && candidate.statusMessage === statusMessage,
    );
    if (isObject(handler)) return handler;
  }
  return undefined;
}

function commandReferences(handler: JsonObject, scriptPath: string): boolean {
  return [handler.command, handler.commandWindows].some(
    (command) => typeof command === 'string' && command.includes(scriptPath),
  );
}

async function readSettings(configPath: string): Promise<JsonObject | undefined> {
  let raw: string;
  try {
    raw = await fsp.readFile(configPath, 'utf-8');
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') return undefined;
    throw new Error(`Read Codex hooks config: ${error instanceof Error ? error.message : String(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse Codex hooks config: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(value)) throw new Error('Codex hooks config must contain a JSON object');
  return value;
}

async function writeSettings(configPath: string, settings: JsonObject): Promise<void> {
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tempPath, JSON.stringify(settings, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await fsp.rename(tempPath, configPath);
  } catch (error) {
    await fsp.unlink(tempPath).catch(() => undefined);
    throw new Error(`Write Codex hooks config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getHooks(settings: JsonObject): JsonObject {
  if (settings.hooks === undefined) return {};
  if (!isObject(settings.hooks)) throw new Error('Codex hooks config field "hooks" must be an object');
  return { ...settings.hooks };
}

async function runtimeScriptsExist(guard: JsonObject, audit: JsonObject): Promise<boolean> {
  const root = path.join(os.homedir(), '.elydora');
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const directory of entries) {
    if (!directory.isDirectory()) continue;
    const agentDir = path.join(root, directory.name);
    try {
      const config = JSON.parse(await fsp.readFile(path.join(agentDir, 'config.json'), 'utf-8'));
      if (config.agent_name !== AGENT_KEY) continue;
      const guardPath = path.join(agentDir, 'guard.js');
      const hookPath = path.join(agentDir, 'hook.js');
      if (!commandReferences(guard, guardPath) || !commandReferences(audit, hookPath)) continue;
      await Promise.all([fsp.access(guardPath), fsp.access(hookPath)]);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export const codexPlugin: AgentPlugin = {
  async install(config: InstallConfig): Promise<void> {
    const configPath = resolveConfigPath();
    const settings = (await readSettings(configPath)) ?? {};
    const hooks = getHooks(settings);

    hooks.PreToolUse = [
      ...withoutElydora(eventGroups(hooks, 'PreToolUse')),
      { matcher: '*', hooks: [buildHandler(config.guardScriptPath, GUARD_STATUS)] },
    ];
    hooks.PostToolUse = [
      ...withoutElydora(eventGroups(hooks, 'PostToolUse')),
      { matcher: '*', hooks: [buildHandler(config.hookScriptPath, AUDIT_STATUS)] },
    ];

    await writeSettings(configPath, { ...settings, hooks });
    console.log('  Codex: run /hooks to review and trust the Elydora hooks.');
  },

  async uninstall(agentId?: string): Promise<void> {
    const configPath = resolveConfigPath();
    const settings = await readSettings(configPath);
    if (!settings) return;
    const hooks = getHooks(settings);
    hooks.PreToolUse = withoutElydora(eventGroups(hooks, 'PreToolUse'), agentId);
    hooks.PostToolUse = withoutElydora(eventGroups(hooks, 'PostToolUse'), agentId);
    await writeSettings(configPath, { ...settings, hooks });
  },

  async status(): Promise<PluginStatus> {
    const configPath = resolveConfigPath();
    const settings = await readSettings(configPath);
    let guard: JsonObject | undefined;
    let audit: JsonObject | undefined;
    if (settings) {
      const hooks = getHooks(settings);
      guard = findHandler(eventGroups(hooks, 'PreToolUse'), GUARD_STATUS);
      audit = findHandler(eventGroups(hooks, 'PostToolUse'), AUDIT_STATUS);
    }
    const hookConfigured = Boolean(guard && audit);
    const hookScriptExists = guard && audit ? await runtimeScriptsExist(guard, audit) : false;
    return {
      installed: hookConfigured && hookScriptExists,
      agentName: AGENT_KEY,
      displayName: entry.name,
      hookConfigured,
      hookScriptExists,
      configPath,
    };
  },
};
