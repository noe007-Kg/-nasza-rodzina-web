import { createNotificationHandler } from '../../server/notification-http.mjs';
import { notificationDeviceStatus } from '../../server/notification-devices.mjs';
export default createNotificationHandler(notificationDeviceStatus);
