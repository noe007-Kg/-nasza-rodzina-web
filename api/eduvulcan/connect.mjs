import { createEduHandler } from '../../server/edu-http.mjs';
import { connectAction } from '../../server/edu-service.mjs';
export default createEduHandler('POST', connectAction);
