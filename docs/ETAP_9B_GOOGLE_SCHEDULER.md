# Etap 9B — Google Calendar także przy zamkniętej aplikacji

Zmiana jest przygotowana lokalnie. Nie wykonano deploymentu, konfiguracji chmury, wygenerowania klucza ani zmian w produkcyjnych danych.

## Działanie

Nowa funkcja `googleCalendarHourly` jest Gen2, `europe-west1`, Node.js 22. Cloud Scheduler używa `0 * * * *`, strefy `Europe/Warsaw`: jeden termin na początku każdej godziny, przez całą dobę. Działa niezależnie od otwarcia przeglądarki/PWA. Nie stosuje ograniczenia 08:00–18:00 właściwego dla planowanej integracji Fryderyka.

Scheduler wywołuje istniejące `syncGoogleCalendar`. Nie kopiuje pobierania Google, odszyfrowania, odnawiania tokenów, importu, przenoszenia prywatne/rodzinne, obsługi odwołań ani idempotencji. Nie wysyła zmian do Google i nie używa hasła.

Synchronizowane są wyłącznie potwierdzone, połączone źródła Google w trybie `sync`. Jednorazowy `import`, niepotwierdzony wybór kalendarza, rozłączone źródło, nieaktywny/archiwizowany/wyłączony właściciel albo profil są pomijane. Właściciel autoryzacji musi mieć aktywne konto logowania i aktywnego użytkownika Firebase Auth. Jego status Auth jest sprawdzany raz na uruchomienie dla każdego UID; wyłączone lub usunięte konto nie synchronizuje. Profil docelowy może być dzieckiem bez loginu. Pozostają bieżące uprawnienia wyboru profilu: rodzic może wskazać aktywny profil, inni tylko siebie lub rodzinę.

Zapytanie `_calendarConnections where status == connected`, limit 101, korzysta ze zwykłego indeksu pojedynczego pola. Więcej niż 100 aktywnych źródeł w tej instalacji zatrzymuje wykonanie z bezpiecznym kodem; żadne źródło nie jest wtedy po cichu pomijane z powodu obcięcia zapytania. To limit pracy jednego przebiegu, nie liczby członków rodziny. Nie tworzy się nowego indeksu ani migracji.

## Sloty, lease i ręczne odświeżanie

Termin pochodzi z zaufanego `event.scheduleTime`, jest zapisany jako początek godziny UTC. Oba lokalne 02:00 podczas jesiennej zmiany czasu mają różne znaczniki UTC. Kilkusekundowe opóźnienie nie blokuje następnego terminu, np. 08:00:05 → 09:00:01.

`scheduledCalendarSlotStartMs` jest parametrem kontekstu serwera. Klient nie może dodać go do żądania synchronizacji. `acquireCalendarLease` atomowo sprawdza `lastScheduledSyncSlotAt`, bieżący slot, wcześniejszą próbę/sukces oraz dotychczasowy lease i wersję. Zajęcie lease zapisuje `lastScheduledSyncSlotAt` w tej samej transakcji, przed pierwszym wywołaniem Google. Dwa dostarczenia tego samego lub starszego slotu nie wykonują ponownej próby nawet po błędzie dostawcy.

Ręczna synchronizacja zachowuje wspólny lease i limit 60 sekund. Ręczne odświeżenie w bieżącej godzinie wystarcza dla tego slotu schedulera. Niedawna ręczna próba z końca poprzedniej godziny jest nadal chroniona limitem 60 sekund. Scheduler nie zamienia nieudanej próby w sukces, nie cofa `lastSuccessfulSyncAt` i nie zmienia lokalnego ustawienia prywatności wydarzenia.

Źródła są przetwarzane kolejno. Funkcja ma `maxInstances: 1`, `concurrency: 1`, `minInstances: 0`, `retryCount: 0`, pamięć 256 MiB i limit 540 sekund. Po 425 sekundach nie rozpoczyna kolejnego źródła: zostawia rezerwę 65 sekund w budżecie pracy 490 sekund. Każda synchronizacja nadal ma własny 120-sekundowy lease i istniejący 45-sekundowy limit odczytu dostawcy. Odroczone źródła mają pierwszeństwo w następnym przebiegu; źródło z powtarzającym się błędem nie blokuje pozostałych. Równoległe Vercel/Firebase nie mogą zaimportować tego samego połączenia pod dwoma aktywnymi lease.

Logi zawierają wyłącznie liczby i kody z zamkniętej listy. Nie zawierają UID, nazwy kalendarza, ID źródła, treści prywatnego wydarzenia, tokenu, envelope ani surowego błędu Google/Auth.

## Functions i Vercel Hobby

