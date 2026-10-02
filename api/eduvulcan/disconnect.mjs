import { createEduHandler } from '../../server/edu-http.mjs';
import { disconnectAction } from '../../server/edu-service.mjs';
export default createEduHandler('POST', disconnectAction);
