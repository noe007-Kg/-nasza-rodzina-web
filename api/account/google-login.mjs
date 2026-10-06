import { createAccountHandler } from '../../server/account-http.mjs';
import { googleLoginAction } from '../../server/account-auth.mjs';
export default createAccountHandler((services, body) => googleLoginAction(body, services), { public: true });
