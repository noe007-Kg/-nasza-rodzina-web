# Nasza Rodzina 2.0 — raport i przygotowanie wdrożenia

Data: 11.10.2026. Gałąź: `feature/nasza-rodzina-v2`.

Baza została sprawdzona w GitHub Deployments: ostatnia udana produkcja wskazuje
`bb23702950c7c5498ac1a23570f69acf233662db` (9.10.2026), a nie starszy `main`.
Gałąź 2.0 zachowuje wszystkie zmiany tej produkcji. Nie wykonano migracji,
publikacji Firebase, zmiany sekretów ani operacji na produkcyjnych danych.

## A. Start i nawigacja

- Zatwierdzony Start, neonowe kolory, Multikolor, rozmiary i układ per UID pozostają.
- Kafelek kalendarza pokazuje dzisiejsze wydarzenia rodzinne z dostępnych źródeł,
  godziny, właścicieli i szczegóły. Prywatne wydarzenia nie trafiają do tego kafla.
- Rodzina zniknęła z sidebaru i „Więcej”. Profile i ich dotychczasowy ekran nadal
  działają; zarządzanie pozostaje w Ustawieniach → Członkowie rodziny.

## B. Zadania — przygotowane i sprawdzone lokalnie

- Trzy tryby: zaufanie, akceptacja rodzica, zdjęcie + akceptacja. Zachowano
  przypisanie, termin, opis, priorytet i powtarzanie oraz dotychczasowe zadania.
- Zgłoszenie fotograficzne pokazuje rzeczywisty postęp Storage, potem etap zapisu
  zgłoszenia. Niepełny upload nie przyznaje punktów.
- Salda, księga punktów, historia wykonania i wymiana nagród są kontrolowane przez
  backend i transakcje. Powtórzenie zatwierdzenia nie przyznaje punktów ponownie.
- Nagrody można dodawać, edytować, przypisywać i zamawiać. Odrzucenie prośby nie
  odejmuje punktów; zatwierdzenie atomowo sprawdza aktualne saldo.
- Ranking i odznaki wynikają z historii dynamicznych profili, bez stałej listy osób.
- Przy zatwierdzeniu, odesłaniu, archiwizacji lub zmianie przypisania atomowo
  unieważniane są bilety zdjęć. Zdjęcia są naprawdę usuwane ze Storage; błędy
  zapisują zadanie ponowienia. Godzinny `taskPhotoCleanup` ponawia usuwanie i
  usuwa porzucone uploady po 24 godzinach. Historia wykonania pozostaje.
- Zdjęcia: JPEG/PNG/WebP, limit 8 MiB, walidacja rozmiaru, nagłówka pliku,
  metadanych i autoryzowanego biletu. Klient nie może nadpisać ani usunąć dowodu.
- Nowe operacje wymagają osobno zatwierdzonego wdrożenia backendu i reguł.
  Przy wyłączonym zapisie wyświetlana jest dotychczasowa lista i jasny komunikat.

## C. Zakupy

- Widoki Wszystkie / Biedronka / Lidl / Dino / własne sklepy i liczniki pozostałych
  produktów. Własne sklepy można dodawać, edytować i archiwizować.
- `shopIds` przypisuje jeden produkt do kilku sklepów. Odhaczenie zmienia ten sam
  rekord we wszystkich widokach; nie powstają kopie produktu.
- Szybka notatka obsługuje opcjonalny wybór kilku sklepów. Kategorie, szybkie
  produkty, własne zdjęcia i dotychczasowa wspólna lista pozostają.
- Dodatkowe zapisy sklepów wymagają nowych reguł. W Preview są blokowane.

## D. Czat

- Zachowano rodzinny i prywatny tekstowy czat oraz wspólny composer.
- Dodano reakcje emoji i niezależne kursory odczytu per UID/kanał. Licznik
  nieprzeczytanych nie opiera się na wyłączeniu powiadomień.
- Ważne wiadomości używają istniejącego indywidualnego mechanizmu gwiazdki.
- Reakcje i kursory respektują uczestników rozmowy; dziecko nie odczytuje
  prywatnego czatu rodziców. Nie dodano zdjęć, filmów ani audio.

## E. Zdrowie

- Sekcje: Przegląd, Wizyty, Leki, Dokumenty, Historia zdrowia, Kontakty medyczne.
- Kompaktowy panel typów ważnych dokumentów: orzeczenie, dokument sądowy,
  legitymacja. Są to typy do uzupełnienia, nie fikcyjne istniejące dokumenty.
  Nazwa i status dokumentu sądowego wynikają z treści wpisanej przez użytkownika.
