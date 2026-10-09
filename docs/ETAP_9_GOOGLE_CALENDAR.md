# Etap 9A — odczyt Google Calendar

Nowe źródło jest dodatkiem do istniejącego kalendarza. Nie zmienia logowania Google, UID, profili, integracji SP4, klucza eduVULCAN, jej sesji ani harmonogramów. Nie wykonano konfiguracji OAuth, zmian sekretów, deploymentu ani zapisu danych produkcyjnych.

## Co zostało przygotowane

- Jeden grupowany endpoint Vercel `api/calendars/[action].mjs`: start, callback, finalize, status, list, configure, sync, disconnect, visibility.
- OAuth authorization-code + PKCE S256; losowy, jednorazowy state powiązany z inicjującym Firebase UID i nonce z cookie `__Host-calendar-oauth` (HttpOnly, Secure, SameSite=Lax, 10 minut). Callback nie kończy przypisania konta: finalize wymaga nadal tego samego aktywnego Firebase UID i nonce.
- Reconnect zachowuje identyfikator połączenia; state pamięta jego wersję. Stary callback nie może reaktywować źródła po rozłączeniu lub nowszym ponownym połączeniu.
- Wyłącznie scope `calendar.readonly`, stałe endpointy Google, zakaz redirectów w fetch. Żadnych zapisów ani usunięć w Google Calendar.
- Tokeny/cursor w zaszyfrowanej kopercie AES-256-GCM, oddzielny klucz `CALENDAR_ENCRYPTION_KEY_BASE64`; AAD wiąże UID, connection ID i cel. Kod odrzuca zastosowanie klucza eduVULCAN. Serwer nie loguje tokenów, kodów OAuth, upstream payloadów ani prywatnych błędów.
- Jawny wybór profilu/widoczności/trybu i potwierdzenie realnego kalendarza z listy Google przed pierwszym pobraniem (`selectionConfirmed`). Prywatny właściciel to UID importującego, także przy przypisaniu wydarzenia do profilu dziecka. Rodzic nie uzyskuje przez to cudzych prywatnych wydarzeń.
- `_calendarConnections`, `_calendarOAuthStates` i `_calendarOAuthRates` są danymi wyłącznie backendowymi. Klient nie dostaje kopert, tokenów, lease ani nonce hash. Status zwraca wyłącznie własne połączenia użytkownika.
- Limit wynosi 10 aktywnych i 30 wszystkich zachowanych źródeł na UID. Nowe źródło jest atomowo odrzucane przed zapisem po osiągnięciu limitu historii; ponowne połączenie istniejącego źródła pozostaje możliwe przy 30 rekordach i nie tworzy duplikatu. Rozłączenie nie kasuje automatycznie historii źródła. Nie dodano automatycznego czyszczenia ani paginacji historii; limit jest uczciwie podany w komunikacie. Lista dostępnych kalendarzy Google dopuszcza 250 pozycji po obu stronach API.
- Stabilne SHA-256 ID z UID, connection ID, calendar ID i external event ID; upsert korzysta z atomowego lease/version i ponownie sprawdza aktywność aktora/profilu. Zmiana widoczności pojedynczego wydarzenia jest atomowa między istniejącymi `calendarEvents` i `privateCalendarEvents`. Kolejny sync zachowuje kolekcję/visibility override.
- Import jednorazowy po sukcesie usuwa zapamiętane tokeny. Synchronizacja zapisuje cursor dopiero po kompletnym pobraniu i wszystkich chunkach. Częściowy import zostaje idempotentny i od pierwszego zapisanego chunku blokuje zmianę źródła/właściciela. Poprawnie obrócony token zachowany po późniejszym błędzie strony, bez awansu cursor/lastSuccessfulSyncAt.
- Rozłączanie daje wybór: pozostaw wydarzenia lub usuń wyłącznie rekordy tego źródła. Wersja unieważnia stary sync; historia innych źródeł nie jest ruszana.
- Usuwanie źródła ma atomowy fence z ograniczonym terminem: podczas niego nie można zmieniać visibility ani reaktywować źródła. Każdy chunk sprawdza aktualną wersję i termin po odczytach. Po błędzie historia, której nie usunięto, pozostaje, fence jest bezpiecznie zwalniany dla retry. Rodzinne i prywatne rekordy źródła są odczytywane w jednym spójnym read-only snapshot transaction, także przy rozliczaniu pełnej synchronizacji.

