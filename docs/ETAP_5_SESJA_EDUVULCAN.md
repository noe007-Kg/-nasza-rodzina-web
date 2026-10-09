# Etap 5 — retencja i odnawianie sesji eduVULCAN

## Ustalona przyczyna

Dotychczas `saveConnection` wyznaczało `expiresAt` nie później niż 24 godziny po połączeniu. `updateConnectionSession` zapisywało odświeżone cookies po poprawnym odczycie, lecz nie przesuwało tego terminu. Aktywna i nadal autoryzowana przez portal sesja mogła więc wymagać ponownego połączenia z powodu lokalnego limitu wyznaczonego pierwszego dnia.

Portal już aktualizuje jar z odpowiedzi `Set-Cookie`, przechodzi istniejące SSO i ponownie odczytuje konfigurację CSRF. Nie wymaga hasła podczas synchronizacji. Kontrakt providera zwraca zaktualizowaną sesję dopiero po poprawnym, jednoznacznym `Context` wybranego ucznia oraz przynajmniej jednej poprawnie odczytanej sekcji danych. Odmowa dostępu, formularz logowania zamiast API, timeout i rate-limit przerywają operację.

## Minimalna zmiana

Provider zwraca `sessionConfirmedAt`, czyli rzeczywisty czas poprawnego odczytu `Context`. To pole pojawia się wyłącznie w wyniku zakończonego odczytu danych; samo połączenie i odkrycie profili nie stanowi potwierdzenia.

Synchronizacja zachowuje dwa kroki pod tym samym atomowym lease i `sessionVersion`:

1. Przed importem zapisuje poprawny, odświeżony jar. Ten zapis nie przedłuża lokalnej retencji. Obrócone cookie pozostaje dostępne dla następnej próby także wtedy, gdy późniejszy import nie powiedzie się.
2. Po udanym, chronionym imporcie ponownie zapisuje jar oraz atomowo zapisuje `sessionConfirmedAt` i `expiresAt`. Nowy termin wynosi najwyżej `sessionConfirmedAt + EDUVULCAN_SESSION_TTL_HOURS`, przy niezmienionym maksymalnym limicie 24 godzin. Jeżeli provider jawnie poda rzeczywisty krótszy termin, jest on zachowywany jako dodatkowe ograniczenie.

Odszyfrowanie, format session envelope, nazwa i ID klucza, cron, deduplikacja slotów, cooldown, powiadomienia/baseline i reguły bezpieczeństwa pozostają bez zmian. Nie ma nowych sekretów ani wymaganych zmiennych środowiskowych. W `.env.example` zmieniono wyłącznie komentarze; wartość TTL nadal wynosi `24`.

## Zachowane zabezpieczenia

- Zapis wymaga bieżącego, niewygasłego lease, zgodnego `sessionVersion`, aktualnego przypisania ucznia oraz dotychczasowej autoryzacji rodzinnej/osobistej.
- Sesja, której poprzedni termin już minął, nie jest wskrzeszana. Termin sesji i lease jest sprawdzany ponownie po oczekiwaniu na odczyt przypisania ucznia.
- Reconnect lub disconnect podczas odczytu blokuje zapis starego jar i przedłużenie starej sesji.
- Brak sesji, błędna struktura jar, niezgodny wybrany profil, brak potwierdzonego dziennika lub niespójny czas potwierdzenia nie umożliwia przedłużenia.
- `statusAction`, uruchomienie interfejsu, samo nabycie lease, nieudany import, timeout i 429 nie przedłużają retencji.
- `lastSuccessfulSyncAt` nadal jest zapisywany dopiero przy sukcesie synchronizacji. Przy błędzie importu obrócone cookie może zostać zachowane, lecz termin retencji i czas udanej synchronizacji nie są przedłużane.
- Rzeczywista odmowa autoryzacji nadal prowadzi do bezpiecznego stanu wymagającego ponownego połączenia. Synchronizacja nigdy nie próbuje logować się hasłem.

Stare rekordy nie wymagają migracji. Dotychczasowy `expiresAt` nadal obowiązuje do pierwszego poprawnego odczytu i importu; rekord już wygasły musi zostać ponownie połączony. Klient nadal odczytuje istniejące pole `expiresAt` i nie omija bramki wygaśnięcia.

