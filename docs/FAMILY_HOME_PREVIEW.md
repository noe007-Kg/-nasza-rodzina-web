# Start „Rodzina w centrum” — wersja do oceny

Nowa gałąź jest oparta na poprawce kalendarza muzycznego `f05b5ad`. Zakres: Start i osobisty motyw prezentacji. Bez zmian w API, regułach, danych Firebase, logowaniu, integracjach oraz funkcji godzinowej szkoły muzycznej. Nie wykonano deployu produkcyjnego ani migracji.

## Zachowanie

- Małe powitanie i pogoda, pasek aktualnych statusów pięciu domowników, najbliższe wydarzenia, zadania i siedem skrótów do istniejących modułów.
- Pasek statusów na telefonie przewija się poziomo, tablet pokazuje rodzinę w jednym rzędzie. Treść statusów i zegar pochodzą z dotychczasowej logiki.
- Lista prezentuje maksymalnie sześć trwających/nadchodzących wspólnych wystąpień w siedmiu dniach kalendarzowych Europe/Warsaw, w kolejności rozpoczęcia, z etykietami odwołań i godzin orientacyjnych. Zakończone i prywatne wydarzenia są wykluczone. Źródła pozostają wspólne z kalendarzem; nie tworzymy nowych dokumentów.
- Uchwyt ⠿ służy do przestawiania trzech sekcji; pasek rodziny pozostaje na górze. Układ przechowuje istniejące `dashboardOrder` z siedmioma dotychczasowymi identyfikatorami. Skróty są grupą poprzednich kart Zakupów/Czatu/Zdrowia/Szkoły, z zachowaną kolejnością wewnętrzną. Otwarcie strony nie zapisuje preferencji; tylko upuszczenie sekcji zmienia kolejność.
- Niebieski/różowy akcent zależy od zalogowanego konta. Automatyczne przypisania dotyczą jawnie pięciu istniejących kluczy profili. Dla nieznanych profili domyślny jest dotychczasowy różowy. Nie zgadujemy płci ani uprawnień.
- Ustawienia → Wygląd: Automatyczny/Niebieski/Różowy, obok Jasny/Ciemny. Kolor lokalny jest osobny dla UID; synchronizuje się między kartami tej samej przeglądarki, nie między urządzeniami. Odmowa localStorage zachowuje wybór w pamięci i wyświetla komunikat. Wylogowanie usuwa akcent z aktywnego interfejsu.
- Kolory właścicieli kalendarza, statusów i kategorii nie zależą od motywu konta. Poprzednich zapisów kolorów i rozmiarów kafelków nie usuwamy. Niepasujące kontrolki dawnych kafelków nie są pokazywane na nowym Starcie.

## Sprawdzenie

`npm run build` — TypeScript i Vite. Pozostaje wcześniejsze ostrzeżenie o dużym pakiecie JS.

Testy logiki (Node 22):

```bash
node --import tsx --input-type=module -e "await import('./tests/family-home-model.test.ts'); await import('./tests/start-tile-projections.test.ts'); await import('./tests/music-school-calendar.test.ts');"
```

Testy przeglądarkowe samego UI, bez Firebase:

```bash
npx playwright test -c playwright.family-home.config.ts
```

Opcjonalny `PLAYWRIGHT_CHROMIUM_EXECUTABLE` wskazuje zainstalowany Chromium. Testy korzystają z lokalnej, syntetycznej strony w `tests/fixtures`, renderują rzeczywiste komponenty i nie logują użytkownika. Strona testowa nie jest punktem wejścia produkcyjnej kompilacji. Zakres: szerokości 360/390/430/768/1024/1280/1440, brak luk i nakładania, klawiatura/mysz/syntetyczny dotyk, preferencje kont, druga karta, wylogowanie, ciemny motyw, odwołania i oznaczenia orientacyjne. Syntetyczny dotyk nie zastępuje ręcznego testu Safari na iPadzie.

Zaktualizowano również istniejące testy emulatorowe `start-browser.spec.ts` oraz `start-tile-details.spec.ts` do nowych sekcji i zasad prywatności. Uruchamiać je przez istniejącą konfigurację emulatorów; nie traktować wyników offline UI jako dowodu ich zaliczenia ani testu produkcyjnych danych.

## Ocena i wycofanie

Najpierw Preview. Sprawdzić na telefonie i tablecie statusy oraz nadchodzące wydarzenia z rzeczywistego konta, przestawianie, wybór innego kalendarza bez zmiany motywu konta i oba tryby jasności. Preview zachowuje dotychczasowe blokady zapisów innych modułów. Nie zmieniać żadnych flag Firebase/Finansów/Zadań.

Po akceptacji właściciela można przygotować wydanie Production z tej gałęzi. Rollback frontendu do poprzedniej wersji przywraca poprzedni Start; nie wymaga wycofania danych ani wdrażania reguł. Preferencje kolejności zachowują poprzedni schemat.

Wyniki tej sesji: 33/33 testy logiki/statusów/projekcji PASS; 13 scenariuszy Chromium PASS po poprawieniu testu symulowanego dotyku (powtórzenia tylko zmienionych scenariuszy); zrzuty 390 i 1024 px obejrzane; kontrast głównych tekstów co najmniej 4,5:1 w obu kolorach i obu trybach jasności. TypeScript i Vite PASS. Pełne testy zalogowanej aplikacji na emulatorach oraz ręczny Safari/iPad: nie wykonywano w tej sesji. Nie traktujemy testowego fixture UI jako testu produkcyjnej bazy ani dowodu pełnej izolacji gospodarstw.
