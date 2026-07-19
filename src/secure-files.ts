import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await fsp.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Private directory path is not a physical directory: ${directory}`);
  }
  if (process.platform !== 'win32') {
    await fsp.chmod(directory, 0o700);
  }
}

export function resolvePrivateChildDirectory(root: string, childName: string): string {
  const isWindowsDeviceName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(childName);
  if (
    childName.length === 0
    || /[<>:"|?*\u0000-\u001f]/.test(childName)
    || childName.includes('/')
    || childName.includes('\\')
    || childName === '.'
    || childName === '..'
    || childName.endsWith('.')
    || childName.endsWith(' ')
    || isWindowsDeviceName
  ) {
    throw new Error(`Invalid agent ID for local storage: ${JSON.stringify(childName)}`);
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, childName);
  const relative = path.relative(resolvedRoot, candidate);
  if (
    relative.length === 0
    || path.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || relative.includes(path.sep)
  ) {
    throw new Error(`Agent ID escapes the local storage directory: ${JSON.stringify(childName)}`);
  }
  return candidate;
}

export async function writePrivateFile(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await ensurePrivateDirectory(directory);

  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  let committed = false;
  try {
    const handle = await fsp.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fsp.rename(temporaryPath, filePath);
    committed = true;
    if (process.platform !== 'win32') {
      await fsp.chmod(filePath, 0o600);
    }
  } finally {
    if (!committed) {
      try {
        await fsp.unlink(temporaryPath);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  }
}
