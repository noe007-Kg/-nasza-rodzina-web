# Nasza Rodzina — wykonane sprawdzenia

## Wspólne połączenie eduVULCAN 1.5.1 — 2 października 2026 r.

Poprawiono autoryzację rodzica, wspólny zakres rodziny, formularz połączenia i ograniczenia przyszłego zakresu ucznia. Nie wykonano `git push`, wdrożenia ani logowania do rzeczywistego konta eduVULCAN. Wszystkie dane logowania i szkolne użyte w testach są syntetyczne.

| Sprawdzenie | Wynik |
| --- | --- |
| `npm run build`: TypeScript i produkcyjny build Vite | przechodzi |
| Kalendarz i import szkolny | 17/17 |
| Serwer eduVULCAN: autoryzacja, zakresy, HTTP, adapter, szyfrowanie i transakcje | 74/74 |
| Przeglądarki: pełny zestaw Chromium i WebKit | 42/42 |
| Reguły Firestore/Storage na lokalnych emulatorach | 15/15 |
| Uwierzytelnienie i rzeczywiste transakcje Auth/Firestore na emulatorach | 3/3 |

Łącznie **151 przypadków testowych przeszło**. Pełny zestaw przeglądarkowy po poprawieniu starych selektorów pola logowania zakończył się powodzeniem; następnie w tym samym uruchomieniu przeszły reguły i integracja Firebase. Build ma dotychczasowe ostrzeżenie Vite o wielkości pakietu JavaScript, bez błędu kompilacji.

Nowe testy potwierdzają, że aktywny rodzic z pełną wyświetlaną nazwą i bez `personKey` może korzystać z integracji. Dominika łączy konto raz, a Sebastian po własnym logowaniu widzi to samo połączenie, Nikodema, czas synchronizacji i pobrane dane bez ponownego hasła. Synchronizacja, limit czasu i rozłączenie są wspólne. Rzeczywiste tokeny emulatora i transakcje sprawdzają szyfrowanie sesji związane z połączeniem `family`, izolację wiadomości rodzica oraz zachowanie pobranej historii po rozłączeniu.

Zakres ucznia jest ograniczony do zweryfikowanego UID i szkolnej tożsamości zatwierdzonej przez rodzica. Zmiana powiązania blokuje zapis w transakcji. Adapter nie wykonuje żadnych żądań skrzynki w zakresie ucznia, a storage odrzuca również mieszaną paczkę ocen i wiadomości. Reguły przygotowanej przyszłej skrzynki ucznia odmawiają dostępu rodzicom i rodzeństwu. Formularz własnego połączenia ucznia nie jest włączony w obecnym interfejsie.

Sprawdzono wszystkie moduły na telefonie, tablecie i komputerze w obu orientacjach. Pozostałe moduły i style nie zmieniły się; w głównym pliku aplikacji zmieniono wyłącznie numer wersji. Zrzuty Startu w `preview/` zachowano z poprzedniej paczki jako podgląd tego samego wyglądu.

**Testy nie potwierdzają logowania do rzeczywistego konta rodziny ani konfiguracji produkcyjnego Vercel/Firebase.** WebKit sprawdza silnik Safari, bez urządzenia fizycznego. Po wdrożeniu pełnego projektu, opublikowaniu reguł Firestore i zachowaniu dotychczasowych kluczy połącz dziennik raz ponownie. Instrukcja: [AKTUALIZACJA_1.5.1.md](AKTUALIZACJA_1.5.1.md), [docs/VULCAN.md](docs/VULCAN.md), [tests/README.md](tests/README.md).

## Integracja eduVULCAN 1.5.0 — 2 października 2026 r.

Kod i instrukcje przygotowano dla istniejącego GitHub/Vercel/Firebase. Nie opublikowano zmian na produkcyjnym serwerze i nie używano rzeczywistego loginu, hasła ani danych szkolnych rodziny.

| Sprawdzenie | Wynik po poprawkach |
| --- | --- |
| TypeScript i produkcyjny build Vite | przechodzi |
| Kalendarz i import CSV/JSON | 17/17 |
| Backend: autoryzacja, szyfrowanie, prywatność, wyścigi i aktualizacja zakresów | 22/22 |
| Obsługa HTTP: limity, metody, czyszczenie danych logowania, bezpieczne błędy | 6/6 |
| Normalizacja ocen, dat, planu, zadań i wiadomości | 10/10 |
| Pełny przepływ adaptera z syntetycznymi odpowiedziami portalu | 15/15 |
| Reguły Firestore/Storage z prawdziwymi SDK i emulatorami | 14/14 |
| Rzeczywiste transakcje i uwierzytelnienie lokalnych emulatorów Auth/Firestore | 2/2 |
| Dotychczasowe scenariusze aplikacji w Chromium i WebKit | 26/26 |
| Nowy panel eduVULCAN w Chromium i WebKit | 14/14 |
| Zasoby PWA i oddzielenie kluczy serwera od frontendu | przechodzi |
| Ostatni `npm audit --omit=dev` | 0 zgłoszonych podatności |

Łącznie **126 przypadków przechodzi**, po poprawkach i ponownym uruchomieniu właściwych scenariuszy. Wynik obejmuje kilka uruchomień: dotychczasowe moduły sprawdzono w pełnym zestawie, a po poprawieniu etykiety wyboru dziecka powtórzono cały zestaw eduVULCAN w obu silnikach. Build ma ostrzeżenie Vite o rozmiarze głównego pakietu JavaScript; kompilacja kończy się poprawnie.

