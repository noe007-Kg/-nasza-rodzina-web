import { createCalendarHandler } from '../../server/calendar-http.mjs';
import { calendarStatus, changeGoogleEventVisibility, configureGoogleCalendar, disconnectGoogleCalendar, finalizeCalendarOAuth,
  listGoogleCalendars, startCalendarOAuth, syncGoogleCalendar } from '../../server/calendar-service.mjs';
import { googleHistoryStep, configureGoogleTwoWay, exportLocalEventToGoogle, updateImportedGoogleEvent, changeGoogleVisibilityBatch } from '../../server/calendar-service.mjs';

export default createCalendarHandler({
  start: startCalendarOAuth,
  finalize: finalizeCalendarOAuth,
  status: calendarStatus,
  list: listGoogleCalendars,
  configure: configureGoogleCalendar,
  sync: syncGoogleCalendar,
  disconnect: disconnectGoogleCalendar,
  visibility: changeGoogleEventVisibility,
  history: googleHistoryStep,
  twoway: configureGoogleTwoWay,
  export: exportLocalEventToGoogle,
  update: updateImportedGoogleEvent,
  visibilitybatch: changeGoogleVisibilityBatch,
});
