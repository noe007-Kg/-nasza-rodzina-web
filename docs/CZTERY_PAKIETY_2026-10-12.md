# Nasza Rodzina 2.0 — Finanse i trzy poprawki

## Zakres i baza

Implementacja specyfikacji z `Nasza_Rodzina_CODEX_Finanse_i_3_poprawki_2026-10-12.zip`.
Gałąź robocza: `feature/finance-and-safe-fixes-20261012`.
Baza: `6070fb8c04cb3a40190b22b7b4ebd13821dce633`, czyli aktualna udana wersja Production odczytana z metadanych wdrożeń GitHub przy rozpoczęciu pracy. Poprawki 004, 005 i 006 są zachowane; nie powtarzamy ich.

Nie wykonano migracji, importu prawdziwych kalendarzy, operacji na danych rodziny, zmian sekretów ani deploymentu produkcji lub Firebase. Preview podłączony do produkcyjnego Firebase nadal odmawia nowych zapisów. Wszystkie testy zapisujące korzystają z projektu `demo-nasza-rodzina` i lokalnych emulatorów.

## 1. Zdrowie — załączniki wizyt (020)

Stary formularz przesyłał plik do `health/…` przed zapisem wizyty. Odmowa Storage przed ukończeniem przesyłania uniemożliwiała zapis tego formularza, a ogólny komunikat ukrywał kod błędu. Nie mamy potwierdzenia, jakie reguły i uprawnienia działały podczas zgłoszonego produkcyjnego błędu 0%; nie przedstawiamy przypuszczenia jako potwierdzonej diagnozy chmurowej.

Nowe PDF/JPG oraz pozostałe już obsługiwane formaty wizyt przechodzą przez istniejący autoryzowany backend Zdrowia. Backend wystawia chroniony szkic, sprawdza świeże uprawnienia do pacjenta, rozmiar, MIME i nagłówek pliku. Dokument, wizyta oraz opcjonalny pojedynczy wpis kalendarza są finalizowane atomowo. U dorosłego pacjenta sama rola rodzica nie zastępuje zgody/upoważnienia.

Formularz pozostaje po błędzie, pokazuje rzeczywisty postęp i bezpieczny kod Storage. Retry używa tych samych identyfikatorów i ścieżki; utrata odpowiedzi po ukończonym uploadzie nie wymusza nadpisywania create-only pliku. Zmiana danych po niejednoznacznej, już zakończonej finalizacji wymaga otwarcia zapisanej wizyty, zamiast pozornego zapisania zmian. Listę dokumentów autoryzuje backend; pliki otwierane są przez uwierzytelniony `getBlob`, bez publicznych URL/tokenów pobierania.

Sprzątanie dotyczy tylko wygasłych, niepowiązanych szkiców. Gotowe dokumenty medyczne nie są automatycznie usuwane. Używamy istniejącego `healthDocumentReminders`, bez nowego zadania harmonogramu. Starszych dokumentów nie migrujemy ani nie usuwamy.

Ograniczenie weryfikacji Storage: emulator Firebase Tools przechowuje `downloadTokens` oddzielnie od custom metadata; nie usuwa go tak jak GCS przy `firebaseStorageDownloadTokens: null`, a odczyt Firebase może wygenerować nowy token. Nie zmieniamy kodu produkcyjnego ani emulatora, aby ukryć tę różnicę. Testy sprawdzają rzeczywiste żądanie SDK usunięcia tokenu oraz odmowę pobrania bez uwierzytelnienia/z innego UID. Faktyczne unieważnienie wcześniej skopiowanego tokenowego URL w chmurze pozostaje do sprawdzenia na izolowanym rzeczywistym Storage przed włączeniem nowych zapisów. Nie jest ono przedstawiane jako potwierdzone przez emulator. Dotyczy to również istniejącego sposobu usuwania tokenów ilustracji nagród.

## 2. Zadania i nagrody (009–013)

Zachowano istniejące przypisywanie zadań, zgłaszanie wykonania, rodzicielskie zatwierdzanie, transakcyjne salda/ledger, deduplikację punktów oraz zatwierdzanie wymiany nagród. Dziecko nadal nie może samodzielnie zmienić salda.

