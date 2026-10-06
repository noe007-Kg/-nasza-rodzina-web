import { createNotificationHandler } from '../../server/notification-http.mjs';
import { refreshInAppNotifications } from '../../server/notification-refresh.mjs';

export default createNotificationHandler(refreshInAppNotifications);
