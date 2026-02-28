export interface AgentRegistryEntry {
  readonly name: string;
  readonly configDir: string;
  readonly configFile: string;
}

export const SUPPORTED_AGENTS: ReadonlyMap<string, AgentRegistryEntry> = new Map([
  ['claudecode', { name: 'Claude Code', configDir: '~/.claude', configFile: 'settings.json' }],
  ['cursor', { name: 'Cursor', configDir: '.cursor', configFile: 'hooks.json' }],
  ['gemini', { name: 'Gemini CLI', configDir: '~/.gemini', configFile: 'settings.json' }],
  ['augment', { name: 'Augment Code', configDir: '~/.augment', configFile: 'settings.json' }],
  ['kiro', { name: 'Kiro', configDir: '.kiro/hooks', configFile: 'elydora-audit.kiro.hook' }],
  ['opencode', { name: 'OpenCode', configDir: '.opencode/plugins', configFile: 'elydora-audit.js' }],
]);
