import { createEduHandler } from '../../server/edu-http.mjs';
import { syncAction } from '../../server/edu-service.mjs';
export default createEduHandler('POST', syncAction);
