import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL('../scripts/run-tasks-preflight.sh', import.meta.url));
const logLine = 'printf "%s\\n" "$0 $*" >> "$NR_TEST_COMMAND_LOG"\n';

async function runMocked(t, overrides = {}, setupMustStop = true) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tasks-launcher-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'), log = path.join(directory, 'commands.log');
  await mkdir(bin); await writeFile(log, '');
  const tools = {
    node: logLine + 'case "$1" in -p|--version|-v) printf "%s\\n" "$NR_TEST_NODE_VERSION";; *)\n' +
      '[ "$NR_TEST_WORKFLOW" = ok ] || exit 70\n' +
      'output=""; while (( $# )); do if [ "$1" = --output ]; then output="$2"; break; fi; shift; done\n' +
      'if [ "$NR_TEST_CORE_REPORT" = yes ] && [ -n "$output" ]; then mkdir -p "$output"; printf \'{"readyForDeployment":false,"productionWritesPerformed":0}\\n\' > "$output/tasks-release-summary.json"; fi\n' +
      'printf "SYNTHETIC_DIAGNOSTIC_BLOCKED — GOTOWE DO WDROZENIA: NIE\\n"\nexit "$NR_TEST_CORE_EXIT";; esac\n',
    java: logLine + 'printf "openjdk version \\"%s\\" 2026-10-18\\n" "$NR_TEST_JAVA_VERSION" >&2\n',
    df: logLine + 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nsynthetic 99999999 1 %s 1%% /tmp\\n" "$NR_TEST_DISK_KB"\n',
    gcloud: logLine + 'case "$*" in *"projects describe"*) printf "%s\\n" "$NR_TEST_PROJECT";; *"application-default print-access-token"*) if [ "$NR_TEST_ADC" = ok ]; then printf "SYNTHETIC_PRIVATE_TOKEN_MUST_NOT_BE_VISIBLE\\n"; else exit 1; fi;; *) exit 70;; esac\n',
    // Guard tests must stop before fetching/installing anything. Success-path
    // mocks only create empty local fixtures; no tool can contact a real service.
    git: logLine + '[ "$NR_TEST_WORKFLOW" = ok ] || exit 70\n' +
      'if [ "$1" = init ]; then mkdir -p "${@: -1}"; exit 0; fi\n' +
      'if [ "$1" = -C ]; then shift 2; fi\n' +
      'case "$1" in rev-parse) printf "%s\\n" "$NR_TEST_ACTUAL_SOURCE";; remote|fetch|checkout|cat-file) exit 0;; *) exit 70;; esac\n',
    npm: logLine + '[ "$NR_TEST_WORKFLOW" = ok ] || exit 70\n', curl: logLine + 'exit 70\n',
  };
  for (const [name, body] of Object.entries(tools)) await writeFile(path.join(bin, name), '#!/bin/bash\n' + body, { mode: 0o700 });
  const env = { PATH: `${bin}:/usr/bin:/bin`, ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    TMPDIR: directory, LANG: 'C', LC_ALL: 'C', NR_TEST_COMMAND_LOG: log,
    NR_TEST_NODE_VERSION: '22.23.3', NR_TEST_JAVA_VERSION: '21.0.4', NR_TEST_DISK_KB: '33554432',
    NR_TEST_PROJECT: 'nasza-rodzina', NR_TEST_ADC: 'ok', NR_TEST_WORKFLOW: 'deny', NR_TEST_CORE_REPORT: 'yes', NR_TEST_CORE_EXIT: '2',
    NR_TEST_ACTUAL_SOURCE: 'f6187f3f6cedd094b3c811c7dfeab00723302d4d', ...overrides };
  let result;
  try { result = { ...(await execute('/bin/bash', [launcher], { env, timeout: 10000, maxBuffer: 128 * 1024 })), code: 0 }; }
  catch (error) { result = { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' }; }
  const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
  const run = calls.find(line => /\/git init --quiet \/tmp\/nr-tasks-check\.[a-zA-Z0-9]+\/repo$/.test(line));
  if (run) {
    const runDirectory = path.dirname(run.split(' ').at(-1));
    t.after(() => rm(runDirectory, { recursive: true, force: true }));
  }
  assert.notEqual(result.code, 0, 'an unmet precondition must stop the launcher');
  assert.ok(!result.stdout.includes('SYNTHETIC_PRIVATE_TOKEN'));
  assert.ok(!result.stderr.includes('SYNTHETIC_PRIVATE_TOKEN'));
  if (setupMustStop) {
    assert.ok(!calls.some(line => /\/npm\s/.test(line)), 'dependencies must not install after a failed precondition');
    assert.ok(!calls.some(line => /\/git\s/.test(line)), 'source must not fetch after a failed precondition');
  }
  assert.ok(!calls.some(line => /\/curl\s/.test(line)), 'the launcher must not make unexpected downloads');
  return { ...result, calls };
}

test('launcher refuses Node 20 before any source fetch or install', async t => {
  const result = await runMocked(t, { NR_TEST_NODE_VERSION: '20.19.0' });
  assert.ok(result.calls.some(line => /\/node\s/.test(line)));
});

test('launcher refuses Java 17 even with a supported Node runtime', async t => {
  const result = await runMocked(t, { NR_TEST_JAVA_VERSION: '17.0.12' });
  assert.ok(result.calls.some(line => /\/java\s/.test(line)));
});

test('launcher refuses insufficient disk space before fetching or installing', async t => {
  const result = await runMocked(t, { NR_TEST_DISK_KB: '1024' });
  assert.ok(result.calls.some(line => /\/df\s/.test(line)));
});

test('launcher refuses unavailable ADC and never installs dependencies', async t => {
  const result = await runMocked(t, { NR_TEST_ADC: 'missing' });
  assert.ok(result.calls.some(line => /\/gcloud auth application-default print-access-token/.test(line)));
});

test('launcher refuses a mismatched project rather than using another Firebase environment', async t => {
  const result = await runMocked(t, { NR_TEST_PROJECT: 'synthetic-foreign-project' });
  assert.ok(result.calls.some(line => /\/gcloud projects describe/.test(line)));
});

test('pinned checkout and a completed blocked report preserve exit 2 and the diagnostic summary', async t => {
  const result = await runMocked(t, { NR_TEST_WORKFLOW: 'ok' }, false);
  assert.equal(result.code, 2);
  assert.ok(result.stdout.includes('SYNTHETIC_DIAGNOSTIC_BLOCKED'));
  assert.ok(result.stdout.includes('Kontrola zakończona'));
  const fetch = result.calls.find(line => /\/git .* fetch /.test(line));
  assert.ok(fetch?.includes('f6187f3f6cedd094b3c811c7dfeab00723302d4d'));
  assert.ok(fetch.includes('f46f197b344f6d7a951d2f38fef3ff4d34b35631'));
  assert.ok(result.calls.some(line => /\/npm .* ci --ignore-scripts --no-audit --no-fund$/.test(line)));
  assert.ok(result.calls.some(line => /\/node scripts\/tasks-release-preflight\.mjs --backup --output /.test(line)));
});

test('core exit 2 without a completed report is an execution failure rather than a finished control', async t => {
  const result = await runMocked(t, { NR_TEST_WORKFLOW: 'ok', NR_TEST_CORE_REPORT: 'no' }, false);
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes('Kontrola nie zakończyła raportu'));
  assert.ok(!result.stdout.includes('Kontrola zakończona'));
});

