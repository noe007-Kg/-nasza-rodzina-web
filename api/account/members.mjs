import { createAccountHandler } from '../../server/account-http.mjs';
import { manageMemberAction } from '../../server/account-members.mjs';
export default createAccountHandler(manageMemberAction);
