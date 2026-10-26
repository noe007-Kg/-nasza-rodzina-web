import type { CalendarSchoolDisplayRecord } from '../useCalendarSchoolSources';
export type SchoolHomeEntry = {id:string;person:string;title:string;kind:string;dateLabel:string;isNew:boolean};
const kinds: Record<string,string> = {grade:'Ocena',homework:'Zadanie domowe',test:'Sprawdzian',message:'Wiadomość',notice:'Ogłoszenie'};
/** No fabricated timestamps: old undated records sort last and have an explicit fallback. */
export function schoolHomeEntries(rows: readonly CalendarSchoolDisplayRecord[], isNew: (row: CalendarSchoolDisplayRecord)=>boolean): SchoolHomeEntry[] {
  const timestamp = (row: CalendarSchoolDisplayRecord) => row.createdAt?.getTime() || (row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? Date.parse(`${row.date}T12:00:00Z`) : 0);
  return rows.filter(row => kinds[row.type] && !row.manualDayPlan)
    .map(row=>({row,new:isNew(row)})).sort((a,b)=>Number(b.new)-Number(a.new)||timestamp(b.row)-timestamp(a.row)||a.row.id.localeCompare(b.row.id)).slice(0,4)
    .map(({row,new:fresh})=>({id:row.id,person:row.person,title:row.subject ? `${row.subject}: ${row.title}` : row.title,kind:kinds[row.type],isNew:fresh,
      dateLabel:row.createdAt ? `Dodano ${row.createdAt.toLocaleString('pl-PL',{timeZone:'Europe/Warsaw',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}` : row.date ? `Termin ${row.date.split('-').reverse().join('.')}` : 'Data niepodana'}));
}
