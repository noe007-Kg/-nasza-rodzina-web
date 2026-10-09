import { createCalendarHandler } from '../../server/calendar-http.mjs';
import { calendarStatus, changeGoogleEventVisibility, configureGoogleCalendar, disconnectGoogleCalendar, finalizeCalendarOAuth,
  listGoogleCalendars, startCalendarOAuth, syncGoogleCalendar } from '../../server/calendar-service.mjs';

export default createCalendarHandler({
  start: startCalendarOAuth,
  finalize: finalizeCalendarOAuth,
  status: calendarStatus,
  list: listGoogleCalendars,
  configure: configureGoogleCalendar,
  sync: syncGoogleCalendar,
  disconnect: disconnectGoogleCalendar,
  visibility: changeGoogleEventVisibility,
});