Testy przeglądarek obejmują jawny wybór SP4 i dziecka, brak domyślnego wyboru pierwszego profilu, użycie tokenu Firebase, brak hasła w localStorage/sessionStorage, czyszczenie pola hasła, ponowne logowanie, ograniczenie prób, odłączenie oraz prywatną skrzynkę rodzica. Dane z eduVULCAN pozostają tylko do odczytu; wpisy ręczne można edytować.

Testy adaptera używają syntetycznego HTTP opartego na zweryfikowanych publicznych formularzach i schematach. Potwierdzają wybór właściwego klucza ucznia, bieżącego okresu ocen i szkolnej skrzynki; treść opisową; datowany plan; właściwe szczegóły zadań i sprawdzianów; pełną treść wiadomości; odmowę obcych hostów i przekierowań wynoszących dane logowania. Sprawdzają też zachowanie cache przy błędach całych sekcji oraz pojedynczych szczegółów. To nie jest logowanie do rzeczywistego konta eduVULCAN.

Test transakcji korzysta z prawdziwych emulatorów: odczytuje zweryfikowany token rodzica, odrzuca token dziecka, przechowuje zaszyfrowaną sesję, zapisuje szkolne wpisy, oddziela wiadomości, usuwa wycofaną ocenę po pełnym pobraniu i zachowuje wpisy ręczne. Specjalna obsługa niepodpisanych tokenów działa wyłącznie w jawnie skonfigurowanym lokalnym projekcie `demo-*`; produkcja wymaga podpisanego tokenu Firebase.

**Nie potwierdzono udanego połączenia z rzeczywistym kontem rodziny ani wdrożenia Vercel.** Wymagane jest ustawienie kluczy serwerowych, opublikowanie nowych reguł Firebase i sprawdzenie profilu Nikodema/SP4 po wpisaniu danych w swojej aplikacji. WebKit sprawdza silnik Safari, bez testu na fizycznym iPhonie/iPadzie. Szczegóły: [AKTUALIZACJA_1.5.0.md](AKTUALIZACJA_1.5.0.md), [docs/VULCAN.md](docs/VULCAN.md), [tests/README.md](tests/README.md).

## Logo i kolorystyka 1.4.2 — 1 października 2026 r.

Produkcyjny build TypeScript/Vite przechodzi. Po wdrożeniu nowej palety i logo uruchomiono istniejące scenariusze logowania oraz responsywności w Chromium i WebKit: **4/4 przechodzą**. Sprawdzono wszystkie dziewięć modułów na siedmiu rozmiarach ekranu, formularz wydarzenia, błędne hasło i wylogowanie.

Dodatkowy podgląd Chromium sprawdził panel „Więcej”, Escape i powrót fokusu, zaznaczenie dodatkowej zakładki, telefon poziomo oraz tryb ciemny. Obejrzano podglądy telefonu, komputera i ciemnego motywu.

Oryginalny SVG użytkownika jest identyczny bajtowo w pliku logo, favicon i ikonie SVG. Eksporty PNG mają prawidłowe rozmiary 192, 512 i 180 px. Wszystkie **10 publicznych zasobów** wskazanych w service workerze istnieje, w tym logo; API i Storage nadal pomijają cache. Zmiany tej wersji dotyczą wyglądu i ikon, bez zmian schematu danych lub reguł Firebase.

## Aktualizacja menu 1.4.1

Po zmianie menu przechodzi produkcyjny build TypeScript/Vite. Ponownie uruchomiono dwa istniejące scenariusze responsywności w Chromium i WebKit: **2/2 przechodzą**, obejmując wszystkie dziewięć modułów i siedem rozmiarów ekranu. Poniższe 54 przypadki dotyczą pełnej weryfikacji wersji 1.4.0; aktualizacja menu nie zmienia reguł, migracji ani danych Firebase.

Dodatkowy podgląd w Chromium sprawdził panel „Więcej”, zamykanie Escape z powrotem fokusu, zaznaczenie „Więcej” w dodatkowej zakładce, telefon poziomo oraz tryb ciemny. Podglądy wyglądu znajdują się w `preview/`. Po opisanej wyżej aktualizacji logo kod i paczki miały wersję 1.4.2; to historyczny wynik, nie numer obecnej paczki.

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
- **Stan eduVULCAN podczas testów wersji 1.4.0:** szkoła obsługiwała ręczne wpisy, import w formacie aplikacji i odnośnik do dziennika, bez pobierania danych z portalu. Wersja 1.5.0 dodaje backend i pobieranie na żądanie; jego zakres i brak weryfikacji na rzeczywistym koncie opisuje `docs/VULCAN.md`. Wyników wersji 1.4.0 nie należy traktować jako testu nowej integracji.
- Kopia JSON w Ustawieniach obejmuje dane organizera, bez kont Authentication, wiadomości czatu i plików Storage. Pełną kopię danych przed migracją wykonuje właściciel Firebase.

Instrukcje odtworzenia testów: `tests/README.md`. Raport pierwotnej wersji 1.3.3 w `tests/AUDIT_ORIGINAL_1.3.3.md` opisuje stan przed poprawkami.
