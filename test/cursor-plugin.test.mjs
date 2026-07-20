import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pluginModuleUrl = pathToFileURL(path.resolve('dist/plugins/cursor.js')).href;
const registryModuleUrl = pathToFileURL(path.resolve('dist/plugins/registry.js')).href;
const ioModuleUrl = pathToFileURL(path.resolve('dist/plugins/cursor-io.js')).href;

function runNode(args, env, cwd, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function runHook(handler, input, environment = {}) {
  const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', handler.command]
    : ['-c', handler.command];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

async function runPlugin(fixture, method, argument) {
  const source = `
    import { cursorPlugin } from ${JSON.stringify(pluginModuleUrl)};
    const argument = JSON.parse(process.env.ELYDORA_TEST_ARGUMENT);
    const result = await cursorPlugin[process.env.ELYDORA_TEST_METHOD](argument);
    if (result !== undefined) console.log(JSON.stringify(result));
  `;
  return runNode(
    ['--input-type=module', '--eval', source],
    {
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      ELYDORA_TEST_ARGUMENT: JSON.stringify(argument),
      ELYDORA_TEST_METHOD: method,
    },
    fixture.projectDir,
  );
}

async function createFixture({ existingConfig, createRuntimes = true, hookSource } = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'elydora-cursor-'));
  const homeDir = path.join(rootDir, "home with spaces and 'quote");
  const projectDir = path.join(rootDir, 'project with spaces');
  const configPath = path.join(homeDir, '.cursor', 'hooks.json');
  const agentDir = path.join(homeDir, '.elydora', 'agent-1');
  const guardScriptPath = path.join(agentDir, 'guard.js');
  const hookScriptPath = path.join(agentDir, 'hook.js');
  await mkdir(projectDir, { recursive: true });
  if (createRuntimes) {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      guardScriptPath,
      "process.stdin.resume(); process.stdin.once('end', () => { process.stderr.write('Agent is frozen by Elydora.'); process.exit(2); });\n",
    );
    await writeFile(hookScriptPath, hookSource ?? 'process.stdin.resume();\n');
    await writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      agent_id: 'agent-1',
      agent_name: 'cursor',
    }));
  }
  if (existingConfig !== undefined) await writeJson(configPath, existingConfig);
  return {
    agentDir,
    configPath,
    guardScriptPath,
    homeDir,
    hookScriptPath,
    projectDir,
    rootDir,
    async install() {
      return runPlugin(this, 'install', {
        agentName: 'cursor',
        agentId: 'agent-1',
        guardScriptPath,
        hookScriptPath,
      });
    },
    async close() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

function managedHandler(config, event, scriptName) {
  return config.hooks?.[event]?.find((handler) => handler.command?.includes(scriptName));
}

function assertNativeHandler(handler) {
  assert.deepEqual(Object.keys(handler).sort(), ['command', 'failClosed', 'timeout']);
  assert.equal(handler.failClosed, true);
  assert.equal(handler.timeout, 10);
  assert.match(handler.command, /node(?:\.exe)?/i);
  if (process.platform === 'win32') {
    assert.match(handler.command, /^& /);
    assert.match(handler.command, /; exit \$LASTEXITCODE$/);
  } else {
    assert.match(handler.command, /^'/);
  }
}

function legacyHandler(scriptPath) {
  return { command: `node "${scriptPath}"` };
}

test('Cursor is registered with the native user hook file', async () => {
  const { SUPPORTED_AGENTS } = await import(registryModuleUrl);
  assert.deepEqual(SUPPORTED_AGENTS.get('cursor'), {
    name: 'Cursor',
    configDir: '~/.cursor',
    configFile: 'hooks.json',
  });
});

test('Cursor install preserves user hooks, migrates legacy entries, and is idempotent', async () => {
  const fixture = await createFixture();
  try {
    await writeJson(fixture.configPath, {
      version: 1,
      description: 'user-owned',
      hooks: {
        sessionStart: [{ command: 'user-session' }],
        preToolUse: [
          { command: 'user-pre' },
          legacyHandler(fixture.guardScriptPath),
        ],
        postToolUse: [legacyHandler(fixture.hookScriptPath)],
      },
    });
    assert.equal((await fixture.install()).code, 0);
    const second = await fixture.install();
    assert.equal(second.code, 0, second.stderr);

    const config = JSON.parse(await readFile(fixture.configPath, 'utf-8'));
    assert.equal(config.version, 1);
    assert.equal(config.description, 'user-owned');
    assert.deepEqual(config.hooks.sessionStart, [{ command: 'user-session' }]);
    assert.deepEqual(config.hooks.preToolUse[0], { command: 'user-pre' });
    assert.equal(config.hooks.preToolUse.length, 2);
    assert.equal(config.hooks.postToolUse.length, 1);
    assertNativeHandler(managedHandler(config, 'preToolUse', 'guard.js'));
    assertNativeHandler(managedHandler(config, 'postToolUse', 'hook.js'));
  } finally {
    await fixture.close();
  }
});

test('Cursor hooks block freezes and forward official input byte-for-byte', async () => {
  const capturePath = path.join(os.tmpdir(), `elydora-cursor-event-${process.pid}-${Date.now()}.json`);
  const fixture = await createFixture({
    hookSource: `
      const fs = require('node:fs');
      const chunks = [];
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', () => fs.writeFileSync(process.env.ELYDORA_CAPTURE, Buffer.concat(chunks)));
    `,
  });
  try {
    const install = await fixture.install();
    assert.equal(install.code, 0, install.stderr);
    const config = JSON.parse(await readFile(fixture.configPath, 'utf-8'));
    const guard = managedHandler(config, 'preToolUse', 'guard.js');
    const audit = managedHandler(config, 'postToolUse', 'hook.js');
    const prePayload = `${JSON.stringify({
      conversation_id: 'conversation-1',
      generation_id: 'generation-1',
      hook_event_name: 'preToolUse',
      tool_name: 'Shell',
      tool_input: { command: 'Get-ChildItem', working_directory: fixture.projectDir },
      tool_use_id: 'call-1',
      cwd: fixture.projectDir,
    })}\n`;
    const guardResult = await runHook(guard, prePayload);
    assert.equal(guardResult.code, 2, guardResult.stderr);
    assert.match(guardResult.stderr, /Agent is frozen by Elydora/);

    const postPayload = `${JSON.stringify({
      conversation_id: 'conversation-1',
      generation_id: 'generation-1',
      hook_event_name: 'postToolUse',
      tool_name: 'Shell',
      tool_input: { command: 'Get-ChildItem' },
      tool_output: '{"exitCode":0,"stdout":"ok"}',
      tool_use_id: 'call-1',
      cwd: fixture.projectDir,
      duration: 42,
    })}\n`;
    const auditResult = await runHook(audit, postPayload, { ELYDORA_CAPTURE: capturePath });
    assert.equal(auditResult.code, 0, auditResult.stderr);
    assert.equal(await readFile(capturePath, 'utf-8'), postPayload);
  } finally {
    await fixture.close();
    await rm(capturePath, { force: true });
  }
});

test('Cursor status requires an exact pair, matching identity, and physical runtimes', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await fixture.install()).code, 0);
    let status = await runPlugin(fixture, 'status', null);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).installed, true);

    const config = JSON.parse(await readFile(fixture.configPath, 'utf-8'));
    config.hooks.preToolUse[0].failClosed = false;
    await writeJson(fixture.configPath, config);
    status = await runPlugin(fixture, 'status', null);
    assert.equal(JSON.parse(status.stdout).hookConfigured, false);

    assert.equal((await fixture.install()).code, 0);
    const auditSource = await readFile(fixture.hookScriptPath);
    await rm(fixture.hookScriptPath);
    status = await runPlugin(fixture, 'status', null);
    assert.equal(JSON.parse(status.stdout).installed, false);
    await writeFile(fixture.hookScriptPath, auditSource);

    const runtimeConfigPath = path.join(fixture.agentDir, 'config.json');
    await writeJson(runtimeConfigPath, { agent_id: 'another-agent', agent_name: 'cursor' });
    status = await runPlugin(fixture, 'status', null);
    assert.equal(JSON.parse(status.stdout).installed, false);

    await writeFile(runtimeConfigPath, '{ malformed');
    status = await runPlugin(fixture, 'status', null);
    assert.equal(status.code, 1);
    assert.match(status.stderr, /parse Elydora runtime config/i);
  } finally {
    await fixture.close();
  }
});

