import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('Vite serves the shared pure recurrence through a virtual module while every /server URL remains closed', async () => {
  const server = await createServer({ configFile: 'vite.config.ts', envFile: false, logLevel: 'silent',
    cacheDir: '/tmp/nasza-google-recurrence-vite-cache', optimizeDeps: { noDiscovery: true, include: ['rrule/dist/es5/rrule.js'] },
    // Vite treats port 0 as its default 5173. Keep this probe independent of E2E.
    server: { host: '127.0.0.1', port: 5179, strictPort: true } });
  try {
    await server.listen();
    const address = server.httpServer.address(), origin = `http://127.0.0.1:${address.port}`;
    for (const path of ['/server/edu-service.mjs', '/server/calendar-secrets.mjs', '/server/google-recurrence.mjs']) {
      const response = await fetch(origin + path); assert.equal(response.status, 404, path); assert.equal(await response.text(), '');
    }
    const entry = await fetch(origin + '/src/calendars/google-occurrences.ts'); assert.equal(entry.status, 200);
    const source = await entry.text(), url = source.match(/"(\/\@id\/__x00__family-public-google-recurrence[^"\n]*)"/)?.[1];
    assert.ok(url, 'Frontend must import the virtual arithmetic module, never /server');
    assert.doesNotMatch(source, /from\s*["']\/server\//);
    const recurrence = await fetch(origin + url); assert.equal(recurrence.status, 200);
    const publicSource = await recurrence.text();
    assert.match(publicSource, /function googleRecurrenceRule/); assert.doesNotMatch(publicSource, /process\.env|ENCRYPTION_KEY|refreshToken|clientSecret/);
    const dependencyUrl = publicSource.match(/from\s*["']([^"']*rrule[^"']*)["']/)?.[1];
    assert.ok(dependencyUrl?.startsWith('/'), 'rrule dependency must be resolved for a browser');
    assert.equal((await fetch(origin + dependencyUrl)).status, 200);
  } finally { await server.close(); }
});
