# Kalendarz — pakiet zmian

Istniejące widoki Dzień / Tydzień / Miesiąc, wydarzenia rodziny i dawne serie pozostają dostępne. Nie wykonywano migracji ani modyfikacji produkcyjnej bazy.

## Powtarzanie i serie

- Dotychczasowe `none`, `daily`, `weekly`, `monthly`, `yearly` są nadal odczytywane bez zmiany danych.
- Dodano `weekdays` oraz `custom`: interwał 1–1000, dzień / tydzień / miesiąc / rok, wybrane dni tygodnia.
- Zakończenie: bez końca, wybrana data albo 1–100000 wystąpień.
- Edycja i usuwanie oferują jeden termin, termin i kolejne albo całą serię.
- Pojedyncze zmiany są wyjątkami z kluczem oryginalnego terminu ISO. Przeniesione wystąpienie nadal zachowuje ten klucz.
- Zmiana przyszłości jest pojedynczym atomowym batchem: poprzednia część otrzymuje `repeatBefore`, nowa część stabilny identyfikator wyliczony z serii i daty. Przeszłość pozostaje zachowana.
- Zmiana całej serii uwzględnia jej wcześniejsze podziały. Przy zmianie reguły lub końca seria jest składana do pierwszego istniejącego dokumentu; indywidualne wyjątki zostają zachowane.
- Nowe wpisy przechowują strefę urządzenia. Serie zachowują lokalną godzinę w strefie wydarzenia także przez zmianę czasu. Starsze wpisy zachowują dotychczasową interpretację lokalną.

## Prywatność

Nowa kolekcja `privateCalendarEvents` jest dostępna wyłącznie właścicielowi wskazanemu przez `ownerUid == request.auth.uid`. Rodzic nie ma wyjątku pozwalającego na odczyt prywatnych wydarzeń innego dorosłego. Wymagany fragment Rules znajduje się w `docs/calendar.rules.fragment.txt`; finalna integracja jest w `firestore.rules`.

Stara kolekcja `calendarEvents` pozostaje publicznym kalendarzem rodzinnym. Brak pola `private` w starym dokumencie oznacza dotychczasowe wydarzenie publiczne. Nowe zapisy z `private:true` do publicznej kolekcji muszą zostać odrzucone przez Rules. Nie wymaga to migracji starych wydarzeń ani indeksu złożonego.

Kalendarz, Start, Rodzina i eksport korzystają ze wspólnego odczytu: publiczne wydarzenia oraz zapytanie o prywatne wydarzenia tylko bieżącego UID. Zmiana widoczności przenosi dokument atomowo między kolekcjami, zachowując UID twórcy i dodatkowe metadane. Prywatny pojedynczy termin serii publicznej jest osobnym dokumentem prywatnym; publiczny dokument przechowuje wyłącznie informację o wyłączeniu terminu, bez jego prywatnej nazwy czy opisu.

## Import i eksport ICS

W Kalendarzu jest okno „Importuj / pobierz kalendarz .ics”. Eksport obsługuje własne wydarzenia, osobę i zakres. Pełny eksport zachowuje serie, EXDATE i RECURRENCE-ID, a eksport zakresu zapisuje konkretne wystąpienia. Prywatne wydarzenia innego UID są dodatkowo odrzucane przez eksporter.

Import obsługuje daty całodzienne, UTC, strefy TZID, RRULE dla dni/tygodni/miesięcy/lat, interwały, wybrane dni, COUNT, UNTIL oraz wyjątki. Standardowe parametry końca miesiąca zachowują dotychczasowe dopasowanie 29–31 dnia do ostatniego dnia krótszego miesiąca. Identyfikator importu zależy od UID właściciela i UID wydarzenia ICS. Ponowny import pomija istniejące wpisy zamiast powielać lub nadpisywać ich historię.

Import maksymalnie 2 MB / 2000 wydarzeń, eksport zakresu maksymalnie 10 lat. Nieobsługiwane złożone RRULE (np. „pierwszy poniedziałek miesiąca”), DURATION bez DTEND i nieznane strefy są pomijane z widocznym wyjaśnieniem; nie są zamieniane na niepoprawne serie. Funkcja ICS jest importem/eksportem pliku, nie dwustronną synchronizacją z Google/Apple.

Nie dodano zmiennych środowiskowych ani endpointu serwera dla Kalendarza. Reguły trzeba opublikować razem z finalnym pakietem dopiero po akceptacji użytkownika. W tej sesji reguł nie publikowano.

## Testy

`tests/calendar.test.ts` zachowuje 12 wcześniejszych przypadków. `tests/calendar-package.test.ts` dodaje testy reguł niestandardowych, granic zakresów serii, prywatnych wyjątków, DST niezależnego od strefy urządzenia, UID importu, prywatności eksportu i roundtrip ICS. `tests/calendar-package.spec.ts` ćwiczy formularze i rzeczywiste zapisy w lokalnych emulatorach, edycję zakresów, przełączenie użytkownika i ICS. Przypadki przeglądarkowe uruchamiają się w Chromium i WebKit.
