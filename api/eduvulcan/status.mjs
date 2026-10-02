import { createEduHandler } from '../../server/edu-http.mjs';
import { statusAction } from '../../server/edu-service.mjs';
export default createEduHandler('GET', statusAction);
