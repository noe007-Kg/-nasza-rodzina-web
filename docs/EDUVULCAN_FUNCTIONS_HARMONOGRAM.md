# eduVULCAN — Firebase Functions i harmonogram Europe/Warsaw

Aktualny etap rozwija istniejący projekt Nasza Rodzina 1.6.0. Na późniejsze zlecenie użytkownika przygotowano serwerową synchronizację także przy zamkniętej aplikacji oraz triggery inbox. **Nie wykonano `git commit`, `git push`, deploymentu Vercel/Functions ani publikacji reguł Firebase. Nie zapisano i nie zmieniono wartości żadnego sekretu.**

Poprzedni [raport pakietu IN-APP](PAKIET_1.6.0_RAPORT.md) i [instrukcja IN-APP](POWIADOMIENIA_IN_APP_1.6.0.md) opisują wcześniejszy etap bez Functions. Dla tego harmonogramu **Blaze: TAK; Firebase Functions: TAK**. Dostarczanie powiadomień pozostaje **IN-APP**; systemowe FCM/Web Push nie są włączane.

## Harmonogram

| Zadanie | Cron | Strefa | Polityka synchronizacji połączenia |
|---|---|---|---|
| Dzienny — `eduVulcanSchoolHours` | `*/10 8-14 * * *` | `Europe/Warsaw` | 08:00, 08:10, …, 14:50; jeden import na osobny logiczny slot, ze wspólnym lease i dotychczasowymi zabezpieczeniami |
| Wieczór/noc — `eduVulcanOffHours` | `0 0-7,15-23 * * *` | `Europe/Warsaw` | 15:00, 16:00, …, 07:00; nie częściej niż co 60 rzeczywistych minut |
| Leki, istniejące | `every 5 minutes` | `Europe/Warsaw` | Dotychczasowe `medicineReminders` |

15:00 należy wyłącznie do zadania godzinnego, a 08:00 wyłącznie do dziennego. W zwykłej 24-godzinnej dobie są **42 + 17 = 59 wywołania harmonogramu eduVULCAN**, zamiast 144 wywołań przy zadaniu co 10 minut całą dobę. Nie każde wywołanie pobiera dziennik: ważność sesji, czas startu poprzedniej próby i lease mogą spowodować pominięcie. Jeśli poprzednia synchronizacja rozpoczęła się o 14:50, tick 15:00 jest pomijany przez godzinny limit; kolejne dopuszczalne pobranie może nastąpić o 16:00.

Harmonogram działa w chmurze, niezależnie od otwartej strony, **dopiero po przyszłym wdrożeniu Functions i konfiguracji sekretu**. Samo lokalne przygotowanie plików go nie uruchamia. Zachowano dotychczasowe sprawdzenie po starcie/foreground aplikacji i przycisk „Synchronizuj teraz”; nie dodano frontendowego odpytywania w tle.

### Zmiana czasu i opóźnione wywołania

Godziny okien wyznacza `Intl.DateTimeFormat` z `Europe/Warsaw`. Dzienne sloty mają jednoznaczny czas UTC, a nocny limit częstotliwości nadal jest sprawdzany na rzeczywistym czasie UTC w transakcji Firestore. Powtórzona jesienna godzina nie pozwala ominąć 60-minutowego limitu, a brakująca wiosenna godzina nie wymusza dodatkowego pobrania. Różnica CET/CEST nie jest wpisana na stałe.

Cloud Scheduler używa lokalnego czasu ściennego; w dniu zmiany czasu sam cron może pominąć lub powtórzyć lokalny tick. Atomowy limit oraz lease chronią przed zbyt częstym lub równoległym pobraniem, lecz nie zmieniają harmonogramu dostawcy w gwarancję dokładnie jednego wywołania w każdej godzinie. Dla opóźnionego/retry wywołania używany jest ostrożniejszy z limitów wynikających z czasu zaplanowania i rzeczywistego wykonania, więc stary tick dzienny nie wymusi nocą pobrania co 10 minut.

## Jeden mechanizm synchronizacji

`server/edu-scheduler.mjs` wyłącznie przygotowuje autoryzowany kontekst istniejącego połączenia i wywołuje **`syncAction` z `server/edu-service.mjs`**. Nie powstała druga implementacja dostępu do portalu, logowania, wyboru ucznia, normalizacji ani zapisu danych.

