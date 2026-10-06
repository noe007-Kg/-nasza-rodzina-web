import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareFunctions } from '../scripts/prepare-functions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'nasza functions with spaces '));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, 'server'));
  await mkdir(path.join(projectRoot, 'functions'));
  await writeFile(path.join(projectRoot, 'functions', 'package.json'), JSON.stringify({ type: 'module', dependencies: { 'firebase-admin': '^13.5.0' } }));
  await writeFile(path.join(projectRoot, 'functions', 'index.mjs'), "export { value } from './server/edu-service.mjs';\n");
  await writeFile(path.join(projectRoot, 'server', 'edu-service.mjs'), "import { createHash } from 'node:crypto';\nimport './edu-storage.mjs';\nexport const value = createHash('sha256').update('safe fixture').digest('hex');\n");
  await writeFile(path.join(projectRoot, 'server', 'edu-storage.mjs'), "export const serverOnly = true;\n");
  return projectRoot;
}

test('Functions staging is deterministic, byte-identical, clean and does not package unrelated credentials', async t => {
  const projectRoot = await fixture(t);
  await writeFile(path.join(projectRoot, 'server', '.env'), 'SYNTHETIC_SECRET=must-not-be-packaged');
  await writeFile(path.join(projectRoot, 'server', 'service-account.json'), '{"private_key":"synthetic"}');
  await mkdir(path.join(projectRoot, 'functions', 'server'));
  await writeFile(path.join(projectRoot, 'functions', 'server', 'stale.mjs'), 'export const stale = true;');
  await writeFile(path.join(projectRoot, 'functions', 'server', '.env'), 'SYNTHETIC_SECRET=stale');
  assert.equal(await prepareFunctions({ projectRoot }), 2);
  const destination = path.join(projectRoot, 'functions', 'server');
  assert.deepEqual((await readdir(destination)).sort(), ['_source-manifest.json', 'edu-service.mjs', 'edu-storage.mjs']);
  for (const file of ['edu-service.mjs', 'edu-storage.mjs']) assert.deepEqual(await readFile(path.join(destination, file)), await readFile(path.join(projectRoot, 'server', file)));
  const manifest = await readFile(path.join(destination, '_source-manifest.json'));
  assert.equal(await prepareFunctions({ projectRoot }), 2);
  assert.deepEqual(await readFile(path.join(destination, '_source-manifest.json')), manifest);
  assert.equal(await prepareFunctions({ projectRoot, checkOnly: true }), 2);
});

test('Functions check rejects stale or tampered generated source and build restores canonical content', async t => {
  const projectRoot = await fixture(t);
  await prepareFunctions({ projectRoot });
  await writeFile(path.join(projectRoot, 'functions', 'server', 'edu-service.mjs'), 'export const tampered = true;');
  await assert.rejects(prepareFunctions({ projectRoot, checkOnly: true }), /differs from canonical/);
  await prepareFunctions({ projectRoot });
  await writeFile(path.join(projectRoot, 'functions', 'server', 'extra.json'), '{}');
  await assert.rejects(prepareFunctions({ projectRoot, checkOnly: true }), /missing or stale/);
});

test('Functions package rejects relative imports escaping uploaded source and missing files', async t => {
  const projectRoot = await fixture(t);
  await writeFile(path.join(projectRoot, 'functions', 'index.mjs'), "import '../server/edu-service.mjs';\n");
  await assert.rejects(prepareFunctions({ projectRoot }), /Unpackaged Functions import/);
  await writeFile(path.join(projectRoot, 'functions', 'index.mjs'), "export * from './server/not-present.mjs';\n");
  await assert.rejects(prepareFunctions({ projectRoot }), /Unpackaged Functions import/);
});