- Metadane: właściciel, rodzaj, nazwa, wydanie, ważność/bezterminowy, numer,
  uwagi, przypięcie i indywidualne udostępnienie właścicielowi dokumentu.
- Nowe chronione dokumenty mają ACL zarówno w Firestore, jak i Storage.
  Rola rodzica sama nie uprawnia do dokumentów pełnoletniego Pawła. Wymagana
  jest jego zgoda albo wcześniej zweryfikowane umocowanie zapisane przez
  zaufanego administratora. Klient nie może sam potwierdzić umocowania prawnego.
  Zgoda może zostać cofnięta. Brak daty urodzenia nie jest dowodem małoletniości.
- Nowy plik jest domyślnie dostępny uprawnionemu twórcy; udostępnienie
  właścicielowi jest świadomą opcją pojedynczego dokumentu.
- PDF/JPEG/PNG/WebP, do 10 MiB. Aparat, wiele stron, przód/tył i lokalne łączenie
  zdjęć w PDF. Pojedyncze pliki zachowują format. Rzeczywisty progress uploadu.
- Podgląd korzysta z uwierzytelnionego pobrania i tymczasowego blob URL:
  powiększanie, pełny ekran, pobieranie oraz drukowanie przez system przeglądarki.
  AirPrint zależy od Safari/iOS i dostępnej drukarki; nie testowano fizycznego druku.
- Status ważności i deduplikowane, ogólne powiadomienia 90/30/7 dni przed datą
  tylko do aktualnych uprawnionych czytelników. Bezterminowe nie wygasają.
- Dokumenty zdrowotne nigdy nie są kasowane z powodu upływu czasu. Ponawiane
  jest wyłącznie usunięcie świadomie zlecone przez uprawnioną osobę.
- Istniejące `healthRecords` i stare pliki `health/` nie zostały migrowane ani
  zmienione. Ich dotychczasowa polityka dostępu pozostaje; nie należy zakładać,
  że historyczne dokumenty automatycznie dostały nowe ACL. Wymagają osobnej
  oceny uprawnień i ewentualnego zatwierdzonego przeniesienia do chronionej sekcji.

## F. Kalendarz

- Domyślnie Dzień i własne wydarzenia; Dzień/Tydzień/Miesiąc, Dzisiaj,
  nawigacja, CRUD, lokalizacja, opisy i istniejące serie pozostają.
- Cała rodzina pokazuje wyłącznie wydarzenia rodzinne. Kolor właściciela,
  awatar/imię i godzina są niezależne od kolorów kafelków Startu.
- Najważniejsze terminy pokazują 3 pozycje i rozwijanie. Oznaczenie „ważne”,
  urodziny z rzeczywistych profili, wizyty i uprawnione terminy dokumentów;
  zwykła praca/lekcje nie trafiają tam automatycznie.

## G. Google Calendar — kod gotowy, wymagane konfiguracja i autoryzacja

- Rozbudowano istniejący endpoint i PKCE; nie powstał drugi system tokenów.
- Pełna historia jest pobierana stronami po maksymalnie 250 rekordów, bez
  wieloletniego ograniczenia dat. Jest wstępne liczenie, postęp i wznowienie.
  Liczba rekordów obejmuje definicje serii i wyjątki, nie nieskończone wystąpienia.
- Nowe importy zawsze trafiają do prywatnego kalendarza UID osoby łączącej.
  Nie są automatycznie widoczne rodzinie nawet przy starszym ustawieniu źródła.
- Udostępnienie pojedyncze lub zbiorcze zmienia tylko widoczność w Naszej Rodzinie.
  Lokalne ustawienie przetrwa synchronizację; nie zmienia Google sharing ACL.
- Zachowano identyfikatory, serie, wyjątki, anulowania, all-day, opisy i strefy.
  Wystąpienia rozwijane są dla oglądanego zakresu, a nie dla całej historii naraz.
- Świadomy eksport oraz dwukierunkowy zapis wymagają zakończonego importu,
  osobnej zgody OAuth na `https://www.googleapis.com/auth/calendar.events`,
  kalendarza z prawem zapisu oraz świadomego włączenia funkcji.
- Tokeny pozostają szyfrowane po stronie serwera. Zakres OAuth jest sprawdzany
  także po odświeżeniu tokenu. Google login do aplikacji pozostaje niezależny.
- ETag, fingerprint i mapowanie eksportu zapobiegają duplikatom i nadpisywaniu
  równoczesnych zmian. Niejednoznaczne konflikty lub usunięcia są oznaczane,
  a nie automatycznie destrukcyjnie rozstrzygane.
