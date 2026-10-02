import { createEduHandler } from '../../server/edu-http.mjs';
import { selectAction } from '../../server/edu-service.mjs';
export default createEduHandler('POST', selectAction);