Wspólne połączenie rodziców zachowuje ten sam dokument, scope, aktywnego uprawnionego rodzica i istniejący wybór ucznia. Nie jest tworzona druga sesja dla Sebastiana/Dominiki ani automatycznie wybierany pierwszy profil przedszkola. Istniejące uprawnione połączenia uczniów pozostają ograniczone do własnego zatwierdzonego zakresu; nie udostępnia się im sesji rodzica.

`acquireSyncLease` atomowo sprawdza ten sam dokument połączenia i blokuje konkurencyjne pobrania z Vercel, Functions oraz retry. W godzinach szkolnych termin jest wyliczany z zaufanego `scheduleTime` Cloud Scheduler i zapisywany jako `lastScheduledSchoolSlotAt` w tej samej transakcji co lease. Termin równy lub starszy od zapisanego jest pomijany także po upływie 10 minut; nowy termin nie wymaga pełnych 10 minut od rzeczywistego startu poprzedniego. Dlatego wykonania 08:00:05 i 08:10:01 mogą obsłużyć oba prawidłowe sloty. Nieudana próba także zajmuje swój slot; powtórka czeka na kolejny termin zamiast ponownie pobierać dane.

Ręczna lub starsza synchronizacja rozpoczęta już w danym slocie również zapobiega ponownemu importowi tego terminu: sprawdzany jest `lastSyncAttemptAt`, z `lastSuccessfulSyncAt` jako fallback tylko przy braku poprawnego czasu próby. Dotychczasowe pięć minut po sukcesie i 30 sekund po próbie nadal obowiązują. Nocą pozostaje niezmieniony ścisły odstęp 60 minut od startu ostatniej próby. Sloty dzienne nie obchodzą go po 15:00, także przy opóźnionym dostarczeniu zadania 14:50. Wynik można zapisać tylko dla bieżącego lease i wersji sesji; stara funkcja nie nadpisze nowo połączonego konta.

Nowy znacznik jest wewnętrznym polem istniejącego `_eduConnections`; nie wymaga migracji, nowych reguł ani zmiennych środowiskowych. Ponowne połączenie i rzeczywista zmiana wybranego ucznia resetują znacznik razem z właściwymi metadanymi synchronizacji. Nazwy sekretów, szyfrowanie, limit sesji, powiadomienia, przypomnienia leków i harmonogram poza godzinami szkolnymi pozostają bez zmian.

Dotychczasowy frontendowy próg automatycznej aktywacji nadal wynosi 60 minut **od ostatniej udanej** synchronizacji. To osobna polityka UI; zmiana kadencji serwerowego harmonogramu nie zmienia przycisku ani tego progu.

Funkcje eduVULCAN działają w regionie `europe-west1` i mają `minInstances: 0`, `maxInstances: 1`, `concurrency: 1`, pamięć `256MiB` oraz timeout 110 sekund, krótszy od istniejącego lease 120 sekund. Dla obu cronów ustawiono `retryCount: 0`; następny tick zastępuje agresywne ponawianie błędnego połączenia. Połączenia są obsługiwane kolejno i w ograniczonym zakresie. Cały przebieg ma dodatkowy budżet 100 sekund; po przekroczeniu 50 sekund od startu nie zaczyna następnego pobrania portalu, które samo ma ograniczenie 50 sekund. Pozostałe połączenia są bezpiecznie pomijane z kodem `EDU_SCHEDULE_BUDGET` do kolejnego ticka, bez przejmowania ich lease. To nie obiecuje obsłużenia dowolnie dużej rodziny w jednym wywołaniu. Ograniczenie instancji jest dodatkowe: właściwą ochroną między dwoma cronami i Vercel pozostaje atomowy lease, nie sama konfiguracja liczby instancji.

## Sesja, błędy i sekrety

Harmonogram wymaga wyłącznie istniejącej **zaszyfrowanej sesji**, nigdy loginu ani hasła. Nie wywołuje `connectAction` ani logowania hasłem po wygaśnięciu. Nie zmienia `EDUVULCAN_ENCRYPTION_KEY_BASE64`, formatu szyfrowania, AAD, istniejącego key ID ani UID użytkowników.

Po potwierdzonym wygaśnięciu/odrzuceniu sesji zapisuje **`reconnectRequired: true`**, bezpieczny `lastErrorCode` oraz wygasły czas sesji; istniejący status UI pokazuje wygaśnięcie i wymóg ponownego połączenia przez rodzica. Nie tworzy nowej właściwości zapisanej `state: needs_reconnect`. Usunięcie nieużywalnej zaszyfrowanej koperty jest chronione bieżącą wersją sesji i lease, aby stary request nie skasował nowego połączenia. Harmonogram pomija stan wymagający ponownego połączenia. Błędy oraz podsumowania nie zawierają hasła, cookies, tokenu, treści wiadomości ani szczegółów ocen.

