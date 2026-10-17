# Zadania i Nagrody — raport przed zmianą produkcji

Stan prac: 17.10.2026. Baza wskazana przez właściciela jako produkcyjna: `1c9dee87d283628861f3b49488f61f313bc85f89`. Osobna gałąź: `feature/tasks-rewards-readiness-20261017`. Nie modyfikowano `main`, danych Firebase ani konfiguracji chmurowej. Nie wykonano migracji 236 zmian, publikowania reguł, Functions ani wdrożenia Vercel.

**GOTOWE DO ODBLOKOWANIA PRODUKCYJNYCH ZAPISÓW: NIE.** Kod i testy lokalne nie zastępują dowodów kopii, odtworzenia ani rzeczywiście wdrożonych reguł. Środowisko tej pracy nie ma skonfigurowanej tożsamości Google Cloud ani dostępu do prywatnych dowodów produkcyjnych. Nie sprawdzono wartości produkcyjnych zmiennych środowiskowych.

## Przyczyna blokady i zakres poprawki

Dotychczas `FAMILY_V2_WRITES_ENABLED` sterował jednocześnie Zadaniami, Zdrowiem i Finansami. Jego włączenie nie jest bezpiecznym sposobem wydania samego modułu Zadań. Ponadto `sameFamily()` uznawał rekord bez `familyId` za dostępny niezależnie od gospodarstwa, Firestore pozwalał wszystkim aktywnym członkom czytać zadania, a Storage akceptował porównanie brakującego identyfikatora z brakującym identyfikatorem. Salda oparte tylko na kluczu osoby mogły kolidować między gospodarstwami.

Przygotowano wyłącznie konieczne zmiany Zadań i ich powiązań:

- Oddzielny serwerowy `FAMILY_TASKS_WRITES_ENABLED`, domyślnie wyłączony. Stary globalny przełącznik sam nie otwiera Zadań. Nowy przełącznik nie otwiera Zdrowia ani Finansów. Preview nadal bezwarunkowo odmawia nowych zapisów.
- API, Firestore, Storage, zapytania klienta oraz powiadomienia Zadań wymagają zgodnego, jawnego `familyId`. Brak pola, pusty identyfikator oraz `__legacy__` nie oznaczają wspólnego gospodarstwa. Nie przypisuje się dokumentów po imieniu.
- Dwoje aktywnych rodziców tego samego gospodarstwa może zarządzać zadaniami i nagrodami. Dziecko i zwykły dorosły odczytują i zgłaszają własne lub rodzinne zadania, bez prawa zatwierdzania punktów. Profil bez logowania pozostaje możliwym adresatem zadania; nie otrzymuje możliwości logowania.
- Salda i oczekujące wymiany mają klucze uwzględniające gospodarstwo. Jednoznacznie powiązane starsze salda i pending-ID pozostają obsługiwane pod dotychczasowymi identyfikatorami. Sprzecznych lub nieprzypisanych danych nie przejmuje się automatycznie.
- Księgowanie pozostaje transakcyjne: jedno ukończenie i deterministyczny wpis historii na zadanie; jedna prośba oczekująca o daną nagrodę i jeden wydatek na zatwierdzoną prośbę. Koszt jest utrwalony przy zgłoszeniu. Brak środków lub odmowa nie zmieniają salda. Nieprawidłowe koszty, salda i przepełnienie bezpiecznej liczby całkowitej są odrzucane.
- Zdjęcie wykonania wymaga ważnego ticketu, zgodnego gospodarstwa, osoby, ścieżki, rozmiaru, typu i sygnatury pliku. Zatwierdzenie unieważnia dostęp atomowo z naliczeniem punktów; plik jest rzeczywiście usuwany, a kolejka ponawia błąd. Usuwanie sprawdza także powiązania oraz generację obiektu. Ilustracje nagród nie są zdjęciami wykonania i pozostają do świadomej edycji/usunięcia nagrody.
- `taskPhotoCleanup` korzysta z własnego przełącznika Zadań. Jego cron nadal wynosi `0 * * * *`, Europe/Warsaw. Nie zmieniono harmonogramów SP4, leków ani Google Calendar.
- Dotknięto wyłącznie zapytań `tasks` na Start, w podglądzie rodziny oraz odświeżaniu powiadomień. Nie zmieniono ich wyglądu ani zapytań Kalendarza/Zdrowia. Zakres pamięci widoku uwzględnia UID, rodzinę, rolę, osobę i odebranie dostępu.
- Przygotowano indeks `tasks(familyId ASC, person ASC)` dla zapytań rodziny i własnych/rodzinnych zadań; nie opublikowano indeksów. Pozostałe sekcje Rules oraz istniejące indeksy pozostają bez zmian.