test('Cursor uninstall removes exact ownership and preserves user entries', async () => {
  const fixture = await createFixture({
    existingConfig: { version: 1, hooks: { sessionStart: [{ command: 'keep' }] } },
  });
  try {
    assert.equal((await fixture.install()).code, 0);
    const config = JSON.parse(await readFile(fixture.configPath, 'utf-8'));
    const otherGuard = structuredClone(managedHandler(config, 'preToolUse', 'guard.js'));
    const otherAudit = structuredClone(managedHandler(config, 'postToolUse', 'hook.js'));
    otherGuard.command = otherGuard.command.replaceAll('agent-1', 'agent-10');
    otherAudit.command = otherAudit.command.replaceAll('agent-1', 'agent-10');
    config.hooks.preToolUse.push(otherGuard, {
      command: 'echo elydora agent-1 guard.js', timeout: 10, failClosed: true,
    });
    config.hooks.postToolUse.push(otherAudit);
    await writeJson(fixture.configPath, config);

    const result = await runPlugin(fixture, 'uninstall', 'agent-1');
    assert.equal(result.code, 0, result.stderr);
    const remaining = JSON.parse(await readFile(fixture.configPath, 'utf-8'));
    assert.deepEqual(remaining.hooks.sessionStart, [{ command: 'keep' }]);
    assert.equal(remaining.hooks.preToolUse.length, 2);
    assert.equal(remaining.hooks.postToolUse.length, 1);
    assert.match(remaining.hooks.preToolUse[0].command, /agent-10/);
  } finally {
    await fixture.close();
  }
});

