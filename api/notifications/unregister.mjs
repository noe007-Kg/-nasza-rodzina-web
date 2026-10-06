import { createNotificationHandler } from '../../server/notification-http.mjs';
import { unregisterNotificationDevice } from '../../server/notification-devices.mjs';
export default createNotificationHandler(unregisterNotificationDevice);
