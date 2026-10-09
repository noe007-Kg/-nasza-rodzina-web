import { EduServerError, assertSameOrigin, getServerFirebase, requireMember, requireParent } from './edu-auth.mjs';
import { readJsonBody } from './edu-http.mjs';

/** Same-origin account endpoint; deliberately does not reuse eduVULCAN error handling/actions. */
export function createAccountHandler(action, { public: isPublic = false, memberOnly = false, services = getServerFirebase } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store, private, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new EduServerError('ACCOUNT_METHOD_NOT_ALLOWED', 405, 'Nieobsługiwana metoda żądania.');
      }
      assertSameOrigin(request);
      const firebase = services();
      const context = isPublic ? firebase : await (memberOnly ? requireMember : requireParent)(request, firebase);
      const result = await action(context, await readJsonBody(request));
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      const known = error instanceof EduServerError;
      response.statusCode = known ? error.status : 500;
      response.end(JSON.stringify({ ok: false, error: {
        code: known ? error.code : 'ACCOUNT_SERVER_ERROR',
        message: known ? error.message : 'Nie udało się zapisać zmiany konta. Spróbuj ponownie.',
      } }));
    } finally {
      if (request.body && typeof request.body === 'object') {
        if (Buffer.isBuffer(request.body)) request.body.fill(0);
        else for (const field of ['credential', 'token', 'password']) delete request.body[field];
      }
      request.body = undefined;
    }
  };
}

