import { requireMember, EduServerError } from './edu-auth.mjs';
import { readJsonBody } from './edu-http.mjs';
export function createNotificationHandler(action, authenticate = requireMember) {
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new EduServerError('NOTIFICATION_METHOD', 405, 'Nieobsługiwana metoda.'); }
      const context = await authenticate(request);
      const result = await action(context, await readJsonBody(request));
      response.statusCode = 200; response.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      response.statusCode = error instanceof EduServerError ? error.status : 500;
      response.end(JSON.stringify({ ok: false, error: { code: error instanceof EduServerError ? error.code : 'NOTIFICATION_ERROR', message: error instanceof EduServerError ? error.message : 'Nie udało się zapisać urządzenia powiadomień.' } }));
    } finally { request.body = undefined; }
  };
}
