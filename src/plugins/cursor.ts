import os from 'node:os';
import path from 'node:path';
import { resolvePrivateChildDirectory } from '../runtime-paths.js';
import type { AgentPlugin, InstallConfig, PluginStatus } from './base.js';
import {
  AGENT_KEY,
  AUDIT_SCRIPT,
  GUARD_SCRIPT,
  buildHandler,
  removeManagedHooks,
  renderDocument,
  runtimeContracts,
  samePath,
} from './cursor-contract.js';
import {
  readDocument,
  requireRuntime,
  runtimeFilesExist,
  writeDocument,
} from './cursor-io.js';
import { SUPPORTED_AGENTS } from './registry.js';

const entry = SUPPORTED_AGENTS.get(AGENT_KEY)!;

export const cursorPlugin: AgentPlugin = {
  async install(config: InstallConfig): Promise<void> {
    if (!config.agentId) throw new Error('agentId is required');
    const document = await readDocument();
    const runtimeRoot = path.join(os.homedir(), '.elydora');
    const agentDirectory = resolvePrivateChildDirectory(runtimeRoot, config.agentId);
    const expectedGuard = path.join(agentDirectory, GUARD_SCRIPT);
    const expectedAudit = path.join(agentDirectory, AUDIT_SCRIPT);
    if (!samePath(config.guardScriptPath, expectedGuard)) {
      throw new Error(`Elydora guard runtime must use the managed agent directory: ${expectedGuard}`);
    }
    if (!samePath(config.hookScriptPath, expectedAudit)) {
      throw new Error(`Elydora audit runtime must use the managed agent directory: ${expectedAudit}`);
    }
    await requireRuntime(expectedGuard, 'Elydora guard runtime');
    await requireRuntime(expectedAudit, 'Elydora audit runtime');

    const hooks = removeManagedHooks(document.hooks);
    hooks.preToolUse = [...(hooks.preToolUse ?? []), buildHandler(expectedGuard)];
    hooks.postToolUse = [...(hooks.postToolUse ?? []), buildHandler(expectedAudit)];
    await writeDocument(renderDocument(document, hooks));
    console.log(`  Cursor hooks: ${document.filePath}`);
  },

  async uninstall(agentId?: string): Promise<void> {
    const document = await readDocument();
    const hooks = removeManagedHooks(document.hooks, agentId);
    await writeDocument(renderDocument(document, hooks));
  },

  async status(): Promise<PluginStatus> {
    const document = await readDocument();
    const contracts = runtimeContracts(document.hooks);
    const hookConfigured = contracts.length > 0;
    const hookScriptExists = hookConfigured && await runtimeFilesExist(contracts);
    return {
      installed: hookConfigured && hookScriptExists,
      agentName: AGENT_KEY,
      displayName: entry.name,
      hookConfigured,
      hookScriptExists,
      configPath: document.filePath,
    };
  },
};