test('Cursor rejects malformed, duplicate, and invalid configs before writes', async () => {
  const invalidConfigs = [
    '{ malformed',
    '[]\n',
    '{"hooks":{}}\n',
    '{"version":2,"hooks":{}}\n',
    '{"version":1,"hooks":null}\n',
    '{"version":1,"hooks":{"preToolUse":null}}\n',
    '{"version":1,"hooks":{"preToolUse":[null]}}\n',
    '{"version":1,"version":1,"hooks":{}}\n',
    '{"version":1,"hooks":{},}\n',
  ];
  for (const existingConfig of invalidConfigs) {
    const fixture = await createFixture({ existingConfig });
    try {
      const before = await readFile(fixture.configPath, 'utf-8');
      const result = await fixture.install();
      assert.equal(result.code, 1, `accepted ${existingConfig}`);
      assert.equal(await readFile(fixture.configPath, 'utf-8'), before);
    } finally {
      await fixture.close();
    }
  }
});

test('Cursor rejects missing and symbolic-link files before config writes', async (t) => {
  const missing = await createFixture({ createRuntimes: false });
  try {
    const result = await missing.install();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /runtime is missing/i);
    await assert.rejects(readFile(missing.configPath), { code: 'ENOENT' });
  } finally {
    await missing.close();
  }

  const linkedRuntime = await createFixture();
  try {
    const target = path.join(linkedRuntime.homeDir, 'guard-target.js');
    await writeFile(target, 'process.exit(2);\n');
    await rm(linkedRuntime.guardScriptPath);
    try {
      await symlink(target, linkedRuntime.guardScriptPath);
    } catch (error) {
      if (error?.code === 'EPERM') t.skip(`symbolic links unavailable: ${error.message}`);
      throw error;
    }
    const result = await linkedRuntime.install();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /physical file/i);
    await assert.rejects(readFile(linkedRuntime.configPath), { code: 'ENOENT' });
  } finally {
    await linkedRuntime.close();
  }
});

