# Etap 4A — Oceny i krótkie listy Szkoły

Baza: lokalny commit profili `d3cef85`, gałąź `work/family-evolution-1f75aa2`. Etap dotyczy wyłącznie prezentacji istniejących danych. Nie wykonano push, deploymentu, migracji ani zapisu produkcyjnego.

## Zachowanie

Zakładka Oceny ma podsumowanie rzeczywistych wpisów, karty przedmiotów z ostatnimi oznaczeniami, pięć najnowszych ocen, osobne wpisy okresowe i rozkład oznaczeń. Przedmioty są przed dłuższą listą ostatnich ocen, aby były szybko dostępne na telefonie. Nagłówek zachowuje licznik w jednym rzędzie także na małej szerokości. Kliknięcie przedmiotu otwiera jego istniejące wpisy, a kliknięcie oceny — „Szczegóły oceny”.

Wartości pozostają literalne: `4+`, `5-`, wynik punktowy i opis nie są zamieniane na arbitralne liczby. Waga `0` jest zachowana. Szczegóły pokazują wyłącznie dostępne dane: oznaczenie, osobę, przedmiot, datę, nauczyciela, wagę i oryginalną notatkę. Dane eduVULCAN pozostają tylko do odczytu.

Prawidłowa data wystawienia ma pierwszeństwo przed datą importu. Wpis niedatowany nie wypycha datowanych ocen; `createdAt` rozstrzyga remisy i kolejność wpisów bez daty. `updatedAt` oraz `syncedAt` nie zmieniają kolejności. Brak daty pokazuje „Bez daty wystawienia”.

Średnia jest wartością podaną przez portal, nie lokalnym przeliczeniem oznaczeń. Wymaga kanonicznego źródła eduVULCAN, identyfikatora krótkiej oceny cząstkowej i jednoznacznego przedmiotu/profilu/okresu. Kilka okresów, brak pochodzenia lub sprzeczne wartości ukrywają zbiorczą średnią. Surowa notatka, długi opis albo wpis ręczny nie stanowią dowodu średniej. Nie dodano fikcyjnej średniej klasy lub wykresu postępów bez odpowiednich danych.

Długie sekcje pokazują domyślnie pięć pozycji z „Pokaż wszystkie” / „Zwiń”, również przy ponad stu opisowych oznaczeniach w statystykach. Zmiana ucznia lub filtra resetuje rozwinięcie i wybór przedmiotu, również po powrocie A→B→A. Oceny i wiadomości sortowane są od najnowszych; ważne wiadomości zachowują gwiazdkę na początku. Zadania i sprawdziany pokazują najpierw nadchodzące terminy. Pełny dzienny plan nie jest ograniczany do pięciu lekcji.

## Zachowana integracja i bezpieczeństwo

Nie zmieniono zapytań i kolekcji, uprawnień rodzica/dziecka, importu, formularzy własnych wpisów, synchronizacji, sesji, lease, szyfrowania, harmonogramów, Functions ani Rules. Trzy istniejące pola pochodzenia rekordu są odczytywane dodatkowo do projekcji ocen. Ograniczenie zakresu ucznia następuje przed grupowaniem i liczeniem. Dziecko nadal nie otrzymuje skrzynki rodzic/nauczyciel.

Brak nowych Environment Variables, zależności, konfiguracji chmurowej lub migracji. Fryderyk nie jest oznaczany jako połączony: dostęp anonimowy zwrócił 403, użytkownik potwierdził brak eksportu ICS/iCal, a protokół pobierania planu pozostaje niepotwierdzony.

## Weryfikacja

Node.js 22.23.3, wyłącznie emulatory `demo-nasza-rodzina`.

| Kontrola | Wynik |
| --- | --- |
| Build / TypeScript | PASS; dotychczasowe ostrzeżenie o rozmiarze bundla |
| Unit | 132/132 PASS, w tym 27 nowych testów projekcji ocen |
| E2E — oceny i układ Szkoły | 32/32 PASS, Chromium i WebKit |
| E2E — dotychczasowa Szkoła i Zakupy | 16/16 PASS, Chromium i WebKit |
| Dodatkowa kontrola końcowej hierarchii i podglądów | 2/2 PASS, pięć rozmiarów w obu przeglądarkach |
| Podglądy wcześniejszej wersji | 1/1 PASS, oddzielna kopia przed zmianą |

48 unikalnych scenariuszy szkolnych przeszło. Dodatkowe dwa są powtórką kontroli układu po korekcie hierarchii kart. To nie jest deklaracja pełnego przebiegu całego E2E aplikacji; pozostałe moduły obejmie końcowy test regresji.

Backend, Rules i istniejące integracje nie należą do zmian tego etapu; ich poprzednie wyniki dotyczą niezmienionej bazy z Etapu 3. Niezależny Etap 5 weryfikuje późniejszą zmianę retencji sesji.

Sprawdzono 390×844, 844×390, 900×1440, 1024×768 i 1440×900. Brak poziomego przewijania strony. Wewnętrzny pasek kategorii nadal przewija się poziomo, zgodnie z istniejącą nawigacją Szkoły.

## Podglądy przed / po

Rzeczywiste zrzuty viewportu przy tych samych syntetycznych danych i rozmiarach. Nawigacja pozostaje na dole obrazu; nie jest ukrywana podczas fotografowania panelu.

- [Szkoła — telefon przed](../preview/stage-4/school-phone-portrait-before.png) / [po](../preview/stage-4/school-phone-portrait-after.png)
- [Szkoła — tablet przed](../preview/stage-4/school-tablet-landscape-before.png) / [po](../preview/stage-4/school-tablet-landscape-after.png)
- [Oceny — telefon przed](../preview/stage-4/grades-phone-portrait-before.png) / [po](../preview/stage-4/grades-phone-portrait-after.png)
- [Oceny — tablet przed](../preview/stage-4/grades-tablet-landscape-before.png) / [po](../preview/stage-4/grades-tablet-landscape-after.png)

## Pliki i rollback

Zmienione: `src/SchoolModule.tsx`, `tests/school-layout.spec.ts`.

Nowe: `src/school/grade-projections.ts`, `src/school/SchoolGrades.tsx`, `src/school/SchoolExpandableList.tsx`, `src/school/grades.css`, `tests/grade-projections.test.ts`, `tests/school-grades.spec.ts`, ten raport oraz osiem podglądów `preview/stage-4/`.

Cofnięcie oddzielnego lokalnego commita tego etapu przywraca prezentację z Etapu 3. Żadne dane nie zostały migrowane lub usunięte. Działający commit `1f75aa2` pozostaje dostępny.