## Warunki przed zgodą na uruchomienie

| Warunek | Rzeczywisty stan dowodów w tym zadaniu | Najkrótsze bezpieczne działanie |
| --- | --- | --- |
| Pełna kopia aktualnych danych i binariów | Nie otrzymano archiwum ani bieżącego dowodu jego kompletności | Użyć istniejącego prywatnego narzędzia `household:diagnose`/preflight; zachować archiwum i osobno klucz, drugą kopię poza Cloud Shell. |
| Odtworzenie właściwej kopii | Brak dowodu odnoszącego się do produkcyjnego archiwum | Faktyczne odtworzenie i próba rollbacku w świeżych emulatorach, zgodny hash archiwum, dane/wersje i wynik procesu 0. Testy syntetyczne poniżej tego nie zastępują. |
| Aktualne reguły Firestore i Storage | Testowano lokalny kod; nie odczytano produkcyjnych releases/rulesets | Porównać rzeczywiste aktywne źródła i hashe reguł. Różnicę potraktować jako wymagający zatwierdzenia plan skoordynowanego przejścia. |
| Pięć rzeczywistych profili i dane Zadań | Nie wykonano aktualnego odczytu produkcji | Potwierdzić UID, role, aktywność, jedno gospodarstwo i unikalne klucze osób oraz przypisania istniejących zadań, sald, historii, próśb i zdjęć. |
| Bucket, jego lokalizacja i runtime IAM | Nie zweryfikowano produkcji | Potwierdzić istniejący właściwy bucket w UE i uprawnienia wykonawcy do potrzebnych plików, w tym usuwania. Niczego nie tworzyć automatycznie. |
| Linki z tokenami pobierania | Brak produkcyjnego skanu | Sprawdzić osobno istniejące tokeny. Firebase bearer URL może ominąć Rules; sam pozytywny test reguł nie dowodzi braku takich linków. Nie odwoływać ich bez planu i zgody. |
| Jawna zgoda na wydanie | Nie udzielono jeszcze zgody na zmianę produkcji | Po zebraniu dowodów przedstawić końcowy plan i uzyskać zgodę. Flagi pozostają wyłączone. |

Historyczny raport wskazywał brak `familyId` pięciu profili. Nie traktujemy tego jako świeżego odczytu stanu produkcji. **Jeżeli ten brak nadal występuje, samo wdrożenie nowych reguł odetnie widok nieprzypisanych Zadań.** Nie należy wtedy publikować tej poprawki ani włączać przełącznika.

Najmniejszą drogą usunięcia takiej blokady byłby osobno zatwierdzony, ograniczony plan przypisania pięciu konkretnych UID oraz wyłącznie rzeczywiście powiązanych danych Zadań i Nagród. Liczba dokumentów musi wynikać z aktualnego inwentarza, nie z dawnych liczników. Nie wymaga to automatycznie zgody na pełne 236 zmian Kalendarza, Szkoły i Zdrowia. W tej pracy nie wykonano ani nie przygotowano narzędzia produkcyjnego apply takiego przypisania.

## Kolejność przyszłego wydania — dopiero po dowodach i akceptacji

1. Zweryfikować świeżą kopię, odtworzenie, plan wycofania i stan produkcyjnych reguł. Potwierdzić dokładne UID i własność danych. Zapisy nowych operacji nadal wyłączone.
2. Rozstrzygnąć brakujące przypisania wyłącznie osobno zaakceptowanym planem, jeżeli okażą się potrzebne. Nie wdrażać Rules dla nieprzygotowanych profili. Nie wykonywać zbiorczego backfill po imieniu ani `__legacy__`.
3. Przy wyłączonych flagach przygotować zgodne API/klienta, wymagany indeks, zatwierdzone reguły i aktualne `notifyTasks`/`taskPhotoCleanup`. Sprawdzić rzeczywiście aktywne wersje po publikacji. Całego codebase Functions nie trzeba publikować dla tej poprawki; pozostałe funkcje i harmonogramy zachować.
4. Zweryfikować odczyty obu rodziców i odpowiednich dzieci oraz odmowy dla obcego gospodarstwa, bez tworzenia testowych zadań w prawdziwych kartotekach rodziny.
5. Dopiero po osobnej zgodzie ustawić `FAMILY_TASKS_WRITES_ENABLED=true` w backendzie Vercel i tym samym parametrze Firebase Functions odpowiedzialnym za task cleanup. Pozostawić `FAMILY_V2_WRITES_ENABLED` dla Zdrowia/Finansów zgodnie z ich odrębnym stanem wydania; nie włączać go na potrzeby Zadań. Preview pozostaje tylko do odczytu. Nie podano polecenia automatycznie aktywującego zapis.

