import { createNotificationHandler } from '../../server/notification-http.mjs';
import { registerNotificationDevice } from '../../server/notification-devices.mjs';
export default createNotificationHandler(registerNotificationDevice);