test('Cursor confines both runtimes to the managed agent directory', async () => {
  for (const field of ['guardScriptPath', 'hookScriptPath']) {
    const fixture = await createFixture();
    try {
      const result = await runPlugin(fixture, 'install', {
        agentName: 'cursor',
        agentId: 'agent-1',
        guardScriptPath: fixture.guardScriptPath,
        hookScriptPath: fixture.hookScriptPath,
        [field]: path.join(fixture.homeDir, `unmanaged-${field}.js`),
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /managed agent directory/i);
      await assert.rejects(readFile(fixture.configPath), { code: 'ENOENT' });
    } finally {
      await fixture.close();
    }
  }
});

test('Cursor rejects symbolic-link config and preserves its target', async (t) => {
  const fixture = await createFixture();
  try {
    const target = path.join(fixture.homeDir, 'cursor-hooks-target.json');
    const original = '{"version":1,"hooks":{}}\n';
    await writeFile(target, original);
    await mkdir(path.dirname(fixture.configPath), { recursive: true });
    try {
      await symlink(target, fixture.configPath);
    } catch (error) {
      if (error?.code === 'EPERM') t.skip(`symbolic links unavailable: ${error.message}`);
      throw error;
    }
    const result = await fixture.install();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /physical file/i);
    assert.equal(await readFile(target, 'utf-8'), original);
    assert.equal((await lstat(fixture.configPath)).isSymbolicLink(), true);
  } finally {
    await fixture.close();
  }
});

test('Cursor status rejects symbolic-link runtime files', async (t) => {
  for (const name of ['config', 'guard', 'audit']) {
    const fixture = await createFixture();
    try {
      assert.equal((await fixture.install()).code, 0);
      const filePath = {
        config: path.join(fixture.agentDir, 'config.json'),
        guard: fixture.guardScriptPath,
        audit: fixture.hookScriptPath,
      }[name];
      const contents = await readFile(filePath);
      const target = path.join(fixture.homeDir, `${name}-runtime-target`);
      await writeFile(target, contents);
      await rm(filePath);
      try {
        await symlink(target, filePath);
      } catch (error) {
        if (error?.code === 'EPERM') t.skip(`symbolic links unavailable: ${error.message}`);
        throw error;
      }
      const status = await runPlugin(fixture, 'status', null);
      assert.equal(status.code, 1);
      assert.match(status.stderr, /physical file/i);
    } finally {
      await fixture.close();
    }
  }
});

test('Cursor removes an entirely managed config and leaves absent config absent', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await fixture.install()).code, 0);
    assert.equal((await runPlugin(fixture, 'uninstall', 'agent-1')).code, 0);
    await assert.rejects(readFile(fixture.configPath), { code: 'ENOENT' });

    assert.equal((await runPlugin(fixture, 'uninstall', 'agent-1')).code, 0);
    await assert.rejects(readFile(fixture.configPath), { code: 'ENOENT' });
  } finally {
    await fixture.close();
  }
});

test('Cursor atomic writes are private and leave no staging files', async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await fixture.install()).code, 0);
    const files = await readdir(path.dirname(fixture.configPath));
    assert.equal(files.some((name) => name.endsWith('.tmp') || name.endsWith('.rollback')), false);
    if (process.platform !== 'win32') {
      assert.equal((await stat(fixture.configPath)).mode & 0o777, 0o600);
    }
  } finally {
    await fixture.close();
  }
});

test('Cursor atomic write detects a concurrent source change', async () => {
  const fixture = await createFixture({
    existingConfig: { version: 1, hooks: { sessionStart: [{ command: 'original' }] } },
  });
  const concurrent = '{"version":1,"hooks":{"sessionStart":[{"command":"concurrent"}]}}\n';
  try {
    const source = `
      import { writeFile } from 'node:fs/promises';
      import { readDocument, writeDocument } from ${JSON.stringify(ioModuleUrl)};
      const document = await readDocument();
      await writeFile(document.filePath, process.env.ELYDORA_CONCURRENT, 'utf-8');
      await writeDocument({
        document,
        changed: true,
        next: '{"version":1,"hooks":{}}\\n',
      });
    `;
    const result = await runNode(
      ['--input-type=module', '--eval', source],
      { HOME: fixture.homeDir, USERPROFILE: fixture.homeDir, ELYDORA_CONCURRENT: concurrent },
      fixture.projectDir,
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /changed during update/i);
    assert.equal(await readFile(fixture.configPath, 'utf-8'), concurrent);
    const files = await readdir(path.dirname(fixture.configPath));
    assert.equal(files.some((name) => name.endsWith('.tmp')), false);
  } finally {
    await fixture.close();
  }
});
