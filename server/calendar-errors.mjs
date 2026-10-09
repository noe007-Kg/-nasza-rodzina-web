/** Safe errors only. Never attach an upstream body, token, credential or stack to a response. */
export class CalendarServerError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'CalendarServerError';
    this.code = code;
    this.status = status;
  }
}

export const calendarError = (code, status, message) => new CalendarServerError(code, status, message);
export const failCalendar = (code, status, message) => { throw calendarError(code, status, message); };
