# Pakiet poprawek 1–3 — 23.10.2026

## Zakres i status

Zmiany przygotowano na gałęzi `feature/calendar-chat-school-package-20261023`, na podstawie najnowszej pobranej gałęzi `feature/family-home-personal-theme-20261020` (`7d998b1`). Projekt to istniejąca aplikacja React 19 + TypeScript + Vite, Firebase Auth/Firestore, API Node w `server`, wdrożenie Vercel. Nie utworzono osobnej aplikacji, nie zmieniono zależności ani backendu synchronizacji.

Nie wdrożono produkcji, reguł ani migracji. Build jest gotowy do Vercel; uruchomienie wszystkich nowych zapisów wymaga uprzedniej weryfikacji i wdrożenia dodatków do reguł Firestore. Nie potwierdzono aktywnych reguł produkcyjnych ani rzeczywistych kont/integracji w tej sesji.

## Kalendarz

Dodano domyślny Harmonogram, zachowując Dzień/Tydzień/Miesiąc. Korzysta z istniejących subskrypcji, projekcji, filtrów widoczności, kolorów profili i algorytmu rozkładania kolizji. Oś obejmuje 06:00–22:00 i rozszerza się, gdy rzeczywiste wydarzenie wykracza poza ten zakres. Całodniowe pozostają w osobnej sekcji. Dni i Dzisiaj działają jak wcześniej, bieżący dzień przewija się do godziny w Europe/Warsaw. Pionowy przewijany obszar to strona, bez dodatkowego przechwytującego gesty kontenera.

Od 768 px szczegóły są obok osi; na telefonie działa dotychczasowy modal. Wykorzystano ten sam panel szczegółów i formularz edycji, bez drugiego mechanizmu zapisu. Źródła tylko do odczytu zachowują ograniczenia. Model kalendarza nie zawiera osobnych przypomnień ani zapisywanego statusu ukończenia: panel informuje o tym, zachowując odnośniki i akcje źródłowe. Nie dodano fikcyjnego stanu wykonania do zajęć szkolnych.

## Czat

Wykryto, że stary hook przesuwał jeden kursor kanału do ostatniej pobranej wiadomości bez sprawdzenia widoczności. Zapis zwykłym `setDoc` mógł cofnąć kursor przy dwóch urządzeniach. Osobny efekt odczytywał wszystkie powiadomienia kanału, także te dotyczące niewyświetlonej historii.

Nowy zapis to `chatReadStates/{uid}/messages/{messageId}` z `read: true` i serwerowym `updatedAt`. IntersectionObserver wymaga przynajmniej 60% widoczności przez 700 ms, aktywnego okna i widocznej karty. Każda wiadomość ma niezależny, jednokierunkowy status; równoczesne urządzenia nie nadpisują odczytów innych wiadomości. Powiadomienia dotyczą tylko rzeczywiście wyświetlonych identyfikatorów. Zachowano wcześniejsze kursory jako zgodność wsteczną; nie tworzy się nowych kursorów obejmujących pominięte wiadomości. Wygląd i historia czatu pozostają bez zmian.

Dokładna przyczyna produkcyjnego PERMISSION_DENIED pozostaje niepotwierdzona bez aktywnych reguł i profili. Repozytorium zawiera reguły dla starych kursorów, lecz istnienie ich na produkcji nie zostało potwierdzone. Nowa ścieżka wymaga dodatku reguł; sam frontend nie naprawi odmowy po stronie Firebase. Starsze otwarte wersje aplikacji należy odświeżyć po wdrożeniu.

## Szkoła

Import już nadaje stabilne identyfikatory (w tym haszowany identyfikator zastępczy), odrzuca duplikaty i zachowuje `createdAt` przy kolejnych synchronizacjach. Ponownie użyto tych mechanizmów. `syncedAt` nie wyznacza nowości.

Osobisty początek śledzenia zapisuje się raz w `userPreferences/{uid}/schoolState/baseline` przez transakcję. Archiwum istniejące przed pierwszym uruchomieniem nie dostaje fałszywych oznaczeń. Odczyt pojedynczego wpisu zapisuje się w `userPreferences/{uid}/schoolSeen/{recordId}`. Zachowano precyzję `Timestamp.toMillis()` zamiast obcinać ją przez `Date`. Nie ma zbiorczego oznaczania wszystkich wpisów jako przeczytanych.

Dodano liczniki i filtry nowych ocen, sprawdzianów oraz zadań; oznaczenia w wierszach, przy przedmiotach i w ocenach; sekcję ostatnich ocen oraz ⭐ Najważniejsze. Nowości dotyczą importów eduVULCAN, a ręczne wpisy nie udają nowych importów. Wiadomości rodzica zachowują dotychczasowy zakres dostępu; nie otwarto uczniom skrzynki rodziców ani nie uruchomiono nieobsługiwanej integracji skrzynki ucznia.

Przypięcia rozszerzono z wiadomości na pozostałe obsługiwane informacje poza planem lekcji. Korzystają z istniejącego `userPreferences.importantItems`; stare klucze ważnych wiadomości zachowano. Są osobiste, przeżywają ponowną synchronizację tego samego wpisu i nie zmieniają danych źródłowych. Widok najważniejszych jest przed listami i niezależny od daty oraz filtra listy. Nie tworzy się kopii usuniętych przez źródło rekordów ani archiwum cudzych danych.