Nowa/edytowana nagroda wymaga nazwy, opisu i dodatniego kosztu punktowego. Opcjonalna ilustracja ma osobną ścieżkę `taskRewardImages`, chroniony serwerowy ticket i limit 8 MB (JPG/PNG/WebP). Jest trwała podczas używania nagrody: zatwierdzenie zadania lub odbioru nagrody nie usuwa ilustracji. Zastąpione i porzucone ilustracje sprząta istniejący `taskPhotoCleanup`; zdjęcia wykonanych zadań nadal mają swój osobny mechanizm usuwania i ponawiania.

Odczyt ilustracji respektuje gospodarstwo i przypisanie do osoby, również starszy profil bez `personKey`. Formularz zachowuje pola/ukończony upload po błędzie; podczas operacji pola są zablokowane, aby nie utracić edycji wykonanej równolegle.

## 3. Finanse (015–017)

Pastelowa lista rachunków i panel szczegółów realizują zatwierdzony szkic nr 1. Na mniejszym ekranie szczegóły/formularz używają istniejącego modala. Nie dodano budżetów, bankowości, QR ani automatycznych płatności. Stan pusty nie zawiera przykładowych rachunków z wizualizacji.

Rachunek zawiera kwotę PLN zapisaną w całkowitych groszach, termin, kategorię, odbiorcę, rachunek bankowy, tytuł przelewu, notatkę i opcjonalny zweryfikowany link HTTPS. Można kopiować dane przelewu, edytować nieopłacony rachunek i atomowo oznaczyć go jako opłacony. Opłacony okres zachowuje niezmienną historię. Widok historii pokazuje miesiące i sumy kategorii.

Domyślnie dane widzą tylko aktywni rodzice tego samego gospodarstwa. Rodzic może jawnie udostępnić konkretny rachunek wskazanemu dziecku; dziecko ma odczyt, bez zarządzania. Kolejne okresy cyklicznej opłaty nie dziedziczą tego udostępnienia. Wybór profilu na ekranie nie zmienia autoryzowanej tożsamości.

**Korekta bezpieczeństwa 2026-10-13:** wspólne `__legacy__` nie rozróżniało gospodarstw i nie zapewniało ich izolacji. Poprawka odrzuca rachunki i profile bez jawnego, zweryfikowanego `familyId`, w tym `__legacy__`. Nie wykonuje automatycznej migracji. Obowiązują [instrukcja wdrożenia i ograniczenia zgodności starszych danych](FINANCE_HOUSEHOLD_ISOLATION_2026-10-13.md).

Tygodniowe, miesięczne i roczne okresy mają stabilne identyfikatory, indywidualne kwoty/terminy/statusy; ponowne generowanie nie duplikuje danych. Backend tworzy ograniczoną liczbę bieżących/następnych okresów. Kwoty i status jednego okresu nie zmieniają opłaconej historii.

Opcjonalny termin w Kalendarzu jest prywatną, autoryzowaną projekcją tego samego rachunku. Nie tworzymy publicznej kopii w rodzinnych wydarzeniach. Projekcja nie zawiera numeru konta, notatki ani innych danych przelewu.

Nowe `financeReminders`: codziennie o 09:00, `Europe/Warsaw`, Gen2 `europe-west1`. Przypomnienia 7/3/0 dni przed terminem i pierwszego dnia po terminie korzystają z istniejącego IN-APP inbox oraz preferencji „Ważne informacje”. Treść nie zawiera kwoty ani danych przelewu. Stabilny identyfikator obejmuje rachunek, termin i etap. Transakcja ponownie sprawdza zapłatę, termin, gospodarstwo, udostępnienie i preferencje — retry nie tworzy duplikatu ani alertu po zapłacie. Funkcja pozostaje bezczynna, gdy `FAMILY_V2_WRITES_ENABLED` nie jest `true`.

## 4. Google Calendar (022)

Rozbudowano istniejącą integrację; Google Sign-In/Firebase UID pozostają bez zmian. Calendar wymaga osobnej zgody OAuth `calendar.readonly`. W tym etapie import jest dostępny tylko dla jawnie skonfigurowanego istniejącego UID Sebastiana i trafia do jego prywatnego kalendarza. Brak konfiguracji nie blokuje aplikacji ani `.ics`.