test('a fetched checkout with the wrong commit stops before dependency installation', async t => {
  const result = await runMocked(t, { NR_TEST_WORKFLOW: 'ok', NR_TEST_ACTUAL_SOURCE: 'a'.repeat(40) }, false);
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes('nie zgadza się'));
  assert.ok(!result.calls.some(line => /\/npm\s/.test(line)));
  assert.ok(!result.calls.some(line => /\/node scripts\//.test(line)));
});

test('launcher source is immutable and contains no release, credential export or write-activation command', async () => {
  const source = await readFile(launcher, 'utf8');
  assert.ok(source.includes('f6187f3f6cedd094b3c811c7dfeab00723302d4d'));
  assert.ok(source.includes('f46f197b344f6d7a951d2f38fef3ff4d34b35631'));
  assert.ok(!/\bgit\s+(?:push|commit|merge)\b/.test(source));
  assert.ok(!/\bfirebase\s+(?:deploy|database:set|functions:secrets:set)\b/.test(source));
  assert.ok(!/\bgcloud\s+(?:storage\s+(?:rm|cp)|secrets\s+versions\s+access|projects\s+add-iam-policy-binding)\b/.test(source));
  assert.ok(!/FAMILY_(?:V2|TASKS)_WRITES_ENABLED\s*=\s*['"]?true/.test(source));
});