Istniejący maksymalny czas sesji (domyślnie do 24 godzin) nie został wydłużony. Harmonogram nie zapewnia bezterminowej pracy bez ponownego połączenia; rodzic musi zrobić to dotychczasowym formularzem po jej wygaśnięciu. Brak klucza, zły key ID lub błąd konfiguracji nie uruchamia awaryjnego logowania hasłem.

### Konfiguracja Functions po osobnej akceptacji

| Nazwa | Sposób konfiguracji | Wartość i wymóg |
|---|---|---|
| `EDUVULCAN_ENCRYPTION_KEY_BASE64` | Binding Firebase Functions → Secret Manager | **Dokładnie istniejąca wartość z Vercel**, bez generowania/rotacji; wymagane do odczytu obecnych sesji |
| `EDUVULCAN_ENCRYPTION_KEY_ID` | Serwerowa zmienna środowiskowa Functions, jeśli obecnie ustawiona | **Dokładnie istniejące ID**; dotychczasowy brak oznacza `v1` |
| Pozostałe istniejące ustawienia eduVULCAN, np. TTL | Serwerowa konfiguracja Functions, jeżeli użyto wartości innych niż domyślne | Zachować zgodność z Vercel i obecnymi limitami; nie wymagają nowego hasła ani tokenu |
| Firebase Admin | Zarządzana tożsamość serwisowa projektu | Nie dodawać JSON service-account ani prywatnego klucza do kodu |
| `VITE_FIREBASE_VAPID_KEY` | Opcjonalne, nieaktywne przygotowanie | Nie jest wymagane przez harmonogram, inbox, logowanie ani build |

**Zmienne Vercel nie są automatycznie dostępne w Firebase Functions.** Powyższe oznacza przyszłe bezpieczne udostępnienie istniejącej konfiguracji innemu środowisku, a nie zmianę wartości sekretów wykonaną w tej pracy. Nie zamieszczaj wartości w repozytorium, `.env` paczki, dokumentacji ani czacie. Google Auth i jego istniejące zmienne pozostają bez zmian.

## Powiadomienia i prywatność

- **`familyMessages`**: trigger utworzenia dokumentu generuje wpis inbox od razu po nowej wiadomości, bez czekania na polling czy kolejny sync. Zapis własnej wiadomości nie alarmuje nadawcy; prywatna rozmowa trafia wyłącznie do uczestników. „Natychmiast” oznacza zdarzeniowy trigger po zapisie Firestore, z normalnym opóźnieniem usługi i możliwością retry, a nie gwarantowany czas dostarczenia.
- **`schoolItems`, `schoolParentMessages`, `schoolStudentMessages`**: powiadomienie powstaje dopiero po semantycznej zmianie danych. `syncedAt`, `updatedAt`, techniczny identyfikator importu i potwierdzenie odczytu nie są nową informacją. Import współdzieli kanoniczny dziennik/baseline z triggerami; ten sam alert nie powstaje drugi raz.
- **Baseline**: pierwsza faktycznie odczytana sekcja historii pozostaje cicha; poprawna pusta lista inicjalizuje baseline, nieudana sekcja nie. Przesunięcie zakresu dat pobranego planu nie tworzy serii fałszywych nowych lekcji.
- **Deduplikacja**: deterministyczne ID zdarzeń i inbox, transakcje oraz istniejący trwały dziennik chronią także przy retry/dostarczeniu at-least-once. Powtórna synchronizacja bez realnej zmiany tworzy zero alertów.
- **Prywatność**: role, związki rodzic–dziecko, uczestnicy rozmowy, aktywność członka i preferencje są sprawdzane po stronie backendu. Dziecko nie dostaje wiadomości rodzica/nauczyciela ani ich prywatnej treści. Klient nie może dowolnie tworzyć `notificationInbox`.
- **`medicineReminders`**: harmonogram co 5 minut pozostaje; nie przekształcono go w polling eduVULCAN. Powiadomienie leku także pozostaje wpisem IN-APP.

Dzwonek, licznik, centrum, ★ i dźwięk foreground pozostają. **Nie uruchomiono FCM, wysyłania `_notificationOutbox`, rejestracji tokenów, systemowej zgody ani Web Push.** Przy zamkniętej aplikacji wpis może powstać w Firestore, ale nie pojawi się systemowy alert i dźwięk. Nie dodano drugiego service workera.