Użytkownik wybiera kalendarz i daty historii, sprawdza liczbę wpisów/serii, następnie oddzielnie potwierdza import. Stronicowanie i zapis postępu pozostają w istniejącym backendzie. Stabilne ID zapobiegają duplikatom; obsługujemy serie, wyjątki, anulowania, całodniowe daty i Warsaw/DST. Akceptowane okno historii jest egzekwowane także przy rozwijaniu serii w UI.

Dalsza synchronizacja kopiuje zaakceptowaną historię oraz nowe wydarzenia od chwili zgody na synchronizację. Nie kopiuje niezaakceptowanej historycznej luki. Aktualizacje/anulowania już zaimportowanych rekordów są stosowane także po przesunięciu poza początkowy zakres. Pełny stronicowany odczyt uzyskuje poprawny `syncToken` bez niedozwolonego łączenia go z `timeMin/timeMax`.

Eksport, zapis wydarzenia, OAuth z `write:true` i włączenie synchronizacji dwukierunkowej są odrzucane również przez backend. Stare `twoWayEnabled:true` lub zapisowy scope tokenu nie obchodzą tej blokady. Wspólna matematyka `rrule` działa na Node.js 22 i w Vite. Lokalny frontend otrzymuje wyłącznie jawny moduł czystych obliczeń; cała fizyczna ścieżka `/server` nadal zwraca 404.

Dwukierunkowość jest wyłącznie przyszłym planem: osobna zgoda na scope zapisu, świadome włączenie per źródło, mapowanie źródłowych ID, kontrola wersji/etag i konfliktów, osobne potwierdzanie usunięć oraz testy na izolowanym koncie. W tym wydaniu nie włączamy żadnego zapisu do Google.

## Konfiguracja przed późniejszym, zatwierdzonym wdrożeniem

Jedyna nowa zmienna: **`CALENDAR_GOOGLE_OWNER_UID`** — prawdziwy istniejący Firebase Auth UID Sebastiana, bez wpisywania go do repozytorium. Ustaw taką samą wartość jako zmienną serwerową Vercel i parametr Functions. Pusta wartość bezpiecznie wyłącza import. `.env.example` zawiera tylko puste miejsce.

Istniejące wymagania Calendar:

| Wartość | Vercel backend | Firebase Functions |
| --- | --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | Zmienna serwerowa | Parametr |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Sekret | Secret Manager, dostęp runtime |
| `CALENDAR_SITE_ORIGIN` | Dokładny origin HTTPS | Ten sam parametr |
| `CALENDAR_ENCRYPTION_KEY_BASE64` | Osobny sekret 32 bajty/base64 | Ten sam sekret, dostęp runtime |
| `CALENDAR_ENCRYPTION_KEY_ID` | Istniejący ID, domyślnie `v1` | Ten sam ID |
| `CALENDAR_GOOGLE_OWNER_UID` | UID istniejącego właściciela | Ten sam parametr |
| `FAMILY_V2_WRITES_ENABLED` | Domyślnie `false` | Domyślnie `false` |

Nie zmieniaj ani nie rotuj klucza eduVULCAN. Klucz kalendarzy jest od niego odrębny. Istniejące Firebase Admin/project/bucket/origin pozostają; zdrowotne i nagrodowe pliki wymagają właściwego rzeczywistego `FIREBASE_STORAGE_BUCKET` i autoryzowanego Admin dostępu do metadanych/odczytu/usuwania Storage.

Google Cloud: aktywne Calendar API, OAuth Client typu Web application, consent screen i uprawniony użytkownik. Scope: `https://www.googleapis.com/auth/calendar.readonly`. Dokładny produkcyjny redirect URI:

`https://nasza-rodzina-web.vercel.app/api/calendars/callback`

Google OAuth w zewnętrznym trybie testowania może ograniczać ważność refresh tokenu Calendar do siedmiu dni; długotrwała synchronizacja wymaga właściwej konfiguracji statusu aplikacji OAuth. Nie wykonano rzeczywistego OAuth ani importu danych.

Przygotowane zmiany Firebase: zawężone `firestore.rules`/`storage.rules`, dwa indeksy ilustracji nagród oraz dwa indeksy Finansów. Istniejące indeksy zachowano. Backend wykorzystuje istniejące route'y `/api/family/health`, `/api/family/tasks`, `/api/family/finance`; nie tworzy kolejnego odrębnego Vercel Function. Firebase codebase/runtime pozostają `nasza-rodzina`, Node.js 22, `europe-west1`. Nowa funkcja: `financeReminders`; aktualizowane mechanizmy: `googleCalendarHourly`, istniejące sprzątanie Zadań/Zdrowia. SP4/eduVULCAN i jego harmonogramy pozostają bez zmian.