Dotychczasowe 13 Functions pozostają. Dochodzi wyłącznie `googleCalendarHourly`: łącznie 14. `eduVulcanSchoolHours`, `eduVulcanOffHours`, sekret EDU, szyfrowanie eduVULCAN, `medicineReminders`, `familyMessages`, inbox i reguły pozostają funkcjonalnie bez zmian.

Harmonogram wykonuje się w Firebase Functions, dlatego nie wymaga płatnego harmonogramu Vercel. Bieżący projekt pozostaje na Vercel Hobby. Pakiet Google API jest obsługiwany przez zgrupowany handler; końcowy katalog zawiera zweryfikowane 11 plików API. Samo dodanie tego schedulera nie dodaje endpointu Vercel.

## Wymagana konfiguracja przed przyszłym wdrożeniem

Blaze jest wymagany dla harmonogramów Firebase, zgodnie z już używaną architekturą. Brak nowych wartości nie blokuje zwykłych ekranów aplikacji; Google pozostaje niekonfigurowane. Deployment nowej funkcji nie powinien być wykonywany przed przygotowaniem konfiguracji i osobną zgodą użytkownika.

### Te same wartości dla Vercel i Google Cloud

| Nazwa | Typ w Firebase Functions | Ustawienie |
|---|---|---|
| `CALENDAR_ENCRYPTION_KEY_BASE64` | Secret Manager / `defineSecret` | Osobny klucz AES-256 dla kalendarzy, dokładnie ta sama wartość co Vercel Production. Nie używać ani nie zmieniać klucza eduVULCAN. |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Secret Manager / `defineSecret` | Sekret webowego klienta OAuth Google użytego przez Vercel. |
| `GOOGLE_CALENDAR_CLIENT_ID` | `defineString`, domyślnie pusty | ID tego samego klienta OAuth. |
| `CALENDAR_SITE_ORIGIN` | `defineString`, domyślnie pusty | Stały HTTPS origin aplikacji; ten sam co Vercel. |
| `CALENDAR_ENCRYPTION_KEY_ID` | `defineString`, domyślnie `v1` | Ten sam identyfikator osobnego klucza kalendarzy co Vercel. |

Sekretów nie zapisuje się w repozytorium, przykładzie środowiska, Functions source ani logach. Parametry tekstowe podaje się Firebase CLI przy przygotowaniu konfiguracji lokalnej środowiska wdrożeniowego; prywatne pliki `.env*` pozostają ignorowane. Obie deklaracje `defineSecret` tylko wiążą istniejące sekrety z nową funkcją; nie generują ich i nie rotują. `EDUVULCAN_ENCRYPTION_KEY_BASE64` i `EDUVULCAN_ENCRYPTION_KEY_ID` nie są używane przez Google Calendar i nie wymagają zmiany.

### Google Cloud/Firebase

- Włączona Google Calendar API, skonfigurowany ekran zgody OAuth i webowy klient z callbackiem `https://<stały-origin>/api/calendars/callback`. Zakres tylko do odczytu Calendar; brak operacji zapisu do Google. Uwaga na tryb Testing i czas ważności refresh tokenów opisany w audycie OAuth.
- Aktywne API obecnych Gen2 Functions: Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Eventarc, Firestore, Cloud Scheduler i Secret Manager. Istniejące harmonogramy korzystają już z tej infrastruktury; nie włączono tu żadnego API.
- Runtime service account wymaga `roles/secretmanager.secretAccessor` na KAŻDYM z dwóch nowych sekretów kalendarzy. Uprawnienie do sekretu eduVULCAN nie wystarcza dla nowej nazwy sekretu.
- Ten sam runtime wymaga dotychczasowego dostępu Firestore i uprawnienia `firebaseauth.users.get`, np. projektowej roli `roles/firebaseauth.viewer`, aby odrzucać wyłączone/usunięte konto OAuth. Nie potrzeba uprawnień tworzenia/usuwania użytkowników Auth.
- Konto Scheduler i standardowe service agents korzystają z dotychczasowego procesu Firebase Gen2. Nie nadano żadnych ról ręcznie w tym etapie.

Nowy Cloud Scheduler job jest tworzony dopiero podczas zatwierdzonego deploymentu `googleCalendarHourly`. Nie opublikowano reguł Firestore/Storage, Hostingu ani indeksów.

## Koszty i ograniczenia

