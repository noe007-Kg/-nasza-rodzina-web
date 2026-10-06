import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const hash = data => createHash('sha256').update(data).digest('hex');

function importSpecifiers(source) {
  // The shared server uses static ESM imports. Reject non-literal dynamic imports
  // instead of silently shipping a dependency outside the Functions archive.
  if ([...source.matchAll(/\bimport\s*\(\s*([^\s])/g)].some(match => !['\'', '"'].includes(match[1]))) throw new Error('Non-literal dynamic import is not supported in the Functions package.');
  return [...source.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)]
    .map(match => match[1] || match[2]);
}

async function regularSource(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Functions source must be a regular file: ${path.basename(file)}`);
  const content = await readFile(file);
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(content.toString('utf8'))) throw new Error(`Private key material is forbidden in Functions source: ${path.basename(file)}`);
  return content;
}

async function sharedSources(projectRoot) {
  const directory = path.join(projectRoot, 'server');
  const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.name.endsWith('.mjs')).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!entries.length) throw new Error('No canonical server modules were found.');
  const sources = new Map();
  for (const entry of entries) sources.set(`server/${entry.name}`, await regularSource(path.join(directory, entry.name)));
  return sources;
}

async function validateClosure(functionsRoot, sources, dependencies) {
  const packaged = new Map(sources);
  for (const entry of await readdir(functionsRoot, { withFileTypes: true })) {
    if (entry.name.endsWith('.mjs')) packaged.set(entry.name, await regularSource(path.join(functionsRoot, entry.name)));
  }
  if (!packaged.has('index.mjs')) throw new Error('Functions index.mjs is missing.');
  for (const [file, content] of packaged) {
    for (const specifier of importSpecifiers(content.toString('utf8'))) {
      if (specifier.startsWith('node:') && builtins.has(specifier.slice(5))) continue;
      if (builtins.has(specifier)) continue;
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (target.startsWith('../') || !packaged.has(target)) throw new Error(`Unpackaged Functions import in ${file}: ${specifier}`);
        continue;
      }
      const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (!dependencies[dependency] || specifier.startsWith('/') || specifier.includes(':')) throw new Error(`Undeclared Functions dependency in ${file}: ${specifier}`);
    }
  }
}

export async function prepareFunctions({ projectRoot = defaultProjectRoot, checkOnly = false } = {}) {
  const functionsRoot = path.join(projectRoot, 'functions');
  const packageJson = JSON.parse((await regularSource(path.join(functionsRoot, 'package.json'))).toString('utf8'));
  const sources = await sharedSources(projectRoot);
  await validateClosure(functionsRoot, sources, packageJson.dependencies || {});
  const manifest = `${JSON.stringify({ source: '../../server', files: Object.fromEntries([...sources].map(([file, content]) => [file.slice('server/'.length), hash(content)])) }, null, 2)}\n`;
  const destination = path.join(functionsRoot, 'server');
  if (checkOnly) {
    const files = (await readdir(destination)).sort();
    const expected = [...sources.keys()].map(file => file.slice('server/'.length)).concat('_source-manifest.json').sort();
    if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Generated Functions server files are missing or stale. Run the Functions build.');
    for (const [file, content] of sources) {
      if (!(await regularSource(path.join(functionsRoot, file))).equals(content)) throw new Error(`Generated Functions module differs from canonical source: ${file}`);
    }
    if ((await regularSource(path.join(destination, '_source-manifest.json'))).toString('utf8') !== manifest) throw new Error('Generated Functions source manifest is stale.');
    return sources.size;
  }
  // Rebuild a clean staging directory, so a stale file or a manually added
  // credential can never remain in the uploaded generated server tree.
  const staging = path.join(functionsRoot, '.server-staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const [file, content] of sources) await writeFile(path.join(staging, file.slice('server/'.length)), content);
    await writeFile(path.join(staging, '_source-manifest.json'), manifest);
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return sources.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Usage: node scripts/prepare-functions.mjs [--check]');
    const checkOnly = process.argv.includes('--check');
    const count = await prepareFunctions({ checkOnly });
    console.log(`Functions ${checkOnly ? 'source check' : 'build'}: ${count} canonical server modules ${checkOnly ? 'verified' : 'staged'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
