import { parseArgs } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { derivePublicKey } from './crypto.js';
import { SUPPORTED_AGENTS } from './plugins/registry.js';
import type { AgentPlugin, InstallConfig } from './plugins/base.js';
import { generateHookScript, generateGuardScript } from './plugins/hook-template.js';
import { claudecodePlugin } from './plugins/claudecode.js';
import { cursorPlugin } from './plugins/cursor.js';
import { geminiPlugin } from './plugins/gemini.js';
import { augmentPlugin } from './plugins/augment.js';
import { kiroPlugin } from './plugins/kiro.js';
import { opencodePlugin } from './plugins/opencode.js';

const ELYDORA_DIR = path.join(os.homedir(), '.elydora');

const PLUGINS: ReadonlyMap<string, AgentPlugin> = new Map([
  ['claudecode', claudecodePlugin],
  ['cursor', cursorPlugin],
  ['gemini', geminiPlugin],
  ['augment', augmentPlugin],
  ['kiro', kiroPlugin],
  ['opencode', opencodePlugin],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function printUsage(): void {
  console.log(`Elydora CLI — Tamper-evident audit for AI coding agents

Usage:
  elydora install   --agent <name> --org_id <id> --agent_id <id> --private_key <key> --kid <kid> [--token <jwt>] [--base_url <url>]
  elydora uninstall --agent <name>
  elydora status
  elydora agents

Commands:
  install     Install Elydora audit hook for a coding agent
  uninstall   Remove Elydora audit hook for a coding agent
  status      Show installation status for all agents
  agents      List supported coding agents

Supported agents: ${Array.from(SUPPORTED_AGENTS.keys()).join(', ')}
`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInstall(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      agent: { type: 'string' },
      org_id: { type: 'string' },
      agent_id: { type: 'string' },
      private_key: { type: 'string' },
      kid: { type: 'string' },
      token: { type: 'string' },
      base_url: { type: 'string' },
    },
    strict: true,
  });

  const agentName = values.agent;
  if (!agentName) die('--agent is required');
  if (!SUPPORTED_AGENTS.has(agentName)) {
    die(`Unknown agent "${agentName}". Supported: ${Array.from(SUPPORTED_AGENTS.keys()).join(', ')}`);
  }

  const orgId = values.org_id;
  if (!orgId) die('--org_id is required');

  const agentId = values.agent_id;
  if (!agentId) die('--agent_id is required');

  const privateKey = values.private_key;
  if (!privateKey) die('--private_key is required');

  const kid = values.kid;
  if (!kid) die('--kid is required');

  const token = values.token;
  const baseUrl = values.base_url ?? 'https://api.elydora.com';

  // Validate private key by deriving public key
  let publicKey: string;
  try {
    publicKey = derivePublicKey(privateKey);
  } catch {
    die('Invalid private key — could not derive public key');
  }

  console.log(`Verifying private key... Public key: ${publicKey.slice(0, 12)}...`);

  // Create ~/.elydora directory structure
  const agentsDir = path.join(ELYDORA_DIR, 'agents');
  const hooksDir = path.join(ELYDORA_DIR, 'hooks');
  await fsp.mkdir(agentsDir, { recursive: true });
  await fsp.mkdir(hooksDir, { recursive: true });

  // Write agent config
  const agentConfigPath = path.join(agentsDir, `${agentName}.json`);
  const agentConfig = {
    org_id: orgId,
    agent_id: agentId,
    kid,
    base_url: baseUrl,
    ...(token ? { token } : {}),
  };
  await fsp.writeFile(agentConfigPath, JSON.stringify(agentConfig, null, 2) + '\n', 'utf-8');
  console.log(`  Agent config: ${agentConfigPath}`);

  // Write private key (chmod 600)
  const keyPath = path.join(agentsDir, `${agentName}.key`);
  await fsp.writeFile(keyPath, privateKey, { encoding: 'utf-8', mode: 0o600 });
  console.log(`  Private key:  ${keyPath}`);

  // Generate and write hook script (PostToolUse — audit logging)
  const hookScriptPath = path.join(hooksDir, `${agentName}-hook.js`);
  const hookScript = generateHookScript(agentName);
  await fsp.writeFile(hookScriptPath, hookScript, { encoding: 'utf-8', mode: 0o755 });
  console.log(`  Hook script:  ${hookScriptPath}`);

  // Generate and write guard script (PreToolUse — freeze enforcement)
  const guardScriptPath = path.join(hooksDir, `${agentName}-guard.js`);
  const guardScript = generateGuardScript(agentName);
  await fsp.writeFile(guardScriptPath, guardScript, { encoding: 'utf-8', mode: 0o755 });
  console.log(`  Guard script: ${guardScriptPath}`);

  // Install agent-specific config hook
  const plugin = PLUGINS.get(agentName)!;
  const installConfig: InstallConfig = {
    agentName,
    orgId,
    agentId,
    privateKey,
    kid,
    token,
    baseUrl,
    hookScriptPath,
    guardScriptPath,
  };

  await plugin.install(installConfig);

  const entry = SUPPORTED_AGENTS.get(agentName)!;
  console.log(`\nElydora audit hook installed for ${entry.name}.`);
}

async function cmdUninstall(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      agent: { type: 'string' },
    },
    strict: true,
  });

  const agentName = values.agent;
  if (!agentName) die('--agent is required');
  if (!SUPPORTED_AGENTS.has(agentName)) {
    die(`Unknown agent "${agentName}". Supported: ${Array.from(SUPPORTED_AGENTS.keys()).join(', ')}`);
  }

  const plugin = PLUGINS.get(agentName)!;
  const entry = SUPPORTED_AGENTS.get(agentName)!;

  // Uninstall agent-specific config
  await plugin.uninstall();

  // Remove hook and guard scripts
  const hookScriptPath = path.join(ELYDORA_DIR, 'hooks', `${agentName}-hook.js`);
  const guardScriptPath = path.join(ELYDORA_DIR, 'hooks', `${agentName}-guard.js`);
  try { await fsp.unlink(hookScriptPath); } catch { /* Already removed */ }
  try { await fsp.unlink(guardScriptPath); } catch { /* Already removed */ }

  // Remove agent config and key
  const agentConfigPath = path.join(ELYDORA_DIR, 'agents', `${agentName}.json`);
  const keyPath = path.join(ELYDORA_DIR, 'agents', `${agentName}.key`);
  try { await fsp.unlink(agentConfigPath); } catch { /* */ }
  try { await fsp.unlink(keyPath); } catch { /* */ }

  console.log(`Elydora audit hook uninstalled for ${entry.name}.`);
}