- Zmiana RRULE ręcznie wyeksportowanej serii w Google wymaga rozstrzygnięcia
  konfliktu: nie jest automatycznie tłumaczona na uproszczone lokalne `repeat`.
  Nie zaimplementowano pełnego interfejsu scalania wszystkich rodzajów konfliktów.
- Zachowano istniejący `googleCalendarHourly`. Nie wysłano zapisu do prawdziwego
  konta Google i nie testowano OAuth na danych użytkownika.

## H. Fryderyk — NIEPOŁĄCZONO

- 11.10.2026 anonimowe, zwykłe żądanie do
  `https://psmkolobrzeg.fryderyk.edu.pl` zwróciło HTTP 403 Cloudflare.
  Nie obchodzono ochrony, CAPTCHA, MFA ani oficjalnego mobilnego parowania.
- Oficjalny opis funkcji: https://www.fryderyk.edu.pl/funkcje-fryderyka.html
  opisuje plan, zmiany i funkcje portalu oraz eksport archiwalny. Nie potwierdza
  kontraktu API/ICS ani odnowienia sesji aplikacji zewnętrznej. Brak odnalezionej
  dokumentacji nie dowodzi, że producent nie może jej udostępnić.
- Użytkownik nie znalazł eksportu ICS. Nie ma potwierdzonego formatu pliku planu,
  stabilnych identyfikatorów i jednoznacznej reprezentacji odwołania/przełożenia.
- Zachowano niezależny widok Fryderyk — niepołączono. Nie ma fikcyjnego
  logowania, pobierania planu ani uruchomionego schedulera. Nie żądano haseł,
  tokenów ani kodów aktywacyjnych. Brak zajęć w odpowiedzi nie oznacza odwołania.
- Następny krok: szkoła/producent powinien potwierdzić autoryzowany API lub
  eksport/subskrypcję planu, dozwolony dostęp serwerowy, sposób autoryzacji
  i odnowienia sesji, identyfikatory lekcji, znaczenie statusów, strefy czasowe
  i limity. Jeżeli to możliwe, udostępnić zanonimizowaną specyfikację odpowiedzi.
- Dopiero wtedy można aktywować formularz połączenia i niezależną synchronizację
  godzinową `0 8-18 * * *`, Europe/Warsaw. Istniejący ogólny import ICS można
  wykorzystać wyłącznie po uzyskaniu rzeczywistego, poprawnego pliku; nie oznacza
  to, że sam Fryderyk taki eksport aktualnie udostępnia.

## I. Firebase i konfiguracja — przygotowane, NIE wdrożone

Nowe reguły odmawiają klientowi zapisu punktów, nagród, biletów zdjęć i chronionych
dokumentów. Operacje wykonuje autoryzowany backend. Nie otwarto bazy globalnie.

Nowy wspólny endpoint: `/api/family/[action]` (`tasks` albo `health`), POST,
zweryfikowany/revoked Firebase ID token, aktualny profil i ścisły Origin.
Liczba endpointów Vercel: 12, bez dodatkowego endpointu dla Google.

Nowe niesekretne ustawienia:

| Nazwa | Gdzie | Wartość / znaczenie |
| --- | --- | --- |
| `FAMILY_V2_WRITES_ENABLED` | Vercel backend + parametry Functions | Domyślnie `false`. Dopiero po osobno zatwierdzonym wdrożeniu zabezpieczeń `true`. |
| `FIREBASE_STORAGE_BUCKET` | Vercel backend + parametry Functions | Dokładna nazwa istniejącego bucketu, np. `nasza-rodzina.firebasestorage.app`. |
| `FAMILY_V2_SITE_ORIGIN` | Vercel, opcjonalnie | Dokładny HTTPS origin; fallback na istniejący Calendar/edu origin. |

Preview **zawsze** blokuje nowe zapisy nawet przy fladze `true`. Klient otrzymuje
automatyczne `VITE_V2_PREVIEW_READ_ONLY` z buildu Vercel, a backend niezależnie
sprawdza środowisko. Wygodny test nowych zapisów odbywa się w lokalnych emulatorach
`demo-nasza-rodzina`. Samo wpisanie flagi nie umożliwia zapisów Preview na produkcji.
Dotychczasowe operacje aplikacji nie zostały globalnie wyłączone: przy ręcznym
oglądaniu Preview używającego produkcyjnego Firebase nie należy modyfikować danych.

