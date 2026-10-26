# Nagrody, szkoła, tryb ciemny i Ustawienia — 26.10.2026

## Zmiany

- **Zdjęcia nagród:** przed rezerwacją przesyłania klient dekoduje zdjęcie, zachowuje proporcje, ogranicza dłuższy bok do 1600 px i zapisuje JPG (jakość 85%). Mniejsze zdjęcia nie są powiększane. Dopuszczalne wejście to JPG/PNG/WebP do 32 MB, wynik do 8 MB. Rozmiar i MIME rezerwacji odpowiadają rzeczywiście przesyłanemu plikowi. Nieudany zapis formularza nadal zachowuje poprawnie przesłane zdjęcie do ponowienia. Komunikat odmowy dostępu nie ujawnia wewnętrznej ścieżki pliku.
- **Usuwanie:** rodzic ma czytelny przycisk usunięcia zadania oraz usunięcia nagrody, z potwierdzeniem. Usunięcie archiwizuje pozycję i zachowuje historię oraz punkty. Usunięta nagroda nie przyjmuje nowych próśb, a oczekujące prośby są zamykane bez pobierania punktów. Jej zdjęcie traci dostęp natychmiast i jest usuwane z magazynu, z istniejącym ponawianiem sprzątania po błędzie. Archiwalne zadania nie wracają na Start ani do profilu rodziny.
- **Start / Szkoła:** osobny kafelek z czterema ostatnimi informacjami, ocenami, zadaniami lub sprawdzianami. Nowe wpisy korzystają z dotychczasowego osobistego stanu odczytu; sam podgląd na Start nie oznacza wpisu jako przeczytanego. Data „Dodano” pochodzi z zapisanego czasu utworzenia; bez niego pokazujemy termin lub brak daty. Zachowano siedem istniejących identyfikatorów zapisu kolejności — użytkownik może przestawiać nową sekcję bez utraty preferencji.
- **Profil Pawła:** korzysta z tych samych uprawnionych źródeł i projekcji SP4/Okruszek co kalendarz. Plan tygodniowy jest rozwijany na wybrany dzień, zamiast pomijania nowszego formatu. Wyświetlany jest kompletny plan, również późniejsze zajęcia, oraz krótki dopisek o godzinach orientacyjnych.
- **Tryb ciemny:** ujednolicone kolory obu generacji komponentów i okien. Poprawiono powiadomienia, profile rodziny, pola formularzy, czat i reakcje, kafelki zakupów, nawigację Zdrowia, stopkę kalendarzy, statusy przesyłania i wylogowanie. Zostają kolory przypisane członkom rodziny oraz naturalne kolory zdjęć.
- **Ustawienia:** usunięto niedostępne połączenie Fryderyka, nieaktualne „Co nowego?”, powielone pasywne opisy uprawnień/pliku/prywatności, techniczny status powiadomień i zapowiedź nieaktywnej funkcji. Zostają działające ustawienia konta, profilu, wyglądu, powiadomień, członków rodziny, połączeń i kopii. Nazwy `canLogin` / `schoolEnabled` zastąpiły czytelne etykiety; niedostępny przycisk archiwizacji własnego konta jest ukryty. Karty nie rozciągają się do wysokości najdłuższej sąsiedniej karty. Widoczna data aktualizacji to 26.10.2026.

## Przyczyna błędu zdjęcia i Firebase

Nieudane zdjęcie miało 82 137 bajtów, poprawną rezerwację, typ JPEG, aktywnego rodzica, zgodną rodzinę i niewygasłą rezerwację. Usłudze Firebase Storage brakowało jednak roli umożliwiającej sprawdzanie dokumentów Firestore przez reguły Storage.

Po **wyraźnej zgodzie użytkownika** dodano `roles/firebaserules.firestoreServiceAgent` wyłącznie istniejącej usłudze `service-340731425852@gcp-sa-firebasestorage.iam.gserviceaccount.com` w projekcie `nasza-rodzina`. Ponowny odczyt IAM potwierdził zapis tej roli i zachowanie dotychczasowej roli Storage. Aktualizacja używała `etag`, zachowując pozostałe wpisy polityki. Nie nadawano dostępu publicznego ani dodatkowych uprawnień kontom użytkowników. Reguły Storage i Firestore nie były zmieniane.

Jest to standardowe uprawnienie dla [reguł Storage odczytujących dokumenty Firestore](https://firebase.google.com/docs/rules/manage-deploy#manage_permissions_for_cross-service).

## Weryfikacja

- 329 testów jednostkowych — zaliczone.
- 44 testy serwera: nagrody/zdjęcia, krytyczne operacje zadań i punkty, routing/uprawnienia — zaliczone. Nowe przypadki obejmują odmowę usunięcia nagrody dziecku i obcemu rodzicowi, wymaganie potwierdzenia, zamknięcie oczekujących próśb bez wydawania punktów, usunięcie pliku i brak możliwości ponownego użycia archiwalnej nagrody.
- 13 testów układu Start — zaliczone; siedem szerokości, przeciąganie myszą/dotykiem/klawiaturą, zapis kolejności, dwa kolory konta oraz kontrast jasny/ciemny.
- Cztery odrębne scenariusze Chromium — zaliczone: zachowanie zdjęcia/formularza po błędzie zapisu; pełne skalowanie 3200×2400 → JPG 1600×1200 przez prawdziwy emulator Storage i serwis nagród, potem usunięcie nagrody/zadania; nowe wpisy szkolne z datą i pełny środowy plan Pawła; kontrola renderowania oraz jasnych powierzchni i przycisków na dziesięciu głównych zakładkach w trybie ciemnym.
- Kompilacja produkcyjna oraz budowa/sprawdzenie kanonicznych źródeł Functions — zaliczone. Istniejące ostrzeżenie o wielkości pakietu pozostaje.

Testy modyfikujące rachunki, zadania, zdjęcia lub wiadomości używają wyłącznie lokalnego projektu demonstracyjnego. Nie zmieniano prawdziwych nagród, punktów ani zadań rodziny na potrzeby testów. Nie wykonywano testu na fizycznym iPadzie ani w Safari. Ponowny zapis rzeczywistego zdjęcia przez zalogowanego użytkownika nie był wykonywany automatycznie na produkcji; potwierdzono przyczynę konfiguracji, zapis roli i pełny przepływ na emulatorach.