Nowa zmienna nie jest sekretem. `.env.example` zawiera wyłącznie `FAMILY_TASKS_WRITES_ENABLED=false`. Wymagany istniejący `FIREBASE_STORAGE_BUCKET` musi wskazywać sprawdzony magazyn; nie wymyślać nazwy ani nie tworzyć go w ramach tej poprawki. Nie dodano nowych sekretów OAuth, FCM, haseł ani kluczy eduVULCAN.

## Wycofanie

Pierwszą czynnością po problemie jest wyłączenie przełącznika Zadań w obu runtime'ach, bez zmiany pozostałych modułów. Zachować wypracowaną historię i snapshot nowych transakcji. Przywrócenie całej starej bazy po rozpoczęciu naliczania punktów mogłoby utracić prawidłowe operacje — nie wykonywać go automatycznie.

Przełącznik blokuje nowe operacje API i zaplanowany cleanup; nie jest zdalnym unieważnieniem już wydanych ticketów Storage. Istniejące tickety nadal podlegają uprawnieniom, stanowi i terminowi ważności reguł. Ewentualne ich unieważnienie musi być częścią osobno zatwierdzonej reakcji, nie masowym usuwaniem plików.

Nie cofać samych Rules do starego globalnego odczytu Zadań: przywróciłoby to wykrytą lukę. Rollback klienta, serwera, reguł i ewentualnych osobno zatwierdzonych przypisań musi być skoordynowany oraz oparty na zapisanych wersjach i pokwitowaniach. Poprawka nie usuwa istniejących zadań ani historii i nie inicjalizuje samodzielnie sald produkcyjnych.

## Wyniki i zakres sprawdzenia

Końcowe wyniki na Node.js **22.23.3**, Java 21:

| Kontrola | Wynik |
| --- | --- |
| TypeScript i `npm run build` | PASS; ostrzeżenie Vite o dużym istniejącym bundle pozostaje |
| API/polityka/transakcje/powiadomienia — 10 plików testowych | 152/152 PASS |
| Jednostkowe zapytania klienta i upload | 5/5 PASS |
| Firestore i Storage Rules — podstawowe, V2 i nowe Zadania | 72/72 PASS |
| Rzeczywiste transakcje i usuwanie pliku w emulatorach | 6/6 PASS |
| Kontrakty Functions i pakowanie | 15/15 PASS |
| Zgodność kopii `functions/server/` z kanonicznym `server/` | PASS, 47 modułów; katalog generowany, nie źródło do ręcznego edytowania |
| Dwa testy formularzy w Chromium | 2/2 PASS |
| WebKit/Safari | NIE WYKONANO — brak bibliotek systemowych WebKit |
| Produkcyjna kopia, odtworzenie i aktywne reguły | NIE ZWERYFIKOWANO |

Testy serwera i emulatorów obejmują tworzenie, trzy tryby wykonania, zatwierdzanie i poprawę, naliczanie i wydawanie punktów, konkurencyjne decyzje dwóch rodziców, brak środków, obce gospodarstwo z takim samym kluczem osoby, bezpośrednie próby mintowania punktów, walidację zdjęć i rzeczywiste usunięcie pliku. Wszystkie dane zapisujące testy używają wyłącznie lokalnych projektów `demo-*`.

Testy formularzy używają jawnego zastępstwa API; nie stanowią dowodu działania wdrożonego backendu. Emulatory nie potwierdzają produkcyjnego IAM, indeksów, lokalizacji, tokenów pobierania ani zgodności aktywnych reguł. Brak wyniku WebKit z powodu brakujących bibliotek systemowych nie jest wynikiem PASS Safari.

Nowe testy są uwzględnione w `test:server:v2` i `test:rules:v2`. Rzeczywistą integrację można powtórzyć przez `npm run test:tasks:integration`; polecenie uruchamia tylko lokalne Firestore/Storage dla `demo-nasza-rodzina`, a sam test odmawia pracy z nieprawidłowymi hostami i identyfikatorem projektu.

## Zmienione pliki

