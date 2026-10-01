# Nasza Rodzina — wykonane sprawdzenia

## Logo i kolorystyka 1.4.2 — 1 października 2026 r.

Produkcyjny build TypeScript/Vite przechodzi. Po wdrożeniu nowej palety i logo uruchomiono istniejące scenariusze logowania oraz responsywności w Chromium i WebKit: **4/4 przechodzą**. Sprawdzono wszystkie dziewięć modułów na siedmiu rozmiarach ekranu, formularz wydarzenia, błędne hasło i wylogowanie.

Dodatkowy podgląd Chromium sprawdził panel „Więcej”, Escape i powrót fokusu, zaznaczenie dodatkowej zakładki, telefon poziomo oraz tryb ciemny. Obejrzano podglądy telefonu, komputera i ciemnego motywu.

Oryginalny SVG użytkownika jest identyczny bajtowo w pliku logo, favicon i ikonie SVG. Eksporty PNG mają prawidłowe rozmiary 192, 512 i 180 px. Wszystkie **10 publicznych zasobów** wskazanych w service workerze istnieje, w tym logo; API i Storage nadal pomijają cache. Zmiany tej wersji dotyczą wyglądu i ikon, bez zmian schematu danych lub reguł Firebase.

## Aktualizacja menu 1.4.1

Po zmianie menu przechodzi produkcyjny build TypeScript/Vite. Ponownie uruchomiono dwa istniejące scenariusze responsywności w Chromium i WebKit: **2/2 przechodzą**, obejmując wszystkie dziewięć modułów i siedem rozmiarów ekranu. Poniższe 54 przypadki dotyczą pełnej weryfikacji wersji 1.4.0; aktualizacja menu nie zmienia reguł, migracji ani danych Firebase.

Dodatkowy podgląd w Chromium sprawdził panel „Więcej”, zamykanie Escape z powrotem fokusu, zaznaczenie „Więcej” w dodatkowej zakładce, telefon poziomo oraz tryb ciemny. Podglądy bieżącego wyglądu znajdują się w `preview/`. Obecny kod i paczki mają wersję 1.4.2.

## Pełne sprawdzenie wersji 1.4.0

Data: 30 września 2026 r. Bazą był przesłany projekt 1.3.3. Przygotowano kod, pliki do hostowania oraz instrukcję dla istniejącego GitHub/Vercel/Firebase. Nie publikowano zmian na tych usługach.

## Wyniki

| Sprawdzenie | Wynik |
| --- | --- |
| TypeScript i produkcyjny build Vite (`npm run build`) | przechodzi |
| Kalendarz: powtarzanie, miesiące, lata przestępne, zmiany czasu, długie serie | 12/12 |
| Import szkolny: CSV/JSON, walidacja, ograniczenia, identyfikatory powtórzeń | 5/5 |
| Reguły Firestore i Storage: konta, role, prywatność, pliki | 11/11 |
| Scenariusze przeglądarkowe w Chromium | 13/13 |
| Te same scenariusze w WebKit | 13/13 |
| Pliki cache PWA, dowolna orientacja, pomijanie API i Storage | przechodzi |
| `npm audit --omit=dev` | 0 zgłoszonych podatności na dzień sprawdzenia |

Łącznie: **54 przypadki testowe przeszły**. Build zgłasza jedynie ostrzeżenie Vite o wielkości głównego pakietu JavaScript; nie blokuje kompilacji.

## Co obejmują scenariusze przeglądarkowe

Logowanie i wylogowanie, błędne hasło, odmowa dostępu nieaktywnemu kontu, trwały zapis/edycja/usunięcie wydarzeń, wczesne godziny i stare serie, zgłoszenie zadania przez dziecko i zatwierdzenie punktów przez rodzica, następny termin zadania miesięcznego, zakupy i szybka notatka, rodzinny oraz prywatny czat, własne dane szkolne dziecka, oceny, import z potwierdzeniem i pomijaniem powtórzeń, powiązanie zajęć z kalendarzem, przesyłanie i autoryzowane otwieranie PDF oraz ograniczenie dostępu do zdrowia.

Wszystkie dziewięć modułów sprawdzono na ekranach: **320×700, 390×844, 844×390, 768×1024, 1024×768, 1440×900 i 900×1440**. Sprawdzano szerokość strony, nawigację i przewijanie formularza po zmianie rozmiaru. Zrzuty Startu dla telefonu, tabletu i komputera są w `preview/`.

## Zakres i ograniczenia weryfikacji

- Użyto lokalnych emulatorów Authentication, Firestore i Storage z prawdziwymi SDK oraz regułami dostarczonymi w paczce. Nie korzystano z produkcyjnych kont ani danych rodziny. Pogoda w testach ma stałą odpowiedź; poza testami korzysta z Open-Meteo dla Kołobrzegu.
- WebKit jest silnikiem używanym przez Safari. Ten test nie zastępuje sprawdzenia na rzeczywistym iPhonie/iPadzie i macOS po wdrożeniu.
- Testy nie potwierdzają ustawień produkcyjnego Firebase, CORS, domen logowania, rozliczeń ani konfiguracji Twojego Vercel. Te elementy trzeba przygotować zgodnie z `docs/FIREBASE.md` i `docs/WDROZENIE.md`.
- PWA zapamiętuje publiczne pliki interfejsu. Dane rodziny i pliki wymagają internetu. Nie zaimplementowano niezawodnych alarmów przy zamkniętej aplikacji; przypomnienia o lekach działają w otwartej zakładce Zdrowie.
- **Automatyczna synchronizacja eduVULCAN nie jest zaimplementowana.** Szkoła obsługuje ręczne wpisy, import w formacie aplikacji i odnośnik do dziennika. Oficjalny interfejs do integracji nie został potwierdzony. Szczegóły: `docs/VULCAN.md`.
- Kopia JSON w Ustawieniach obejmuje dane organizera, bez kont Authentication, wiadomości czatu i plików Storage. Pełną kopię danych przed migracją wykonuje właściciel Firebase.

Instrukcje odtworzenia testów: `tests/README.md`. Raport pierwotnej wersji 1.3.3 w `tests/AUDIT_ORIGINAL_1.3.3.md` opisuje stan przed poprawkami.
