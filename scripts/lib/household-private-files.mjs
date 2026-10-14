import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export function controlFailure(code) { throw Object.assign(new Error(code), { code }); }
export async function readPrivateBytes(file, maximum = 256 * 1024 * 1024 + 64) {
  let handle;
  try {
    handle = await open(path.resolve(file), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile() || process.platform !== 'win32' && info.mode & 0o077) controlFailure('PRIVATE_FILE_PERMISSIONS_REQUIRED');
    if (info.size > maximum) controlFailure('PRIVATE_FILE_TOO_LARGE');
    const bytes = await handle.readFile();
    if (bytes.length > maximum) controlFailure('PRIVATE_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle?.close(); }
}
export async function readPrivateJson(file, maximum = 64 * 1024 * 1024) {
  try { return JSON.parse((await readPrivateBytes(file, maximum)).toString('utf8')); }
  catch (error) { if (error?.code) throw error; controlFailure('PRIVATE_JSON_INVALID'); }
}
function outsideRepository(directory) {
  const relative = path.relative(repository, directory);
  return relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
    || relative === 'migration-private' || relative.startsWith('migration-private' + path.sep);
}
export async function securePrivateDirectory(directory) {
  directory = path.resolve(directory);
  if (!outsideRepository(directory)) controlFailure('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.mode & 0o077) controlFailure('PRIVATE_DIRECTORY_PERMISSIONS_REQUIRED');
  const resolved = await realpath(directory);
  if (!outsideRepository(resolved)) controlFailure('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  return resolved;
}
export async function writePrivateFile(file, bytes) {
  await writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
}
export function safeControlError(error, fallback = 'HOUSEHOLD_CONTROL_FAILED') {
  return typeof error?.code === 'string' && /^[A-Z_0-9]{1,100}$/.test(error.code) ? error.code : fallback;
}