## firebase.json i pakowanie

Przywrócono aktywny `functions` codebase:

```json
{
  "source": "functions",
  "codebase": "nasza-rodzina",
  "runtime": "nodejs22",
  "predeploy": ["node \"$PROJECT_DIR/scripts/prepare-functions.mjs\""]
}
```

Istniejące sekcje Firestore, indeksów, Storage, Hosting i emulatorów pozostają. Reguł nie otwierano dla klienta. Konfiguracja celowo nie publikuje niczego sama.

Firebase pakuje tylko źródło `functions/`. Dlatego `scripts/prepare-functions.mjs` przygotowuje wygenerowane `functions/server/*.mjs` z kanonicznych `server/*.mjs`, sprawdza komplet importów i manifest hashy. Vercel nadal importuje kanoniczny `server/`; oba środowiska wykorzystują te same pliki źródłowe. Nie edytuj wygenerowanego katalogu ręcznie.

Lokalne sprawdzenie bez deploymentu:

```bash
npm ci --prefix functions
npm run build --prefix functions
npm run check --prefix functions
npm run build
npm run test:unit
npm run test:server
npm run test:rules
```

## Blaze i wymagane API

**Blaze jest wymagany** do wdrożenia tych Functions 2. generacji i harmonogramu. Dwa zadania ograniczają wywołania eduVULCAN; nie oznacza to gwarancji zerowego rachunku. Nadal działają co 5 minut przypomnienia leków i triggery zdarzeń, a koszty zależą od rzeczywistej liczby wywołań, odczytów, zapisów i czasu działania. W tej pracy nie zmieniono planu rozliczeniowego.

| Usługa | API | Cel |
|---|---|---|
| Cloud Functions | `cloudfunctions.googleapis.com` | Zarządzanie Functions 2. generacji |
| Cloud Run | `run.googleapis.com` | Uruchomienie funkcji 2. generacji |
| Cloud Build | `cloudbuild.googleapis.com` | Budowanie źródeł Functions |
| Artifact Registry | `artifactregistry.googleapis.com` | Obrazy wdrożonych funkcji |
| Eventarc | `eventarc.googleapis.com` | Zdarzeniowe triggery Firestore |
| Pub/Sub | `pubsub.googleapis.com` | Transport używany przez infrastrukturę triggerów |
| Cloud Scheduler | `cloudscheduler.googleapis.com` | Dwa crony eduVULCAN i zachowany harmonogram leków |
| Cloud Firestore | `firestore.googleapis.com` | Istniejące dane, lease, baseline, dziennik i inbox |
| Secret Manager | `secretmanager.googleapis.com` | Binding istniejącego klucza szyfrowania |
| Cloud Storage | `storage.googleapis.com` | Archiwa źródeł wymagane przez proces budowania/wdrażania Functions; niezależnie od istniejących plików aplikacji |
| IAM | `iam.googleapis.com` | Konfiguracja tożsamości uruchomieniowej i sprawdzenie `serviceAccounts.actAs` przy przyszłym wdrożeniu |
| Cloud Logging | `logging.googleapis.com` | Bezpieczne logi platformy i podsumowania |

Pozostają dotychczasowe Firebase Authentication (`identitytoolkit.googleapis.com`) oraz Storage/Google Cloud Storage dla istniejących funkcji aplikacji; ten harmonogram nie wprowadza nowego providera Auth ani nowego bucketu danych rodziny. Infrastruktura Functions może natomiast przygotować własny bucket archiwów źródeł podczas przyszłego wdrożenia. `serviceusage.googleapis.com` jest potrzebne narzędziom administracyjnym do włączania wymaganych API. Monitoring (`monitoring.googleapis.com`) można zachować dla metryk i alertów; nie jest nową logiką aplikacji. **FCM (`fcm.googleapis.com`) nie jest wymagane przez bieżący tryb IN-APP.** Nie używamy task queue, więc `cloudtasks.googleapis.com` nie jest wymagane przez tę implementację. Część API jest zwykle włączana automatycznie przez przyszłe wdrożenie Firebase CLI; musi to mieć odpowiednie uprawnienia projektu. W tej pracy żadnego API ani polityki IAM nie zmieniono.

