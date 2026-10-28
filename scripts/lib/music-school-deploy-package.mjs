import { readFile, writeFile, mkdir, mkdtemp, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';

export async function prepareMusicDeployPackage(root) {
  const directory = await mkdtemp(join(tmpdir(), 'nr-music-only-release-'));
  const functions = join(directory, 'functions');
  await mkdir(functions);
  const copied = new Set();
  async function copy(source, target) {
    if (copied.has(target)) return;
    const meta = await lstat(source);
    if (!meta.isFile() || meta.isSymbolicLink()) throw new Error('NON_REGULAR_DEPLOY_SOURCE');
    const content = await readFile(source, 'utf8');
    if (/defineSecret|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(content)) throw new Error('UNEXPECTED_SECRET_DECLARATION');
    copied.add(target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    for (const match of content.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
      const specifier = match[1] || match[2];
      if (!specifier.startsWith('.')) continue;
      const destination = resolve(dirname(target), specifier), local = relative(functions, destination).replaceAll('\\', '/');
      if (local.startsWith('..') || isAbsolute(local) || !local.startsWith('server/') || !local.endsWith('.mjs')) throw new Error('DEPLOY_IMPORT_OUTSIDE_MUSIC_CLOSURE');
      await copy(join(root, local), destination);
    }
  }
  await copy(join(root, 'functions/music-school-only.mjs'), join(functions, 'index.mjs'));
  const manifest = JSON.parse(await readFile(join(root, 'functions/package.json'), 'utf8'));
  delete manifest.scripts; // Staged source is ready to execute; no repo-relative build scripts.
  await writeFile(join(functions, 'package.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(functions, 'package-lock.json'), await readFile(join(root, 'functions/package-lock.json')));
  // Used for local discovery only; excluded from the uploaded archive.
  await symlink(resolve(root, 'functions/node_modules'), join(functions, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(functions, '.env.nasza-rodzina'), 'MUSIC_SCHOOL_ENABLED=true\n', { mode: 0o600 });
  const config = { functions: [{ source: 'functions', codebase: 'nasza-rodzina', runtime: 'nodejs22', ignore: ['node_modules', '.git', '**/.env*', '**/*private*.json', '**/*.pem', '**/*.key'] }] };
  const configFile = join(directory, 'firebase.json');
  await writeFile(configFile, JSON.stringify(config, null, 2));
  return { directory, configFile, modules: copied.size };
}