Jeden harmonogram daje około 720 wywołań miesięcznie. Scheduler, CPU/pamięć podczas pracy Functions, Firestore odczyty/zapisy i ewentualny transfer mogą generować koszty. Przy jednej niewielkiej rodzinie spodziewany ruch jest mały, ale rozbudowany kalendarz cykliczny i błędy dostawcy zwiększają czas/odczyty. Zero minimalnych instancji zapobiega utrzymywaniu stale aktywnego procesu. Standardowe darmowe limity zależą od całego konta rozliczeniowego; istnieją już trzy joby (dwa EDU i leki), więc dodatkowy job może być płatny po wykorzystaniu limitu. Ten dokument nie gwarantuje zerowego kosztu.

Nie można zagwarantować nieograniczonego działania tokenu Google: rzeczywiste cofnięcie zgody, zmiana uprawnień i ograniczenia OAuth mogą wymagać ponownego połączenia. Nie próbuje się logowania hasłem ani omijania MFA/CAPTCHA. Lokalny błąd odszyfrowania jest raportowany jako `CALENDAR_DECRYPT_FAILED`; sam w sobie nie dowodzi cofnięcia zgody Google i nie może usuwać istniejącego ciphertext, statusu ani kursora poprawnego połączenia Vercel. Ochronę tę realizuje wspólny backend, nie odrębna implementacja schedulera.

## Przygotowane testy i pliki

`tests/calendar-scheduler.test.mjs`: 21 testów (harmonogram, jitter, oba DST, brak konfiguracji, wspólny rzeczywisty import i stabilne ID, deduplikacja, współbieżny manual/scheduler, rate limit, nieudana próba, wygasła autoryzacja, członkostwo, Firebase Auth disabled/deleted, bierny profil, tryb import, limit źródeł, sprawiedliwy budżet, reconnect i poufność logów, odrębny bezpieczny kod błędu odszyfrowania). Testy używają wyłącznie syntetycznych danych i pamięciowej transakcyjnej bazy; nie kontaktują się z Google ani produkcją. `tests/functions-runtime.test.mjs` sprawdza rzeczywiste metadane SDK Gen2, region, nowe sekrety, 14 eksportów i niezmienione EDU/leki/czat.

Zmiany schedulera: nowe `server/calendar-scheduler.mjs`, nowe testy i ten dokument, mały delta `server/calendar-storage.mjs`, `functions/index.mjs`, `tests/functions-runtime.test.mjs`, dodanie testu do `test:functions` w `package.json`. Kopie `functions/server/` generuje istniejący skrypt z kanonicznych `server/`; nie utrzymuje się drugiej implementacji.

## Końcowa weryfikacja po scaleniu

Node.js 22.23.3, lokalny projekt emulatorowy `demo-nasza-rodzina`. Testy nie używają produkcyjnych danych ani rzeczywistego OAuth Google.

| Kontrola | Wynik |
| --- | --- |
| Build i TypeScript | PASS; istniejące ostrzeżenie Vite o rozmiarze głównego bundla |
| Unit | 189/189 PASS |
| Server | 421/421 PASS |
| Functions | 76/76 PASS |
| Firestore/Storage Rules | 47/47 PASS |
| Integracje emulatorowe | 28/28 PASS: 22 eduVULCAN/powiadomień + 6 Google Calendar |
| Pełne E2E Chromium | 152/152 PASS |
| Pełne E2E WebKit | 152/152 PASS |
| Wygenerowane `functions/server/` | PASS, 32 moduły zgodne z kanonicznym `server/` |

Pełna regresja E2E zakończyła się w jednym przebiegu: 304/304 PASS. Sprawdza pięć rozmiarów, prywatność, profile, Start, czat, upload Zdrowia, Szkołę/SP4, kalendarz i Google settings. Nie wykryto poziomego przepełnienia całej strony w badanych widokach. Nie zastępuje to testu rzeczywistej zgody OAuth i uruchomienia schedulera w skonfigurowanej chmurze.

Sześć nowych rzeczywistych testów Auth/Firestore obejmuje idempotentny import, zapis slotu przy lease, scheduler/manual, przenoszenie prywatne/rodzinne z zachowaniem override, rozłączenie usuwające tylko własne źródło i odmowę nieaktywnego profilu. Testy pamięciowe dodatkowo pokrywają pełną logikę providera i zmian czasu.

Przy integracji sprawdzono ścisły wybór akcji z surowej ścieżki `/api/calendars/...`: sprzeczny parametr `action` nie przełącza handlera przed autoryzacją. Odwołane wydarzenia zewnętrzne pozostają w kalendarzu, ale nie opóźniają kafla „Rodzinny czas”; potwierdzają to dwa testy jednostkowe.

Podglądy panelu na syntetycznych danych, bez wykonanej prawdziwej autoryzacji:

- [Telefon pionowo](../preview/stage-9/google-calendar-settings-phone-portrait.png)
- [Tablet poziomo](../preview/stage-9/google-calendar-settings-tablet-landscape.png)