Źródła dostawców: [planowanie Functions](https://firebase.google.com/docs/functions/schedule-functions), [Secret Manager i konfiguracja Functions](https://firebase.google.com/docs/functions/config-env), [cron, strefy i DST Cloud Scheduler](https://cloud.google.com/scheduler/docs/configuring/cron-job-schedules).

## Zmienione i nowe pliki

Lista względem projektu przed bieżącym zleceniem: **18 zmienionych i 10 nowych plików źródłowych; 0 usuniętych**. Nie obejmuje wygenerowanych artefaktów `functions/server/`, cache, `node_modules` ani sekretów. `functions/server/` jest odtwarzany z kanonicznego kodu przez opisany generator.

<!-- SCHEDULED_FILES_START -->
### Zmienione pliki

| Plik | Zmiana |
|---|---|
| [README.md](../README.md) | Aktualny tryb harmonogramu, wymaganie Blaze/Functions i brak systemowego push |
| [docs/FIREBASE.md](FIREBASE.md) | Aktualna instrukcja konfiguracji i odsyłacz do raportu |
| [docs/NOTIFICATIONS.md](NOTIFICATIONS.md) | Triggery inbox, harmonogram, prywatność i zachowany dźwięk IN-APP |
| [docs/PAKIET_1.6.0_RAPORT.md](PAKIET_1.6.0_RAPORT.md) | Wyłącznie notice historycznego etapu; dawne listy/wyniki pozostają |
| [docs/POWIADOMIENIA_IN_APP_1.6.0.md](POWIADOMIENIA_IN_APP_1.6.0.md) | Notice historycznego etapu bez Functions |
| [firebase.json](../firebase.json) | Aktywny codebase Functions Node 22 i predeploy generator; istniejące reguły/emulatory zachowane |
| [functions/README.md](../functions/README.md) | Lokalny build, wspólne źródła i istniejący klucz sesji |
| [functions/index.mjs](../functions/index.mjs) | Dwa crony eduVULCAN, natychmiastowy chat, wspólny journal szkolny; wyłączona ścieżka FCM |
| [functions/notification-events.mjs](../functions/notification-events.mjs) | Cienki eksport kanonicznych helperów serwera zamiast osobnej logiki |
| [functions/package-lock.json](../functions/package-lock.json) | Lockfile zgodny z zależnościami wspólnego serwera |
| [functions/package.json](../functions/package.json) | Zależności adaptera i skrypty lokalnego build/check |
| [package.json](../package.json) | Przygotowanie Functions przed testami serwera i skrypt `test:functions` |
| [server/edu-service.mjs](../server/edu-service.mjs) | Zachowany wspólny `syncAction` z bezpiecznym stanem wygaśnięcia i limitem pobrania |
| [server/edu-storage.mjs](../server/edu-storage.mjs) | Atomowy limit startów 10/60 minut, istniejący lease oraz chroniony stan reconnect |
| [server/notification-inbox.mjs](../server/notification-inbox.mjs) | Wspólny idempotentny zapis inbox i ponowna kontrola źródła/uprawnień |
| [server/school-notifications.mjs](../server/school-notifications.mjs) | Wspólny dziennik zmian, deduplikacja i ochrona odbiorców szkolnych |
| [tests/README.md](../tests/README.md) | Aktualne polecenia i zakres testów Functions/emulatorów |
| [tests/edu-scope-storage.test.mjs](../tests/edu-scope-storage.test.mjs) | Regresje atomowego limitu, lease i bezpiecznej sesji |

### Nowe pliki

| Plik | Cel |
|---|---|
| [docs/EDUVULCAN_FUNCTIONS_HARMONOGRAM.md](EDUVULCAN_FUNCTIONS_HARMONOGRAM.md) | Bieżący raport, konfiguracja, pliki, API i wyniki |
| [functions/.gitignore](../functions/.gitignore) | Wykluczenie wygenerowanego `/server/` i `/.server-staging/` z przyszłych zapisów Git; artefakt nadal może być pakowany przez Firebase predeploy |
| [functions/notification-triggers.mjs](../functions/notification-triggers.mjs) | Orkiestracja kanonicznych eventów i szkolnego journal, bez drugiej logiki sync |
| [scripts/prepare-functions.mjs](../scripts/prepare-functions.mjs) | Deterministyczne przygotowanie źródeł Functions i sprawdzenie importów/hashów |
| [server/edu-scheduler.mjs](../server/edu-scheduler.mjs) | Polityka Warsaw/DST, uprawniony kontekst i wywołanie istniejącego sync |
| [tests/edu-functions-package.test.mjs](../tests/edu-functions-package.test.mjs) | Pakowanie, zależności, czyste źródła i zachowanie konfiguracji Firebase |
| [tests/edu-scheduler.integration.mjs](../tests/edu-scheduler.integration.mjs) | Prawdziwe lokalne transakcje, sesje, lease, baseline i SDK trigger czatu |
| [tests/edu-scheduler.test.mjs](../tests/edu-scheduler.test.mjs) | Crony, DST, kadencja od startu, retry, autoryzacja i wygaśnięcie |
| [tests/functions-runtime.test.mjs](../tests/functions-runtime.test.mjs) | Kontrakty rzeczywistych eksportów Firebase Functions SDK |
| [tests/notification-functions.test.mjs](../tests/notification-functions.test.mjs) | Natychmiastowy chat, semantyczne zmiany szkolne, deduplikacja i prywatność |
<!-- SCHEDULED_FILES_END -->

**Nie zmieniono:** `firestore.rules`, `storage.rules`, `firestore.indexes.json`, kanonicznego `server/edu-secrets.mjs`, wartości kluczy, `.env.example`, Google Auth, UID ani kodu frontendowego. Wymaganie Functions dotyczy nowego procesu serwerowego, a nie zmiany rodzinnych uprawnień.

## Wyniki weryfikacji tego etapu

Nie przenosimy wyników poprzedniego pakietu 1.6.0 jako wyników tej zmiany.

<!-- SCHEDULED_TESTS_START -->
| Sprawdzenie | Wynik bieżącego etapu |
|---|---|
| `npm run build` | **PASS** — TypeScript i Vite; zachowane ostrzeżenie Vite o wielkości głównego pakietu |
| `npm run test:unit` | **PASS — 68/68**, 8 plików |
| `npm run test:server` | **PASS — 239/239**, 17 plików |
| `npm run test:functions` | **PASS — 42/42**, 4 pliki: 16 scheduler + 8 pakowanie + 15 triggery + 3 kontrakty SDK |
| `npm ci --prefix functions` | **PASS**, lockfile i instalacja zależności Functions zgodne |
| Przygotowanie i sprawdzenie `functions/server/` | **PASS**, generowane moduły zgodne z kanonicznym źródłem |
| `npm run test:rules` | **PASS — 22/22** |
| Celowane Playwright: eduVULCAN, aktywacja i powiadomienia | **PASS — 44/44**, 22 Chromium + 22 WebKit, około 4,5 min |
| Dodatkowa integracja Auth/Firestore/Storage po ostatniej zmianie kadencji | **PASS — 12/12**, istniejące testy eduVULCAN/IN-APP i nowy scheduler + rzeczywisty eksport `notifyChat.run` |
<!-- SCHEDULED_TESTS_END -->

**Końcowy wynik tego etapu: PASS, 0 FAIL.** Build i wszystkie zestawy zakończyły się kodem 0. W tym etapie uruchomiono 44 powiązane scenariusze przeglądarkowe, nie cały historyczny zestaw 150. Kod frontendowy nie został zmieniony. Liczby unit/server/Functions pochodzą z dodatkowych przebiegów szczegółowych odpowiadających skryptom, ponieważ Node w domyślnej izolacji raportuje liczbę plików. Testy wykonano lokalnie na Node.js 24; produkcyjny runtime Functions w konfiguracji to Node.js 22. Nie uruchamiano produkcyjnej funkcji ani Cloud Scheduler.

Testy obejmują okna 08:00–15:00 i nocne, 10/60 minut, `Europe/Warsaw` i DST, opóźnione/retry wywołania, atomową konkurencję tego samego połączenia, wygaśnięcie sesji, baseline/deduplikację oraz trigger nowej wiadomości rodzinnej. Weryfikacja lokalna nie uruchamia prawdziwego Cloud Scheduler ani konta eduVULCAN rodziny. Nie potwierdza przyszłego wdrożenia, IAM/API ani rzeczywistego czasu dostarczenia Eventarc.

## Ograniczenia i zakończenie etapu

Harmonogram nie będzie działał produkcyjnie, dopóki po osobnej zgodzie nie zostaną skonfigurowane istniejący sekret i Functions. Po wygaśnięciu sesji konieczne jest ponowne połączenie przez rodzica. Limit istniejącej sesji, możliwości portalu oraz ograniczenia źródeł pozaszkolnych pozostają. Systemowe powiadomienia przy zamkniętej aplikacji nie są częścią tego zlecenia.

**Nie wykonano commit, push, deploymentu ani zmian sekretów.** Praca kończy się raportem i plikami do przeglądu.