async function cmdStatus(): Promise<void> {
  console.log('Elydora Agent Status\n');

  let anyInstalled = false;

  for (const [name, plugin] of PLUGINS) {
    const st = await plugin.status();
    const statusIcon = st.installed ? '[installed]' : '[not installed]';

    console.log(`  ${st.displayName} (${name}) ${statusIcon}`);
    if (st.installed || st.hookConfigured || st.hookScriptExists) {
      console.log(`    Hook config: ${st.hookConfigured ? 'yes' : 'no'}`);
      console.log(`    Hook script: ${st.hookScriptExists ? 'yes' : 'no'}`);
      console.log(`    Config path: ${st.configPath}`);
    }

    if (st.installed) anyInstalled = true;
  }

  if (!anyInstalled) {
    console.log('\nNo agents installed. Run "elydora install --agent <name>" to get started.');
  }
}

function cmdAgents(): void {
  console.log('Supported Coding Agents:\n');
  for (const [key, entry] of SUPPORTED_AGENTS) {
    console.log(`  ${key.padEnd(12)} ${entry.name}`);
  }
  console.log('\nUse "elydora install --agent <name>" to install an audit hook.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'install':
      await cmdInstall(commandArgs);
      break;
    case 'uninstall':
      await cmdUninstall(commandArgs);
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'agents':
      cmdAgents();
      break;
    default:
      die(`Unknown command "${command}". Run "elydora --help" for usage.`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
