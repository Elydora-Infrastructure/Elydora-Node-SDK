import os from 'node:os';
import path from 'node:path';
import { generateGuardScript } from './guard-template.js';
import { generateHookScript } from './hook-template.js';
import { sameKiroIdeAgentId, sameKiroIdePath } from './kiroide-command.js';
import {
  AGENT_KEY,
  AUDIT_SCRIPT,
  GUARD_SCRIPT,
  createKiroIdeDocument,
  legacyKiroIdeRuntimeContract,
  parseKiroIdeDocument,
  resolveKiroIdePaths,
  type KiroIdeDocument,
  type KiroIdePaths,
  type KiroIdeRuntimeContract,
} from './kiroide-contract.js';
import { inspectPhysicalDirectory, readPhysicalFile } from './managed-files.js';
import { parseStrictJsonObject, type JsonObject } from './strict-json.js';

const MAX_SECRET_BYTES = 64 * 1024;
const MAX_CONFIG_BYTES = 512 * 1024;

export interface LegacyKiroIdeDocument {
  readonly exists: boolean;
  readonly filePath: string;
  readonly raw?: string;
  readonly contract?: KiroIdeRuntimeContract;
}

export interface KiroIdeSources {
  readonly paths: KiroIdePaths;
  readonly document: KiroIdeDocument;
  readonly legacy: LegacyKiroIdeDocument;
}

async function inspectWorkspace(paths: KiroIdePaths): Promise<void> {
  if (!await inspectPhysicalDirectory(paths.workspaceRoot, 'Kiro IDE workspace')) {
    throw new Error(`Kiro IDE workspace is missing: ${paths.workspaceRoot}`);
  }
  await inspectPhysicalDirectory(paths.kiroDirectory, 'Kiro IDE configuration directory');
  await inspectPhysicalDirectory(paths.hooksDirectory, 'Kiro IDE hooks directory');
}

async function readDocument(paths: KiroIdePaths): Promise<KiroIdeDocument> {
  await inspectWorkspace(paths);
  const snapshot = await readPhysicalFile(paths.configPath, 'Kiro IDE hooks');
  return snapshot
    ? parseKiroIdeDocument(paths.configPath, snapshot.contents)
    : createKiroIdeDocument(paths.configPath);
}

async function readLegacyDocument(paths: KiroIdePaths): Promise<LegacyKiroIdeDocument> {
  const snapshot = await readPhysicalFile(paths.legacyConfigPath, 'legacy Kiro IDE hook');
  if (!snapshot) return { exists: false, filePath: paths.legacyConfigPath };
  return {
    exists: true,
    filePath: paths.legacyConfigPath,
    raw: snapshot.contents,
    contract: legacyKiroIdeRuntimeContract(snapshot.contents, paths.legacyConfigPath),
  };
}

export async function readKiroIdeSources(): Promise<KiroIdeSources> {
  const paths = resolveKiroIdePaths();
  const [document, legacy] = await Promise.all([
    readDocument(paths),
    readLegacyDocument(paths),
  ]);
  return { paths, document, legacy };
}

export async function requirePhysicalLegacyDirectory(
  legacy: LegacyKiroIdeDocument,
): Promise<void> {
  if (!legacy.exists) return;
  const hooksDirectory = path.dirname(legacy.filePath);
  const kiroDirectory = path.dirname(hooksDirectory);
  if (!await inspectPhysicalDirectory(kiroDirectory, 'legacy Kiro IDE configuration directory')) {
    throw new Error(`Legacy Kiro IDE configuration directory is missing: ${kiroDirectory}`);
  }
  if (!await inspectPhysicalDirectory(hooksDirectory, 'legacy Kiro IDE hooks directory')) {
    throw new Error(`Legacy Kiro IDE hooks directory is missing: ${hooksDirectory}`);
  }
}

function requireString(value: unknown, field: string, configPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Elydora runtime config ${field} is invalid: ${configPath}`);
  }
  return value;
}

function validateRuntimeConfig(
  config: JsonObject,
  contract: KiroIdeRuntimeContract,
  configPath: string,
): void {
  const supported = new Set(['org_id', 'agent_id', 'kid', 'base_url', 'token', 'agent_name']);
  const extra = Object.keys(config).find((key) => !supported.has(key));
  if (extra) throw new Error(`Elydora runtime config has unsupported field "${extra}": ${configPath}`);
  requireString(config.org_id, 'org_id', configPath);
  requireString(config.kid, 'kid', configPath);
  const agentId = requireString(config.agent_id, 'agent_id', configPath);
  if (!sameKiroIdeAgentId(agentId, contract.agentId) || config.agent_name !== AGENT_KEY) {
    throw new Error(`Elydora runtime identity does not match Kiro IDE hooks: ${configPath}`);
  }
  if (config.token !== undefined) requireString(config.token, 'token', configPath);
  const rawBaseUrl = requireString(config.base_url, 'base_url', configPath);
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch (error) {
    throw new Error(`Elydora runtime config base_url is invalid: ${configPath}`, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)
    || !baseUrl.hostname
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash) {
    throw new Error(`Elydora runtime config base_url is invalid: ${configPath}`);
  }
}

function validatePrivateKey(contents: string, keyPath: string): void {
  const bytes = Buffer.from(contents, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== contents) {
    throw new Error(`Elydora private key is invalid: ${keyPath}`);
  }
}

function validContractPaths(contract: KiroIdeRuntimeContract): boolean {
  const agentDirectory = path.dirname(contract.guardPath);
  return sameKiroIdePath(path.dirname(agentDirectory), path.join(os.homedir(), '.elydora'))
    && sameKiroIdePath(contract.guardPath, path.join(agentDirectory, GUARD_SCRIPT))
    && sameKiroIdePath(contract.auditPath, path.join(agentDirectory, AUDIT_SCRIPT));
}

export async function runtimeFilesExist(contract: KiroIdeRuntimeContract): Promise<boolean> {
  if (!validContractPaths(contract)) return false;
  const runtimeRoot = path.join(os.homedir(), '.elydora');
  const agentDirectory = path.dirname(contract.guardPath);
  if (!await inspectPhysicalDirectory(runtimeRoot, 'Elydora runtime directory')) return false;
  if (!await inspectPhysicalDirectory(agentDirectory, 'Elydora agent runtime directory')) return false;
  const configPath = path.join(agentDirectory, 'config.json');
  const keyPath = path.join(agentDirectory, 'private.key');
  const [config, key, guard, audit] = await Promise.all([
    readPhysicalFile(configPath, 'Elydora runtime config', MAX_CONFIG_BYTES),
    readPhysicalFile(keyPath, 'Elydora private key', MAX_SECRET_BYTES),
    readPhysicalFile(contract.guardPath, 'Elydora guard runtime'),
    readPhysicalFile(contract.auditPath, 'Elydora audit runtime'),
  ]);
  if (!config || !key || !guard || !audit) return false;
  validateRuntimeConfig(
    parseStrictJsonObject(config.contents, `Elydora runtime config at ${configPath}`),
    contract,
    configPath,
  );
  validatePrivateKey(key.contents, keyPath);
  return guard.contents === generateGuardScript(AGENT_KEY, contract.agentId)
    && audit.contents === generateHookScript(AGENT_KEY, contract.agentId, { nativePayload: true });
}