Istniejące sekrety i ustawienia Google pozostają: `GOOGLE_CALENDAR_CLIENT_ID`,
`GOOGLE_CALENDAR_CLIENT_SECRET`, `CALENDAR_SITE_ORIGIN`,
`CALENDAR_ENCRYPTION_KEY_BASE64`, `CALENDAR_ENCRYPTION_KEY_ID`. Dodatkowa zgoda
`calendar.events` może wymagać aktualizacji OAuth consent screen/scopes oraz
ponownego połączenia. Nie zastępować istniejącego klucza szyfrowania.

Functions: 16 endpointów Gen2/europe-west1/Node 22, w tym 14 dotychczasowych i 2 nowe:

| Nowa funkcja | Harmonogram Europe/Warsaw | Cel |
| --- | --- | --- |
| `taskPhotoCleanup` | `0 * * * *` | Rzeczywiste usuwanie dowodów zdjęciowych, retry i porzucone uploady. |
| `healthDocumentReminders` | `0 8 * * *` | Uprawnione przypomnienia i retry wyłącznie świadomego usunięcia. |

Obie są nieaktywne bez flagi i bucketu. Runtime/Vercel Admin muszą mieć minimalne
uprawnienia odczytu, metadanych i usuwania obiektów tego bucketu oraz obecny dostęp
do Firestore; można użyć `roles/storage.objectUser` na tym bucketcie. Nie nadano IAM.

Nowe indeksy: `healthDocuments` readers+state i state+indefinite;
`_taskPhotoUploads` state+orphanAfter; `_taskPhotoCleanup` state+nextAttemptAt.
Dotychczasowy indeks czatu pozostaje.

`firebase.json`, SP4 cron `*/10 8-14 * * *` / `0 0-7,15-23 * * *`, wspólny lease,
deduplikacja scheduleTime, szyfrowanie/sesja eduVULCAN, sekrety oraz
`medicineReminders` nie zostały zmienione.

Przyszłe wdrożenie wymaga osobnej akceptacji. Najpierw sprawdzić całość na
oddzielnym projekcie testowym. Nie publikować samych nowych reguł nad starą wersją
produkcyjnego UI, która jeszcze zapisuje zadania bezpośrednio. Skoordynować
aktualizację backendu/UI/reguł/indeksów, wymusić odświeżenie starego PWA, a dopiero
po kontrolach włączyć flagę. Nie wykonywano tego etapu.

## J. Faktycznie wykonane testy

Node.js 22.23.3; build zawiera `tsc -b`. Brak osobnego skryptu lint.

| Zakres | Wynik |
| --- | --- |
| TypeScript + Vite build | PASS; ostrzeżenie o głównym bundle >500 kB, bez błędu kompilacji. |
| Krytyczne transakcje zadań/nagród/zdjęć i prywatność dokumentów | 20/20 PASS |
| Router HTTP i ochrona Origin/Auth | 8/8 PASS |
| Flaga i izolacja emulatorów/Preview | 4/4 PASS |
| Google history/scope/ETag/konflikty | 18/18 PASS |
| Google recurrence/TZ/DST | 9/9 w każdej z UTC, Europe/Warsaw, America/Los_Angeles: 27/27 PASS |
| Helpery nowego kalendarza | 7/7 PASS |
| Helpery zakupów i czatu | 7/7 PASS |
| Istniejące helpery czatu/zdrowia i rzeczywisty upload progress | 6/6 PASS |
| Kontrakty Functions/SP4/nowych jobów | 5/5 PASS |
| Wygenerowane Functions/server vs kanoniczne server | 39 modułów zgodnych |
| Nowe reguły Firestore/Storage | 15/15 PASS w emulatorach |
| Istniejące reguły i regresje prywatności/Auth/Storage | 47/47 PASS w emulatorach |
| Chromium + WebKit: kalendarz/Start/zakupy/czat | 12/12 PASS |
| Chromium + WebKit: formularze zadań/zdrowia, fallback oraz rzeczywisty prywatny query | 4/4 PASS |

Testy używają wyłącznie fikcyjnych kont i lokalnego projektu demo. Testy domenowe
serwera używają kontrolowanych pamięciowych transakcji/Storage, a reguły i
przeglądarki rzeczywistych emulatorów. Nie przeprowadzono zapisu do Google,
produkcji ani portalu szkolnego. Krótkie E2E obejmują rozmiary 390×844, 844×390,
900×1440, 1024×768 i 1440×900; nie stwierdzono poziomego scrolla strony.
To nie jest pełny ponowny audyt wszystkich historycznych testów aplikacji.
Pierwszy przebieg nowych testów formularzy wskazał błędne selektory testowe.
Poprawiono je zgodnie z rzeczywistymi rolami ARIA; końcowy przebieg przechodzi.
Nie zmieniano kodu aplikacji, żeby dopasować go do testów.