## Czas, serie i odwołania

Timed events zachowują prawdziwe instants i timezone. All-day Google ma wyłączny koniec, który jest przekształcany do istniejącego modelu aplikacji: endDate = wyłączna północ minus 1 ms, również przy zmianie czasu.

Oryginalne daty DATE są zachowane jako `sourceStartDate` i `sourceEndDateExclusive`; drugi zapis pozostaje datą wyłącznego końca providera. Początek dnia w strefie źródła to jego pierwszy rzeczywisty instant: jeśli zmiana czasu pomija północ, nie wymyślamy 00:00 i nie odrzucamy poprawnego dnia. Przykład `America/Sao_Paulo`, 2018-11-04: dzień zaczyna się o 01:00, trwa 23 godziny i nie blokuje pobrania istniejącej historii. Całkowicie nieistniejąca data, np. `Pacific/Apia`, 2011-12-30, nadal jest odrzucana. Daty źródłowe i rzeczywiste instants są zachowywane po zmianie lokalnej widoczności i przy tombstone odwołania. Nie stosuje się tego mechanizmu do zgadywania godzin wpisów timed.

Master sync używa `singleEvents=false`, `showDeleted=true`, bez niezgodnych z syncToken filtrów timeMin/timeMax. Aktywne serie są osobno rozwijane przez `/instances` w ograniczonym oknie: 180 dni wstecz i 366 dni naprzód od synchronizacji. Są stabilnymi konkretnymi wystąpieniami (`repeat=none`) pochodzącymi ze źródła Google; edycje serii pozostają w Google. Pełne stronicowanie, maksymalnie 10 stron żądania, 5000 rekordów łącznie i 500 serii; niepełny odczyt/limit nie awansuje cursor.

Jawna anulacja lub usunięcie u providera pozostawia istniejące wydarzenie z `cancelled=true` i jego dawnymi szczegółami. Po kompletnym pobraniu serii/okna brak wcześniej zapisanej instancji może być uznany za odwołanie tylko wewnątrz tego autorytatywnie pobranego okna. Zmniejszenie RRULE COUNT/UNTIL i konwersja serii do pojedynczego wydarzenia nie pozostawiają w tym oknie aktywnych osieroconych instancji. Po 410 wykonuje się kompletny odczyt i analogiczne ograniczone rozliczenie serii. Po nieudanej stronie, poza oknem lub bez potwierdzonego snapshotu brak rekordu nie jest traktowany jako usunięcie.

Kompletny, nieograniczony filtrem czasu snapshot masterów z potwierdzonym nextSyncToken dowodzi też braku wcześniejszego wydarzenia pojedynczego — zostaje ono ODWOŁANE nawet jeśli stary tombstone zniknął u Google. Ten wniosek nie jest stosowany do częściowego incremental odczytu. Konwersja pojedynczego wpisu do serii anuluje dawny pojedynczy rekord, zachowując aktywne konkretne instancje. Ograniczenie okna instancji nadal obowiązuje.

## Wymagana konfiguracja przed uruchomieniem tej integracji

NOWE server-only Environment Variables Vercel (żadna nie ma prefiksu VITE):

| Zmienna | Wymaganie |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth Web client ID dopuszczający dostęp Calendar readonly |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Sekret tego samego klienta OAuth |
| `CALENDAR_SITE_ORIGIN` | Dokładna produkcyjna domena HTTPS, bez ścieżki, credentials/query/hash |
| `CALENDAR_ENCRYPTION_KEY_BASE64` | Osobny 32-bajtowy klucz AES, poprawna canonical base64; różny od klucza eduVULCAN |
| `CALENDAR_ENCRYPTION_KEY_ID` | Identyfikator klucza, domyślnie `v1` |

W Google Cloud: aktywne Google Calendar API, skonfigurowany consent screen i OAuth client typu Web application. Authorized redirect URI musi być dokładnie `${CALENDAR_SITE_ORIGIN}/api/calendars/callback`. Nie używa hasła konta Google. Nie skonfigurowano ani nie testowano rzeczywistego konta Google w tym etapie. Scope Calendar może wymagać weryfikacji aplikacji; tryb Testing i jego limity Google (w tym żywotność tokenów) pozostają ograniczeniem dostawcy.