## Testy przygotowane

Rozszerzono `tests/edu-scope-storage.test.mjs` o testy fake-clock dla retencji, statusu, wspólnego lease rodziców i schedulera, osobistego zakresu ucznia, poprawnego jar bez potwierdzenia, błędu importu po obrocie cookie, błędnych sesji, starych/przyszłych czasów potwierdzenia, limitu rzeczywistego providera, krótszej konfiguracji TTL, timeout/429, reconnect/disconnect oraz wygaśnięcia podczas odczytu i transakcji przypisania ucznia.

Rozszerzono `tests/edu-provider.test.mjs` o zachowanie kolejnych `Set-Cookie`, rzeczywisty czas potwierdzenia autoryzacji, odmowę 401/403, 429, formularz logowania HTTP 200 i przekroczenie budżetu operacji. Wszystkie dane w testach są syntetyczne; provider używa lokalnego zamiennika fetch.

Walidacja gałęzi roboczej w Node.js 22.23.3:

- Server: **291/291 PASS**, w tym 16 nowych przypadków providera i retencji sesji.
- Functions: **49/49 PASS**, wraz z weryfikacją wygenerowanych kopii kanonicznego `server/`.
- Integracje eduVULCAN i powiadomień: **20/20 PASS** w lokalnych emulatorach Auth/Firestore. Dwa nowe testy potwierdzają rzeczywiste transakcje, szyfrowanie, lease i baseline podczas udanego oraz błędnego importu.
- Build frontendowy: **PASS**; kod frontendowy nie zmienił się w tym etapie.
- Reguły pozostały identyczne z Etapem 3, gdzie zaliczono **39/39**. Ten wynik nie jest nowym uruchomieniem w Etapie 5.
- Niezależny przegląd mechanizmu odnowienia: brak stwierdzonych blockerów.

Pierwsza próba integracji użyła jedynie emulatora Firestore i została prawidłowo odrzucona przez zabezpieczenie wymagające także Auth. Poprawione polecenie zakończyło się kodem 0; wszystkie 20 testów przeszły. Nie kontaktowano produkcyjnego Firebase ani portalu szkoły. Pełna regresja aplikacji zostanie ponownie uruchomiona po scaleniu kolejnego etapu.

## Ograniczenia i koszt

To jest retencja **nieaktywnej sesji**, a nie gwarancja ważności sesji dostawcy przez następne 24 godziny. Opaque cookies i tokeny CSRF nie dowodzą przyszłego terminu autoryzacji. Nie wyliczamy TTL z najkrótszego cookie i nie wymyślamy endpointów odnowienia.

eduVULCAN może w każdej chwili unieważnić sesję lub wymagać interaktywnego ponownego połączenia. Fatalny błąd odczytu po obrocie cookie nie zwraca zaufanego stanu jar, więc wyjątek nie służy do zapisu takiego niepotwierdzonego stanu.

Udana synchronizacja z potwierdzeniem wykonuje jedną dodatkową chronioną transakcję zapisu sesji. Jeżeli poprzedni termin upłynie pomiędzy importem a drugim zapisem, dane mogły zostać bezpiecznie zaimportowane, ale stara sesja nie zostanie przedłużona ani oznaczona jako udana synchronizacja. To celowe, konserwatywne zachowanie.

## Pliki do przeniesienia

- `server/edu-provider.mjs`
- `server/edu-service.mjs`
- `server/edu-storage.mjs`
- `tests/edu-provider.test.mjs`
- `tests/edu-scope-storage.test.mjs`
- `tests/edu-storage.integration.mjs` — dwa rzeczywiste scenariusze emulatorowe
- `.env.example` — tylko trzy komentarze semantyki TTL
- `docs/VULCAN.md` — opis istniejącej zmiennej TTL
- `docs/ETAP_5_SESJA_EDUVULCAN.md`

Nie przenosić pozostałych plików izolowanej kopii: zawierają wcześniejszy snapshot Etapu 3, który nie jest źródłem aktualnych poprawek profili w gałęzi roboczej.
