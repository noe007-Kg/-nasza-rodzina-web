import { EduServerError } from './edu-auth.mjs';
import { requireEduConnection } from './edu-access.mjs';

const LIMIT = 16 * 1024;

export async function readJsonBody(request) {
  const contentType = request.headers?.['content-type'] || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new EduServerError('EDU_INVALID_REQUEST', 415, 'Żądanie musi zawierać dane JSON.');
  let raw = request.body;
  if (raw === undefined) {
    const chunks = []; let length = 0;
    for await (const chunk of request) {
      length += Buffer.byteLength(chunk);
      if (length > LIMIT) throw new EduServerError('EDU_INVALID_REQUEST', 413, 'Żądanie jest zbyt duże.');
      chunks.push(Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > LIMIT) throw new EduServerError('EDU_INVALID_REQUEST', 413, 'Żądanie jest zbyt duże.');
    try { raw = JSON.parse(raw); } catch { throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Nieprawidłowe dane żądania.'); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > LIMIT) throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Nieprawidłowe dane żądania.');
  return raw;
}

export function expectFields(body, keys) {
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new EduServerError('EDU_INVALID_REQUEST', 400, 'Żądanie zawiera nieobsługiwane pola.');
}

/** Vercel Node handler. Error responses deliberately exclude upstream text and stacks. */
export function createEduHandler(method, action, { authenticate = requireEduConnection } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store, private, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (request.method !== method) {
        response.setHeader('Allow', method);
        throw new EduServerError('EDU_METHOD_NOT_ALLOWED', 405, 'Nieobsługiwana metoda żądania.');
      }
      const context = await authenticate(request);
      const body = method === 'GET' ? {} : await readJsonBody(request);
      const result = await action(context, body);
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      const known = error instanceof EduServerError;
      response.statusCode = known ? error.status : 500;
      if (response.statusCode === 429) response.setHeader('Retry-After', '300');
      response.end(JSON.stringify({ ok: false, error: {
        code: known ? error.code : 'EDU_SERVER_ERROR',
        message: known ? error.message : 'Nie udało się połączyć z dziennikiem. Spróbuj ponownie za chwilę.',
      } }));
    } finally {
      // The framework may retain its parsed request object; clear credentials immediately.
      if (request.body && typeof request.body === 'object') {
        if (Buffer.isBuffer(request.body)) request.body.fill(0);
        else { delete request.body.password; delete request.body.login; }
      }
      request.body = undefined;
    }
  };
}