Bezpieczna kolejność, **do wykonania dopiero po osobnym zatwierdzeniu**:

1. Zachować działający deployment oraz snapshot konfiguracji; nie zmieniać istniejących kluczy. Nowe zapisy pozostawić wyłączone.
2. Sprawdzić rzeczywisty bucket, IAM runtime, Calendar OAuth/API i równą konfigurację Calendar w Vercel/Functions. Nie przesyłać sekretów przez czat ani Git.
3. Na izolowanym rzeczywistym Storage potwierdzić usunięcie tokenu pobierania przez GCS metadata PATCH oraz odmowę użycia poprzedniego tokenowego URL po finalizacji/odebraniu dostępu. Emulator nie dowodzi tej części. Po kontroli wdrożyć zatwierdzone reguły i indeksy oraz przygotowane Functions/backend. Wygenerować `functions/server` poleceniem `npm run functions:prepare`; jego źródłem jest kanoniczny `server/`, a nie ręcznie edytowana kopia.
4. Po gotowych indeksach i kontroli uprawnień wdrożyć zatwierdzony frontend/backend Vercel; dopiero wtedy świadomie włączyć wymagane serwerowe operacje. Preview nadal musi odmawiać zapisu do produkcji.
5. Przeprowadzić osobną kontrolę produkcyjnego zdrowotnego uploadu za zgodą użytkownika, a Calendar połączyć osobiście przez OAuth i potwierdzić własny zakres historii. Nie robić automatycznej migracji starszych plików.

Rollback: najpierw wyłączyć nowe zapisy i harmonogramy przez `FAMILY_V2_WRITES_ENABLED=false`. Wycofać właściwy logiczny commit aplikacji lub wrócić do bazowego `6070fb8`. Nie usuwać danych, ledgerów, gotowych dokumentów ani historii płatności. Nie cofać reguł do szerszych uprawnień dla już utworzonych nowych danych; zachować nowe chronione kolekcje/ścieżki do czasu osobno zatwierdzonego planu danych. Google pozostaje tylko odczytem, więc nie wymaga odtwarzania zdalnego kalendarza.

## Weryfikacja

Wyniki ostatecznych celowanych testów i manifest zmienionych plików podano poniżej. Nie uruchamiamy całej wielusettestowej galerii ani testów na produkcyjnych rekordach. Pierwszy bieg browser wykrył i zatrzymał się na regresji lokalnego importu modułu recurrence; regresja została naprawiona, z dodatkowym testem blokady `/server`, przed końcową weryfikacją.


| Kontrola (Node.js 22.23.3) | Wynik |
| --- | --- |
| TypeScript i `npm run build`, oddzielnie dla czterech pakietów | PASS 4/4 |
| Celowane unit/model/progress/recurrence/activation | PASS 86/86 |
| Celowane server, HTTP, transakcje i runtime Functions | PASS 198/198 |
| Firestore/Storage Rules — istniejący zestaw v2 i nowe scenariusze | PASS 27/27 |
| Chromium — 11 różnych wybranych ścieżek | PASS 11/11 |
| WebKit — te same 11 ścieżek | PASS 11/11 |
| `npm --prefix functions ci --ignore-scripts` i `run check` | PASS; 46 kanonicznych modułów |
| `git diff --check` | PASS |

Browser wyniki zebrano z końcowych biegów odpowiednich plików po naprawieniu wykrytych błędów; nie są wynikiem pełnego zestawu E2E całej aplikacji. Finanse sprawdzono przy 390×844, 844×390, 900×1440, 1024×768 i 1440×900, również formularze/modal bez poziomego przepełnienia. Google ma w E2E kontrolowane odpowiedzi OAuth/API; nie przeprowadzono zgody na prawdziwym koncie. Finanse/Zdrowie używają rzeczywistych usług Auth/Firestore/Storage emulatorów i lokalnie wywoływanego backendu. Test formularza nagrody używa jawnego stubu API i rzeczywistego Storage emulatora; transakcje/salda oraz autoryzację sprawdzają osobne testy serwerowe i Rules.