W Vercel dodano wpis dla `api/calendars/*.mjs`: `maxDuration: 60`, `includeFiles: server/**` i nagłówki no-store/nosniff. Użytkownik potwierdził plan Hobby. Osobny etap 9H połączył trzy pliki obsługi konta w jeden, zachowując publiczne URL i ich autoryzację. Po dodaniu Google Calendar projekt ma 11 endpointów API. Nie przebudowano działających routes eduVULCAN.

Rules muszą chronić pochodzenie/provider metadata przed zapisami klienta i rekordy Google przed client CRUD; importer zmienia visibility przez autoryzowany backend. Kolekcje prywatne nadal `ownerUid`-only. Nie jest potrzebna migracja istniejących manualnych wydarzeń ani zmiana szyfrowania/sekretów SP4.

## Ograniczenia i dalsze etapy

Połączenia Google są odświeżane przez frontend przy zalogowaniu/aktywacji z godzinnym limitem, oraz ręcznym przyciskiem (backend minimalny cooldown 60 s). Użytkownik wybrał również odświeżanie przy zamkniętej aplikacji: osobny etap 9B dodaje `googleCalendarHourly` przez Firebase, opisany w `ETAP_9B_GOOGLE_SCHEDULER.md`. Dotychczasowe harmonogramy SP4 nie są zmieniane. Harmonogram nie działa produkcyjnie przed osobno zatwierdzonym deploymentem i przygotowaniem konfiguracji.

Outlook OAuth/Microsoft Graph i automatyczne pobieranie prywatnych ICS URL nie są zaimplementowane w tym etapie; nie są pokazywane jako działające połączenia. Apple/iCloud i Outlook mogą korzystać z istniejącego jednorazowego importu/eksportu ICS zgodnie z jego ograniczeniami. Bez skonfigurowanego Google OAuth istniejący kalendarz, ICS, Auth i SP4 pracują normalnie.

## Walidacja

Dodano testy backendu: szyfrowanie i separacja kluczy, PKCE/scope/token exchange, canonical redirect, UID/nonce/replay/expiry, disconnect podczas OAuth/sync, per-source lease, wybór kalendarza, prywatny import, visibility override, idempotencja, jawne anulacje, skrócona seria, all-day/DST, partial import/cursor, obrócony token po późniejszym błędzie, read-after-write transaction contract, brak sekretów w odpowiedziach i działanie statusu bez konfiguracji.

Lokalny błąd klucza, identyfikatora lub koperty zwraca `CALENDAR_DECRYPT_FAILED` (503), zwalnia lease i zachowuje ciphertext, wersję, cursor, historię i czas ostatniego sukcesu. Nie inicjuje żądania do Google. Przywrócenie poprawnej konfiguracji pozwala ponowić synchronizację. Dopiero potwierdzone przez Google unieważnienie autoryzacji (`invalid_grant`, ponowne 401 lub brak wymaganego scope) oznacza konieczność ponownego połączenia; nie usuwa historii wydarzeń. Niepełna odpowiedź token endpointu nie unieważnia połączenia. Wyłączenie aktora lub profilu jest ponownie sprawdzane wewnątrz transakcji importu.

Weryfikacja etapu 9A na Node.js 22.23.3:

| Kontrola | Wynik |
| --- | --- |
| `npm run build` | PASS; istniejące ostrzeżenie rozmiaru bundla |
| `npm run test:unit` | 187/187 PASS |
| `npm run test:server` | 397/397 PASS |
| `npm run test:functions` | 54/54 PASS; 13 istniejących Functions przed osobnym etapem 9B |
| `npm run test:rules` | 47/47 PASS |
| E2E Google settings/display + SP4 Calendar/manual Calendar | 80/80 PASS w jednym przebiegu, Chromium 40 + WebKit 40 |

E2E używają wyłącznie lokalnych emulatorów i syntetycznego API. Testy backendu wywołują rzeczywisty kod z testowym dostawcą. Nie skonfigurowano ani nie testowano prawdziwej autoryzacji produkcyjnej Google. Pełna regresja wszystkich ekranów i rzeczywiste integracje emulatorowe Google są wykonywane centralnie po dołączeniu etapu 9B.