- API i serwer: `server/family-v2-policy.mjs`, `server/family-http.mjs`, nowy `server/family-identity.mjs`, `server/tasks-service.mjs`, `server/tasks-photos.mjs`, `server/tasks-reward-images.mjs`, `server/notification-events.mjs`, `server/notification-refresh.mjs`.
- Firebase: `firestore.rules`, `storage.rules` (wyłącznie sekcje Zadań), `firestore.indexes.json` (jeden dodatkowy indeks), `functions/index.mjs` (przełącznik istniejącego cleanupu).
- Klient: nowy `src/task-scope.ts`, typy w `src/app-shared.tsx` i `src/family-members.ts`, zapytania i zakres pamięci w `src/features/TasksPageV2.tsx`, `src/features/StartPage.tsx`, `src/features/FamilyPage.tsx`, `src/notifications/refresh.ts`. Bez zmian CSS i układu.
- Konfiguracja lokalna: `.env.example` (wyłączony przełącznik), `package.json` (polecenia testów); bez zmian zależności i lockfile.
- Nowe testy: `tests/tasks-household-security.test.mjs`, `tests/tasks-notifications-security.test.mjs`, `tests/tasks-readiness.rules.test.mjs`, `tests/tasks-rewards.integration.mjs`, `tests/tasks-scope.test.ts`.
- Zaktualizowane testy i syntetyczne fixtures: `tests/family-v2-http.test.mjs`, `tests/family-v2-critical.test.mjs`, `tests/functions-runtime.test.mjs`, `tests/notification-events.test.mjs`, `tests/notification-refresh.test.mjs`, `tests/notification-school-inapp.test.mjs`, `tests/security.rules.test.mjs`, `tests/v2-security.rules.test.mjs`, `tests/emulator-fixtures.ts`, `tests/family-v2.spec.ts`, `tests/tasks-reward-form.spec.ts`.
- Niniejszy raport. Nie zmieniono kodu integracji SP4/eduVULCAN, Fryderyk, Google Calendar, danych Zdrowia ani kalendarzy.

Zgodnie z zakresem audytora reguł, ocena gotowości jest następująca:

```json
{
  "score": 3,
  "summary": "Lokalne zabezpieczenia Zadań przygotowane; gotowość produkcji niepotwierdzona.",
  "findings": [
    { "check": "Production evidence", "severity": "major", "issue": "Brak bieżących dowodów kopii, odtworzenia, wdrożonych reguł i przypisań UID.", "recommendation": "Pozostawić zapis wyłączony do weryfikacji rzeczywistych dowodów i akceptacji planu." },
    { "check": "Storage download tokens", "severity": "moderate", "issue": "Rules nie dowodzą braku starszych ani przejściowych tokenów pobierania.", "recommendation": "Oddzielny odczytowy przegląd tokenów i bezpieczna polityka linków; bez samoczynnego odwoływania." }
  ]
}
```

## Jedna instrukcja właściciela

W istniejącym prywatnym środowisku diagnostycznym uruchom wcześniej opublikowane `household:diagnose` z dotychczasową konfiguracją pięciu UID i poprzednim raportem. Nie przesyłaj klucza ani kopii do rozmowy. Do oceny wystarczą końcowe liczniki i kody oraz dowody integralności/odtworzenia wskazane lokalnie przez narzędzie. Jeżeli wyjdzie brak przypisań profili lub danych Zadań, najpierw zatwierdzimy wyłącznie ten ograniczony zakres. Nie włączaj jeszcze flagi zapisów.

Jeżeli istnieje już aktualny, rzeczywisty dowód kopii i odtworzenia, nie ma potrzeby ponownie wykonywać kosztownego pełnego skanu. Narzędzie `household:diagnose` ocenia gotowość **całej migracji gospodarstwa**; jego ogólny wynik NIE lub blokady dotyczące wyłącznie innych modułów nie są samodzielną oceną wydania Zadań. Do tej decyzji należy użyć warunków tabeli powyżej. Nie zatwierdzać automatycznie niejednoznacznych, niezwiązanych rekordów tylko po to, aby uzyskać zielony wynik narzędzia lub rozpocząć pełny backup. Brak kopii pozostaje wtedy brakiem dowodu wymagającym właściwej kontroli, a nie zgodą na migrację 236 zmian.

Narzędzie diagnostyczne jest na osobnej [opublikowanej gałęzi](https://github.com/noe007-Kg/-nasza-rodzina-web/tree/feature/household-final-diagnostics-20261015), commit `adaba11`; nie jest dodane do produkcyjnego commita ani do tej poprawki i nie wykonuje migracji.
