# Testy lokalne

Testy używają wyłącznie projektu `demo-nasza-rodzina` i lokalnych emulatorów. Nie używaj identyfikatora produkcyjnego projektu podczas testów.

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run test:unit
npm run test:rules
npm run test:e2e
```

Wymagania emulatorów: Node.js 22 lub 24 i Java 21. `npm run test:e2e` uruchamia Auth na porcie 9099, Firestore na 8080 i Storage na 9199. Playwright sam uruchamia Vite na `127.0.0.1:5173` z `VITE_USE_EMULATORS=true`. Testy uruchamiane są kolejno, ponieważ każdy resetuje bazę emulatora.

Jeżeli emulatory są już uruchomione, sam zestaw przeglądarkowy można uruchomić poleceniem `npx playwright test`. Uruchamiaj testy reguł i przeglądarkowe kolejno: czyszczą tę samą lokalną bazę. W środowisku z proxy Firebase CLI może kierować wewnętrzne żądania localhost przez proxy mimo NO_PROXY; wymaga to poprawnej obsługi połączeń lokalnych przez środowisko.

`browser.spec.ts` sprawdza logowanie, odmowę dostępu nieaktywnemu kontu, zapis/edycję/usunięcie wydarzenia, długie serie i wczesne godziny, zgłoszenie wykonania zadania przez dziecko i zatwierdzenie przez rodzica, miesięczne powtarzanie, listę zakupów, czat prywatny, szkolne oceny i własny plan dziecka, przesyłanie dokumentu PDF oraz widoczność danych zdrowotnych. Każdy scenariusz działa w Chromium i WebKit. Dodatkowe scenariusze w `school-browser.spec.ts` sprawdzają import z potwierdzeniem, powtórny import bez nadpisania oraz powiązane zajęcia i kalendarz. Test responsywności przechodzi przez wszystkie moduły na siedmiu rozmiarach ekranu: telefon, tablet i komputer w obu orientacjach.

Jedynym zastąpionym źródłem danych jest pogoda Open-Meteo. Logowanie, Firestore, Storage i uprawnienia korzystają z prawdziwych SDK i reguł emulatorów. Fixture odmawia działania bez ustawionych lokalnych hostów Auth/Firestore; przeglądarka odmawia połączeń do produkcyjnych usług Firebase.

Konta testowe: `sebastian@example.test`, `dominika@example.test`, `nikodem@example.test`, `pawel@example.test`. Wspólne hasło fixture: `FamilyTest!2026`. Konto `inactive@example.test` ma wyłączony dostęp rodzinny. Te konta są tworzone tylko w emulatorze i nie powinny być tworzone na produkcji.

Po niepowodzeniu Playwright zapisuje zrzut ekranu i trace w `test-results/`. Raport HTML znajduje się w `playwright-report/`; otworzysz go poleceniem `npx playwright show-report`.
