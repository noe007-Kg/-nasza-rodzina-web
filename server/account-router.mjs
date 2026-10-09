import { createAccountHandler } from './account-http.mjs';
import { manageMemberAction } from './account-members.mjs';
import { manageProfileAction } from './account-profiles.mjs';
import { googleLoginAction } from './account-auth.mjs';

function accountRoute(request) {
  // Check the original origin-form path, without URL pathname normalization or
  // decoding: neither an encoded path nor a query parameter chooses a guard.
  if (typeof request.url !== 'string' || /[\u0000-\u0020\u007f\\#]/.test(request.url)) return null;
  const separator = request.url.indexOf('?');
  const path = separator < 0 ? request.url : request.url.slice(0, separator);
  const match = /^\/api\/account\/(members|profile|google-login)$/.exec(path);
  if (!match) return null;
  const action = match[1];
  const queryActions = new URLSearchParams(separator < 0 ? '' : request.url.slice(separator + 1)).getAll('action');
  if (queryActions.length > 1 || (queryActions.length === 1 && queryActions[0] !== action)) return null;
  // Vercel injects the dynamic segment into request.query. It must agree with
  // the actual pathname; arrays and conflicting values fail closed.
  if (request.query && Object.hasOwn(request.query, 'action') && request.query.action !== action) return null;
  return action;
}

function rejectRoute(request, response) {
  response.setHeader('Cache-Control', 'no-store, private, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false, error: {
    code: 'ACCOUNT_NOT_FOUND', message: 'Nie znaleziono tej operacji konta.',
  } }));
  if (request.body && typeof request.body === 'object') {
    if (Buffer.isBuffer(request.body)) request.body.fill(0);
    else for (const field of ['credential', 'token', 'password']) delete request.body[field];
  }
  request.body = undefined;
}

/** One Vercel function, with the unchanged authorization policy of each URL. */
export function createAccountRouter({
  services,
  memberAction = manageMemberAction,
  profileAction = manageProfileAction,
  googleAction = googleLoginAction,
} = {}) {
  const handlers = {
    members: createAccountHandler(memberAction, { services }),
    profile: createAccountHandler(profileAction, { memberOnly: true, services }),
    'google-login': createAccountHandler((context, body) => googleAction(body, context), { public: true, services }),
  };
  return async function accountRouter(request, response) {
    const action = accountRoute(request);
    if (!action) return rejectRoute(request, response);
    return handlers[action](request, response);
  };
}
