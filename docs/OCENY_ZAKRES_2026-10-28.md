# Oceny i zakres pobierania — 28.10.2026

## Wynik odczytu produkcji przed zmianą

Ostatnia odczytana synchronizacja: 28.10.2026 15:17:34 UTC (16:17:34 Europe/Warsaw). Liczniki pobrania: 22 wpisy ocen, 30 wiadomości, 99 lekcji, 3 sprawdziany, 6 zadań domowych. W schoolItems zapisano 22 wpisy ocen eduVULCAN, w jednym zakresie grades:12357. Odczytano wyłącznie metadane/liczniki; nie porównywano treści z prywatnym portalem rodziny.

Limit 30 dotyczył skrzynki wiadomości, nie ocen. Oceny były pobierane z bieżącego okresu klasyfikacyjnego. Interfejs pokazywał domyślnie pięć wpisów, choć historia mogła zawierać więcej; główny skrót „Ostatnie oceny” nie miał rozwijania.

## Zmiany

- Podgląd każdej kategorii w Szkole pokazuje do 10 wpisów z opcją „Pokaż wszystkie”. Zadania i sprawdziany zachowują pierwszeństwo nadchodzących terminów; gwiazdki wiadomości nadal mają pierwszeństwo przed pozostałymi.
- Oceny: do 10 wpisów w podglądzie ostatnich ocen, szczegółach przedmiotu oraz ocenach okresowych; rozwinięcie udostępnia wszystkie zapisane wpisy. Dodano rozwijanie głównego skrótu ostatnich ocen. Zestawienie oznaczeń/statystyk i miniatury przedmiotów zachowują dotychczasowy kompaktowy wygląd.
- Import ocen obejmuje rozpoczęte okresy klasyfikacyjne bieżącego roku szkolnego, od 1 września, zwrócone dla właściwego dziennika. Pomija okresy przyszłe i zakończone przed bieżącym rokiem szkolnym. Bieżący okres nadal musi być jednoznaczny.
- Każdy poprawnie pobrany okres ma niezależny zakres uzgadniania i identyfikatory ocen. Błąd starszego okresu nie usuwa zapisanej historii tego okresu i nie blokuje poprawnych ocen bieżących. Niepełny odczyt nie oznacza pełnej gotowości historii powiadomień.
- Nie wprowadzono limitu dziesięciu pobieranych ocen. Dotychczasowe ograniczenia bezpieczeństwa (liczba żądań, czas operacji i maksymalna wielkość importu) pozostają; ich przekroczenie nie jest traktowane jako kompletna synchronizacja.
- Skrzynka nadal pobiera najnowsze 30 wiadomości; wcześniej zapisane starsze wiadomości pozostają w aplikacji. Komunikat jasno mówi, że limit nie obejmuje ocen.
- Panel wyjaśnia różnicę między licznikami ostatniego pobrania, zapisaną historią i podglądem 10 wpisów. Nagłówek ostrzeżeń zmieniono na „Zakres i uwagi synchronizacji”, aby zwykły limit skrzynki nie wyglądał jak błąd pobrania wszystkich kategorii.
- Ochrona rodzicielskich wiadomości, przypisanie dziecka, sesje i automatyczne logowanie pozostają bez zmian.

## Weryfikacja

23/23 testy adaptera PASS. Nowe przypadki sprawdzają pobranie wszystkich rozpoczętych semestrów bieżącego roku, pominięcie przyszłego/poprzedniego roku, zachowanie cache po błędzie starszego semestru oraz pełny import 45 ocen niezależnie od okna skrzynki.

Szeroki zestaw serwera: 458/459 PASS. Jedyny niezaliczony przypadek to utworzenie symlinku pliku, blokowane przez uprawnienia Windows (EPERM), jak w poprzednich przebiegach. Nie oznaczono go jako PASS.

Build produkcyjny przeszedł; pozostaje wcześniejsze ostrzeżenie o dużym pakiecie JS. Testy przeglądarek używają wyłącznie lokalnych emulatorów i syntetycznych danych. Helper testowy dopuszcza dwa jawne adresy loopback zamiast jednego; odrzuca pozostałe hosty. Nie zatrzymywano emulatora innego projektu na 127.0.0.1.

Końcowe wyniki przeglądarek i publikacji podano poniżej po ich potwierdzeniu. Nie potwierdzono zgodności każdej prawdziwej oceny z portalem rodziny, ponieważ nie wykonano zalogowanego porównania portalu. Odczytane 22 wpisy oraz znalezione ograniczenia nie dowodzą przyczyny wszystkich zgłaszanych różnic.

## Końcowe sprawdzenia

- 329/329 testów jednostkowych PASS.
- 46/46 testów adaptera i szkolnych powiadomień PASS po końcowych zmianach. Uzupełnianie zakończonego semestru nie tworzy lawiny „nowych ocen”; rzeczywiste zmiany zapisanej oceny nadal mogą powiadamiać.
- Pełny przebieg Chromium/WebKit: 23/24 PASS. Jedyny błąd dotyczył przywracania fokusu po zamknięciu szczegółów w WebKit. Naprawiono go przez jawne wskazanie otwieranej oceny jako aktywnego elementu; ponowny scenariusz w Chromium i WebKit: 2/2 PASS. Wszystkie 24 odrębne scenariusze mają tym samym pozytywną weryfikację, w tym poprawiony scenariusz Safari.
- Obejrzano zaktualizowany podgląd ocen na tablecie; cztery podglądy telefonu/tabletu odświeżono danymi testowymi. Nie testowano na fizycznym iPadzie.
