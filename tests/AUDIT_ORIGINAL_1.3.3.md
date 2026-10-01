# Audyt funkcjonalny oryginalnej paczki 1.3.3

Ta lista opisuje błędy pliku `src/main.tsx` z dostarczonej paczki przed naprawami. Nie jest listą błędów aktualnej wersji 1.4.0.

## P0 — dostęp do danych

- Prywatny czat pobierał całą kolekcję `familyMessages`, a kanał filtrował dopiero w przeglądarce. Dane cudzych rozmów były dostępne w pamięci. Naprawa: uczestnicy zapisani w dokumencie, reguły na serwerze i osobne zapytania do kanału rodzinnego oraz rozmów, których zalogowana osoba jest uczestnikiem.
- Zdrowie pobierało całą kolekcję `healthRecords`; `privateToParents` było wyłącznie filtrem interfejsu. Naprawa: reguły Firestore/Storage i ograniczone zapytania dziecka według osoby i widoczności.
- Rodzica rozpoznawano po imieniu i części tekstu roli. Brak plików reguł oraz procedury tworzenia rodzinnych kont nie pozwalał ocenić bezpieczeństwa produkcji. Naprawa: kanoniczna rola `parent` zarządzana administracyjnie, brak możliwości zmiany roli przez klienta, odmowa dostępu nieaktywnym i nieprzypisanym kontom.

## P1 — utrata funkcji i błędne terminy

- Zadania zapisywały `repeat`, ale ukończenie nigdy nie tworzyło następnego zadania. Naprawa: atomowe ukończenie i utworzenie kolejnego terminu, zachowanie historii punktów oraz zabezpieczenie przed podwójnym kliknięciem/zatwierdzeniem.
- Kalendarz generował serie zawsze od indeksu 0 z limitem 2000. Codzienne wydarzenie przestawało być widoczne po około 5,5 roku. Naprawa: wyznaczenie początkowego indeksu z zakresu widoku, lokalne dodawanie dni i zachowanie godziny podczas zmiany czasu.
- Widok dnia wyświetlał tylko godziny 06–23; zapisane wydarzenia 00–05 znikały z tego widoku. Naprawa: wszystkie 24 godziny.
- Czas końca wystąpienia liczono stałą różnicą milisekund. Całodzienne serie przy zmianie czasu mogły kończyć się w kolejnym dniu lub godzinę za wcześnie. Naprawa: dla całodziennej serii ustawić koniec tego samego lokalnego dnia.
- Kliknięcie cyklicznego wystąpienia pokazywało datę początku całej serii. Naprawa: przechowywać wybrane wystąpienie do informacji o dacie, zachowując wyraźne edytowanie całej serii.
- Zapisy większości modułów nie miały obsługi błędu i blokady podczas zapisu. Wielokrotne kliknięcie mogło dodać duplikaty. Naprawa: blokada zapisu, komunikat o błędzie, zachowanie formularza; powiązane rekordy zdrowia/szkoły/kalendarza zapisywać atomowo.
- Szkoła miała przycisk „Edytuj plan”, który dodawał nowy wpis; przycisk „⋯” natychmiast usuwał lekcję. Naprawa: prawdziwe edytowanie i jawne usuwanie z potwierdzeniem.
- Zajęcia dodatkowe domyślnie proponowały dodanie do kalendarza, ale pole konkretnej daty nie było wyświetlane. Naprawa: synchronizować tygodniowy wpis jako serię lub udostępnić datę.
- „Najbliższe sprawdziany” i zadania domowe obejmowały minione daty; „ostatnie oceny” wybierano z listy posortowanej według dnia/godziny. Naprawa: filtrowanie przyszłych terminów, sortowanie ocen i wiadomości według daty utworzenia.
- Długie przytrzymanie produktu otwierało menu i nadal wywoływało dodanie produktu po puszczeniu. Naprawa: blokować klik po wywołaniu menu i sprzątać timer po opuszczeniu kafelka/odmontowaniu.
- Zakładki kartoteki zdrowia i spinacz czatu nie wykonywały żadnej akcji. Naprawa: funkcjonalne filtry kartoteki; wdrożenie załączników lub usunięcie nieaktywnego przycisku.
- Powiadomienia o lekach nie sprawdzały ustawień powiadomień. Działały tylko przy otwartej zakładce Zdrowie. Naprawa: respektować zapisane preferencje i uczciwie opisywać dostępny zakres powiadomień.
- Oznaczenia online i podwójne potwierdzenie odczytu czatu nie miały danych potwierdzających obecność lub odczyt. Naprawa: usunąć te oznaczenia albo wdrożyć rzeczywistą obecność/potwierdzenie odczytu.

Powiązania VULCAN, Google, Apple i Outlook były opisanymi miejscami pod przyszłą integrację, a nie działającą synchronizacją. Eksport/import ICS można wdrożyć bez proszenia o zewnętrzne hasła; integracja dziennika wymaga oddzielnego, bezpiecznego zaplecza i autoryzacji dostawcy.
