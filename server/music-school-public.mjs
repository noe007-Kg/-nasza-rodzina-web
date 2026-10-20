import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { MUSIC_SCHOOL_INDEX, isDate } from './music-school-model.mjs';

function safeUrl(value) {
  const url = new URL(value, MUSIC_SCHOOL_INDEX);
  if (url.origin !== 'https://www.gov.pl' || url.username || url.password || url.search || url.hash
    || !/^\/web\/psmkolobrzeg\/[a-z0-9-]+$/.test(url.pathname)) throw new Error('MUSIC_PUBLIC_URL');
  return url.href;
}
async function readPage(url, fetcher, signal) {
  const response = await fetcher(safeUrl(url), { method: 'GET', redirect: 'error', signal,
    headers: { Accept: 'text/html', 'User-Agent': 'NaszaRodzina-SchoolCalendar/2.0' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('MUSIC_PUBLIC_UNAVAILABLE');
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('MUSIC_PUBLIC_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
const months = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const teachers = [
  { canonical: 'Agnieszka Sokolnicka', heading: 'Pani Agnieszka Sokolnicka', inflected: 'Agnieszką Sokolnicką' },
  { canonical: 'Anna Leszczyńska', heading: 'Pani Anna Leszczyńska', inflected: 'Anną Leszczyńską' },
];
/** Deliberately narrow grammar. Unknown wording is surfaced for human review, never guessed. */
export function parsePublicCancellation(html, url) {
  const $ = load(html), article = $('article#main-content');
  const teacher = teachers.find(x => article.find('h2').first().text().trim() === x.heading);
  if (!teacher) return { notices: [], review: false };
  const text = article.find('.editor-content').text().replace(/\s+/g, ' ').trim();
  const match = /^W dniach (\d{1,2})\s*[-–]\s*(\d{1,2}) ([a-ząćęłńóśźż]+) (\d{4}) r\. zajęcia z Panią (.+) są odwołane\.$/u.exec(text);
  if (!match || match[5] !== teacher.inflected) return { notices: [], review: true };
  const month = months.indexOf(match[3]) + 1;
  const date = day => `${match[4]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const from = date(match[1]), until = date(match[2]);
  if (!isDate(from) || !isDate(until) || until < from) return { notices: [], review: true };
  return { notices: [{ teacher: teacher.canonical, from, until, url: safeUrl(url),
    hash: createHash('sha256').update(text).digest('hex') }], review: false };
}
export async function fetchPublicCancellations({ fetcher = fetch } = {}) {
  const signal = AbortSignal.timeout(40_000);
  const html = await readPage(MUSIC_SCHOOL_INDEX, fetcher, signal), $ = load(html);
  if (!$('main').length || !html.includes('Nieobecności')) throw new Error('MUSIC_PUBLIC_STRUCTURE');
  const links = new Set();
  $('main a[href]').each((_, node) => {
    const href = $(node).attr('href');
    // Teacher article links only; no navigation, login, files or external hosts.
    if (/^\/web\/psmkolobrzeg\/pani-[a-z0-9-]+$/.test(href || '')) links.add(safeUrl(href));
  });
  if (links.size > 20) throw new Error('MUSIC_PUBLIC_LIMIT');
  const notices = []; let review = false;
  for (const url of links) {
    const parsed = parsePublicCancellation(await readPage(url, fetcher, signal), url);
    notices.push(...parsed.notices); review ||= parsed.review;
  }
  // A successful empty list is not evidence that a previously cancelled lesson resumed.
  return { notices, review };
}