## Zmienione pliki

- `src/features/CalendarPage.tsx`, `src/features/calendar-schedule.css`, `src/app-shared.tsx` — nowy widok i wspólny panel szczegółów.
- `src/features/ChatPage.tsx`, `src/features/useChatReadState.ts` — widoczność, trwałe odczyty i powiadomienia.
- `src/SchoolModule.tsx`, `src/school/SchoolGrades.tsx`, `src/school/newness.ts`, `src/school/useSchoolNewness.ts`, `src/school-enhancements.css` — nowości, filtry i przypięcia.
- `firestore.rules` — wyłącznie trzy nowe, prywatne ścieżki metadanych.
- `tests/package-fixes.spec.ts`, `tests/package-read-state.rules.test.mjs`, `tests/school-newness.test.ts`, `playwright.package.config.ts` — testy pakietu.
- Ten raport.

## Firebase i migracja

Nowe reguły dopuszczają wyłącznie właściciela UID. Potwierdzenie wiadomości wymaga istniejącej, dostępnej mu wiadomości; nie pozwala ustawić `read: false`, usunąć odczytu ani pisać do cudzego UID. Początek śledzenia szkolnego można utworzyć, ale nie przesunąć ani usunąć. Metadane odczytu wpisów nie mają uprawnień zapisu danych eduVULCAN. Wszystkie nowe dokumenty wymagają ograniczonego zestawu pól i serwerowego czasu.

Migracja danych nie jest potrzebna. Nie usuwano ani nie resetowano kont, profili, historii, ocen, wydarzeń, powiązań ani źródłowych dokumentów. Produkcyjnych operacji Firebase: **0**. Cloud Functions, indeksy, Storage i sekrety: bez zmian.

Dodatki znajdują się w trzech blokach `match` w `firestore.rules`:

- `/userPreferences/{uid}/schoolState/{id}`;
- `/userPreferences/{uid}/schoolSeen/{id}`;
- `/chatReadStates/{uid}/messages/{id}`.

Przed wdrożeniem pobrać aktualne reguły, porównać je z repozytorium i sprawdzić wymagane istniejące funkcje `member` oraz `chatMessageVisible`. Nie zastępować całego aktywnego pliku starszym zestawem reguł. Istniejące reguły źródłowych kolekcji pozostają bez zmian; testy nowych ścieżek nie są certyfikatem pełnej izolacji wszystkich starszych modułów. Zweryfikować aktywne reguły dla aktualnych rodzin, rodziców i uczniów przed produkcją.

## Wyniki weryfikacji

- `npm run build`: PASS, obejmuje `tsc -b`; istnieje ostrzeżenie Vite o dużym bundlu.
- Logika nowości, osi czasu i czatu: **29 PASS**.
- Normalizacja i zakresy synchronizacji eduVULCAN: **55 PASS**.
- Rzeczywiste transakcje importu w czystym emulatorze Auth/Firestore: **6 PASS**.
- Nowe reguły Firestore, prywatność UID, odmowy dostępu i dwa klienty: **3 PASS**.
- Chromium + lokalne emulatory, pełna aplikacja: **7 PASS**. Telefon/iPad/desktop, przewijanie, kolizje, szczegóły, dwa urządzenia czatu, zachowanie niewyrenderowanej historii, znikanie licznika i właściwego powiadomienia, trwałość po odświeżeniu, oceny/przypięcia/odpięcia po synchronizacji, liczniki i filtry nowych zadań/sprawdzianów, niezmienność źródłowych danych.

Testy zasilano syntetycznymi danymi wyłącznie w lokalnych projektach `demo-*`. Nie wykonywano logowania do prawdziwego eduVULCAN ani testów zapisu na produkcji. Fizyczny iPad/iPhone Safari oraz rzeczywisty synchronizator wymagają sprawdzenia ręcznego. Chromium przy szerokości iPada nie jest testem Safari ani sprzętowych gestów dotykowych.

## Kolejność wydania

1. Przejrzeć kod i dodatki do reguł względem rzeczywistych reguł oraz uprawnień Firebase.
2. Uruchomić testy emulatorów z docelowym zestawem reguł. Przy łączeniu zestawów zachować dostęp wyłącznie do swoich danych.
3. Dla Preview użyć osobnego projektu testowego lub istniejącego trybu `VITE_V2_PREVIEW_READ_ONLY=true`; nie testować zapisów na danych rodziny.
4. Po weryfikacji wdrożyć dodatki reguł, następnie frontend Vercel. Nie są potrzebne nowe sekrety ani migracja.
5. Sprawdzić na dwóch rzeczywistych kontach i urządzeniach odczyty, pojedynczą nową ocenę po synchronizacji oraz trwałość przypięcia; sprawdzić Safari na iPadzie i telefonie.

Pakiet jest gotowy do przeglądu i kontrolowanego Preview. Nie deklaruje zakończonej weryfikacji produkcji ani automatycznej gotowości do promocji.