Build pozostawia istniejące ostrzeżenie o dużym chunku JavaScript (>500 kB). Ostrzeżenie importu `rrule` usunięto; nie przebudowujemy niezwiązanych modułów w celu zmiany podziału bundla. Ograniczenie tokenów emulatora opisane w sekcji Zdrowie nie oznacza pozytywnego testu chmurowej revokacji.

### Manifest zmienionych i nowych plików

M — zmieniony plik istniejący; A — nowy plik. Generowane `functions/server/` nie są drugim źródłem: odtwarza je sprawdzany predeploy.

- M `.env.example`
- A `docs/CZTERY_PAKIETY_2026-10-12.md`
- M `firestore.indexes.json`
- M `firestore.rules`
- M `functions/index.mjs`
- M `functions/package-lock.json`
- M `functions/package.json`
- M `server/calendar-config.mjs`
- M `server/calendar-google.mjs`
- A `server/calendar-history-range.mjs`
- M `server/calendar-scheduler.mjs`
- M `server/calendar-service.mjs`
- M `server/calendar-storage.mjs`
- M `server/family-http.mjs`
- A `server/finance-model.mjs`
- A `server/finance-reminders.mjs`
- A `server/finance-service.mjs`
- A `server/google-recurrence.d.mts`
- A `server/google-recurrence.mjs`
- M `server/health-service.mjs`
- A `server/health-visit-attachments.mjs`
- M `server/notification-events.mjs`
- M `server/notification-inbox.mjs`
- M `server/tasks-photos.mjs`
- A `server/tasks-reward-images.mjs`
- M `server/tasks-service.mjs`
- M `src/app-shared.tsx`
- M `src/calendar-source-metadata.ts`
- M `src/calendars/ConnectedCalendarsSettings.tsx`
- M `src/calendars/GoogleCalendarV2Controls.tsx`
- M `src/calendars/activation-sync.ts`
- M `src/calendars/calendars.css`
- M `src/calendars/google-occurrences.ts`
- M `src/calendars/model.ts`
- M `src/family-v2-client.ts`
- M `src/features/CalendarPage.tsx`
- A `src/features/FinancePage.tsx`
- M `src/features/HealthPage.tsx`
- M `src/features/TasksPageV2.tsx`
- A `src/features/finance.css`
- M `src/features/health-upload.ts`
- M `src/features/tasks-v2.css`
- A `src/finance/calendar-projection.ts`
- A `src/finance/finance-api.ts`
- A `src/finance/model.ts`
- A `src/finance/useFinanceBills.ts`
- A `src/finance/useFinanceCalendarSources.ts`
- M `src/health/ProtectedHealthDocuments.tsx`
- M `src/health/health-api.ts`
- M `src/health/useCalendarHealthSources.ts`
- A `src/health/useProtectedHealthDocuments.ts`
- A `src/health/visit-attachment.ts`
- M `src/main.tsx`
- M `src/notifications/model.ts`
- M `storage.rules`
- M `tests/calendar-activation.test.ts`
- M `tests/calendar-client.test.ts`
- M `tests/calendar-history-v2.test.mjs`
- A `tests/calendar-readonly.test.mjs`
- M `tests/calendar-scheduler.test.mjs`
- M `tests/calendar-service.test.mjs`
- M `tests/calendar-source-metadata.test.ts`
- M `tests/calendar-test-helpers.mjs`
- M `tests/connected-calendars.spec.ts`
- M `tests/family-v2-critical.test.mjs`
- M `tests/family-v2-http.test.mjs`
- M `tests/family-v2.spec.ts`
- A `tests/finance-model.test.mjs`
- A `tests/finance-reminders.test.mjs`
- A `tests/finance-service.test.mjs`
- A `tests/finance-ui-model.test.ts`
- A `tests/finance.spec.ts`
- A `tests/four-packages.security.rules.test.mjs`
- M `tests/functions-runtime.test.mjs`
- M `tests/google-occurrences-v2.test.ts`
- A `tests/google-recurrence-vite.test.mjs`
- A `tests/health-visit-attachments.spec.ts`
- A `tests/health-visit-attachments.test.mjs`
- A `tests/health-visit-upload.test.ts`
- A `tests/tasks-reward-form.spec.ts`
- A `tests/tasks-reward-images.test.mjs`
- A `tests/tasks-upload.test.ts`
- M `vite.config.ts`
