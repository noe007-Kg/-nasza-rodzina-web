# Testy lokalne

Testy korzystające z Firebase używają wyłącznie projektu `demo-nasza-rodzina` i lokalnych emulatorów. Testy jednostkowe i backendu pracują na danych syntetycznych. Nie używaj identyfikatora produkcyjnego projektu ani kont rodziny podczas testów.

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run test:unit
npm run test:server
npm run test:rules
npm run test:e2e
```

Wymagania emulatorów: Node.js 22 lub 24 i Java 21. `npm run test:e2e` uruchamia Auth na porcie 9099, Firestore na 8080 i Storage na 9199. Playwright sam uruchamia Vite na `127.0.0.1:5173` z `VITE_USE_EMULATORS=true`. Testy uruchamiane są kolejno, ponieważ każdy resetuje bazę emulatora.

Jeżeli emulatory są już uruchomione, sam zestaw przeglądarkowy można uruchomić poleceniem `npx playwright test`. Uruchamiaj testy reguł i przeglądarkowe kolejno: czyszczą tę samą lokalną bazę. W środowisku z proxy Firebase CLI może kierować wewnętrzne żądania localhost przez proxy mimo NO_PROXY; wymaga to poprawnej obsługi połączeń lokalnych przez środowisko.

## Testy serwera eduVULCAN

`npm run test:server` uruchamia `tests/edu-*.test.mjs`: parsery i normalizację danych, adapter HTTP portalu, uwierzytelnianie rodzica, szyfrowanie sesji, ograniczenia synchronizacji i odpowiedzi funkcji API. Wersja 1.5.1 dodaje testy wspólnego zakresu rodziny i odrębnego zakresu ucznia w `edu-access.test.mjs` i `edu-scope-storage.test.mjs`. Sprawdzają dostęp rodzica niezależnie od pełnej wyświetlanej nazwy, jedną sesję i wspólne blokady, ograniczenie ucznia do zatwierdzonego szkolnego profilu oraz odmowę importu wiadomości w zakresie ucznia. Ten zestaw nie wymaga emulatorów ani klucza Firebase Admin.

**Testy adaptera używają wymyślonych formularzy HTML, cookies i odpowiedzi JSON oraz zastąpionego `fetch`.** Nie łączą się z serwerami eduVULCAN, nie logują prawdziwego rodzica i nie pobierają rzeczywistych ocen, planu lub wiadomości. Publiczne źródła protokołu opisuje `docs/VULCAN.md`; testy ich zgodności na fixture nie są weryfikacją konta SP4.

## Integracja zapisu sesji i szkoły z Firebase

Osobny plik `tests/edu-storage.integration.mjs` nie należy do globu `test:server`. Uruchom go z emulatorami Auth, Firestore i Storage:

```sh
npx firebase emulators:exec --only auth,firestore,storage --project demo-nasza-rodzina "node --test tests/edu-storage.integration.mjs"
```

Test używa prawdziwych tokenów lokalnego Authentication, handlera serwera i transakcji Firestore. Sprawdza odmowę dla dziecka, szyfrowanie zapisanej sesji, zapis do osobnej kolekcji wiadomości rodziców, zachowanie danych niedostępnej sekcji, usuwanie wycofanych ocen wyłącznie w udanym zakresie oraz odłączenie bez usuwania wcześniej pobranych wpisów. Sesja i dane eduVULCAN są syntetyczne. Test nie wywołuje portalu ani wdrożonych funkcji Vercel.

Emulatory muszą nasłuchiwać na `127.0.0.1`: Auth `9099`, Firestore `8080`; polecenie CLI ustawia ich zmienne środowiskowe. Test odmawia działania bez tych lokalnych hostów i sam wybiera projekt `demo-nasza-rodzina`. Przy już uruchomionych emulatorach możesz wykonać `node --test tests/edu-storage.integration.mjs`, jeśli te zmienne są prawidłowo ustawione. Uruchamiaj ten zestaw po zakończeniu testów reguł/przeglądarki, nie równolegle z nimi.

## Scenariusze przeglądarkowe

`browser.spec.ts` sprawdza logowanie, odmowę dostępu nieaktywnemu kontu, zapis/edycję/usunięcie wydarzenia, długie serie i wczesne godziny, zgłoszenie wykonania zadania przez dziecko i zatwierdzenie przez rodzica, miesięczne powtarzanie, listę zakupów, czat prywatny, szkolne oceny i własny plan dziecka, przesyłanie dokumentu PDF oraz widoczność danych zdrowotnych. Każdy scenariusz działa w Chromium i WebKit. Dodatkowe scenariusze w `school-browser.spec.ts` sprawdzają import z potwierdzeniem, powtórny import bez nadpisania oraz powiązane zajęcia i kalendarz. Test responsywności przechodzi przez wszystkie moduły na siedmiu rozmiarach ekranu: telefon, tablet i komputer w obu orientacjach.

Scenariusze organizera zastępują pogodę Open-Meteo. Logowanie, Firestore, Storage i uprawnienia korzystają z prawdziwych SDK i reguł emulatorów. Fixture odmawia działania bez ustawionych lokalnych hostów Auth/Firestore; przeglądarka odmawia połączeń do produkcyjnych usług Firebase.

`edu-browser.spec.ts` zastępuje odpowiedzi `/api/eduvulcan/...` danymi syntetycznymi. Sprawdza formularz rodzica i przyciski Połącz, Sprawdź stan połączenia, Synchronizuj teraz i Rozłącz; jawny wybór SP4; przypisanie dziecka; wspólny status po zalogowaniu drugim kontem rodzica; brak dostępu dziecka do panelu i wiadomości rodzica; błędy konfiguracji, logowania, wygaśnięcia, limitu i częściowego odczytu. Żądania zawierają token Firebase z emulatora, ale odpowiedzi integracji są mockiem. Ten zestaw sprawdza zachowanie interfejsu, a nie działanie rzeczywistego logowania eduVULCAN lub wdrożenia Vercel. Możesz uruchomić tylko te scenariusze przy działających emulatorach: `npx playwright test tests/edu-browser.spec.ts`.

Konta testowe: `sebastian@example.test`, `dominika@example.test`, `nikodem@example.test`, `pawel@example.test`. Wspólne hasło fixture: `FamilyTest!2026`. Konto `inactive@example.test` ma wyłączony dostęp rodzinny. Te konta są tworzone tylko w emulatorze i nie powinny być tworzone na produkcji.

Po niepowodzeniu Playwright zapisuje zrzut ekranu i trace w `test-results/`. Raport HTML znajduje się w `playwright-report/`; otworzysz go poleceniem `npx playwright show-report`.