test('Functions package validates bare dependencies and literal dynamic import closure', async t => {
  const projectRoot = await fixture(t);
  const source = path.join(projectRoot, 'server', 'edu-service.mjs');
  await writeFile(source, "import { FieldValue } from 'firebase-admin/firestore';\nexport const loaded = import( './edu-storage.mjs' );\n");
  assert.equal(await prepareFunctions({ projectRoot }), 2);
  await writeFile(source, "import 'undeclared-library';\n");
  await assert.rejects(prepareFunctions({ projectRoot }), /Undeclared Functions dependency/);
  await writeFile(source, "export const loaded = import(variable);\n");
  await assert.rejects(prepareFunctions({ projectRoot }), /Non-literal dynamic import/);
});

test('Functions package rejects symlinked modules and private key material', async t => {
  const projectRoot = await fixture(t);
  await symlink(path.join(projectRoot, 'server', 'edu-storage.mjs'), path.join(projectRoot, 'server', 'external.mjs'));
  await assert.rejects(prepareFunctions({ projectRoot }), /regular file/);
  await rm(path.join(projectRoot, 'server', 'external.mjs'));
  await writeFile(path.join(projectRoot, 'server', 'external.mjs'), "const key = '-----BEGIN PRIVATE KEY-----';\n");
  await assert.rejects(prepareFunctions({ projectRoot }), /Private key material/);
});

test('prepare CLI resolves project from its own path when cwd contains spaces', async t => {
  const projectRoot = await fixture(t);
  await mkdir(path.join(projectRoot, 'scripts'));
  await writeFile(path.join(projectRoot, 'scripts', 'prepare-functions.mjs'), await readFile(path.join(root, 'scripts', 'prepare-functions.mjs')));
  const entry = path.join(projectRoot, 'scripts', 'prepare-functions.mjs');
  const originalArguments = process.argv, originalDirectory = process.cwd(), originalLog = console.log;
  const output = [];
  try {
    // Execute the real CLI entry with its arguments in a different cwd. This
    // verifies path portability without requiring child-process privileges.
    process.argv = [process.execPath, entry]; process.chdir(os.tmpdir());
    console.log = message => output.push(String(message));
    await import(pathToFileURL(entry).href);
  } finally {
    process.argv = originalArguments; process.chdir(originalDirectory); console.log = originalLog;
  }
  assert.match(output.join('\n'), /2 canonical server modules staged/);
  assert.equal(await prepareFunctions({ projectRoot, checkOnly: true }), 2);
});

test('Firebase Functions codebase uses staged Node 22 source without removing rules, hosting or emulators', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'firebase.json'), 'utf8'));
  assert.equal(config.functions.length, 1);
  const functions = config.functions[0];
  assert.equal(functions.source, 'functions');
  assert.equal(functions.codebase, 'nasza-rodzina');
  assert.equal(functions.runtime, 'nodejs22');
  assert.deepEqual(functions.predeploy, ['node "$PROJECT_DIR/scripts/prepare-functions.mjs"']);
  assert.ok(!functions.ignore.includes('server'));
  for (const excluded of ['node_modules', '**/.env*', '**/*.key', '**/*.pem', '**/*service-account*.json']) assert.ok(functions.ignore.includes(excluded));
  assert.deepEqual(config.firestore, { rules: 'firestore.rules', indexes: 'firestore.indexes.json' });
  assert.deepEqual(config.storage, { rules: 'storage.rules' });
  assert.equal(config.hosting.public, 'dist');
  assert.deepEqual(config.hosting.rewrites, [{ source: '**', destination: '/index.html' }]);
  assert.deepEqual(config.emulators.auth, { host: '127.0.0.1', port: 9099 });
  assert.deepEqual(config.emulators.firestore, { host: '127.0.0.1', port: 8080 });
  assert.deepEqual(config.emulators.storage, { host: '127.0.0.1', port: 9199 });
  assert.equal(config.emulators.singleProjectMode, true);
});

test('current Functions package includes all canonical server modules and verifies shared dependency closure', async () => {
  const count = await prepareFunctions({ projectRoot: root, checkOnly: true });
  assert.ok(count >= 15);
  assert.equal(await prepareFunctions({ projectRoot: root, checkOnly: true }), count);
  const packageJson = JSON.parse(await readFile(path.join(root, 'functions', 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'functions', 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies);
  assert.equal(packageJson.engines.node, '22');
});