Polecenia celowanych testów: `npm run test:server:v2`,
`npm run test:rules:v2`, oraz Playwright z konkretnymi plikami
`calendar-v2.spec.ts`, `shopping-chat-v2.spec.ts`, `family-v2.spec.ts`.

## K. GitHub, Preview i rollback

Zmiany publikowane są wyłącznie na `feature/nasza-rodzina-v2`. `main` pozostaje
bez zmian. Aktualny commit i URL automatycznego Preview zostaną podane w końcowym
raporcie po potwierdzeniu statusu Vercel. Nie scalono zmian i nie wdrożono produkcji.

Rollback kodu: dotychczasowy produkcyjny commit `bb23702950c7c5498ac1a23570f69acf233662db`
pozostaje dostępny na poprzedniej gałęzi. Ponieważ nie zmieniono danych/reguł/sekretów
produkcji, obecny etap nie wymaga rollbacku danych. Przed późniejszym wdrożeniem
reguł należy zachować także aktualne reguły i plan zgodnego rollbacku UI/backendu.

Lista plików poniżej obejmuje kod, konfigurację i testy tego etapu. Wygenerowane
`functions/server/` są odtwarzane przez `npm run functions:prepare` i nie stanowią
drugiego źródła logiki.

## Pliki zmienione i dodane

### Zmienione

- `.env.example`
- `api/calendars/[action].mjs`
- `firestore.indexes.json`
- `firestore.rules`
- `functions/index.mjs`
- `package-lock.json`
- `package.json`
- `server/calendar-google.mjs`
- `server/calendar-service.mjs`
- `server/calendar-storage.mjs`
- `src/app-shared.tsx`
- `src/calendar-series.ts`
- `src/calendar-source-metadata.ts`
- `src/calendar-store.ts`
- `src/calendar-utils.ts`
- `src/calendars/ConnectedCalendarsSettings.tsx`
- `src/calendars/activation-sync.ts`
- `src/calendars/calendar-transport.ts`
- `src/calendars/calendars.css`
- `src/calendars/model.ts`
- `src/features/CalendarPage.tsx`
- `src/features/ChatPage.tsx`
- `src/features/FamilyPage.tsx`
- `src/features/HealthPage.tsx`
- `src/features/ShoppingPage.tsx`
- `src/features/StartPage.tsx`
- `src/features/TasksPage.tsx`
- `src/features/chat-health.css`
- `src/features/shopping-cards.css`
- `src/main.tsx`
- `storage.rules`
- `tests/functions-runtime.test.mjs`
- `tests/security.rules.test.mjs`
- `vercel.json`
- `vite.config.ts`

### Nowe

- `api/family/[action].mjs`
- `docs/NASZA_RODZINA_V2.md`
- `server/family-http.mjs`
- `server/family-v2-policy.mjs`
- `server/health-access.mjs`
- `server/health-reminders.mjs`
- `server/health-service.mjs`
- `server/tasks-photos.mjs`
- `server/tasks-service.mjs`
- `src/CalendarOwnerBadge.tsx`
- `src/calendar-v2.ts`
- `src/calendars/GoogleCalendarV2Controls.tsx`
- `src/calendars/google-occurrences.ts`
- `src/family-v2-client.ts`
- `src/features/ChatMessageReactions.tsx`
- `src/features/ShoppingStorePicker.tsx`
- `src/features/TasksPageV2.tsx`
- `src/features/calendar-v2.css`
- `src/features/chat-state.ts`
- `src/features/shopping-stores.ts`
- `src/features/tasks-upload.ts`
- `src/features/tasks-v2.css`
- `src/features/useChatReadState.ts`
- `src/health/HealthDocumentViewer.tsx`
- `src/health/ProtectedHealthDocuments.tsx`
- `src/health/document-model.ts`
- `src/health/document-pages.ts`
- `src/health/health-api.ts`
- `src/health/health-documents.css`
- `src/health/useCalendarHealthSources.ts`
- `tests/calendar-history-v2.test.mjs`
- `tests/calendar-v2.spec.ts`
- `tests/calendar-v2.test.ts`
- `tests/family-v2-critical.test.mjs`
- `tests/family-v2-http.test.mjs`
- `tests/family-v2-policy.test.mjs`
- `tests/family-v2-test-helpers.mjs`
- `tests/family-v2.spec.ts`
- `tests/google-occurrences-v2.test.ts`
- `tests/shopping-chat-v2.spec.ts`
- `tests/shopping-chat-v2.test.ts`
- `tests/v2-security.rules.test.mjs`
