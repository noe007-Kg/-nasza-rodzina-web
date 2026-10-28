# Automatyczne logowanie eduVULCAN — 28.10.2026

## Użycie

W Szkole otwórz panel eduVULCAN, wpisz login i hasło dziennika, zaznacz „Zapamiętaj login i hasło i łącz automatycznie po wygaśnięciu sesji”, a następnie wybierz Połącz i potwierdź dziennik/dziecko. Przy aktywnym połączeniu formularz można otworzyć przez „Zmień dostęp”. Domyślnie opcja pozostaje odznaczona. Istniejących haseł nie można odzyskać z poprzedniej wersji: dotąd ich nie zapisywano.

Serwer może ponownie zalogować konto po wygaśnięciu sesji. Nie trzeba pozostawiać aplikacji otwartej. Istniejące zadania sprawdzają połączenie co 10 minut w godzinach szkolnych, potem co godzinę. Odzyskanie sesji i import danych odbywają się w osobnych wywołaniach, aby nie przekroczyć limitów czasu dostawcy. Po odzyskaniu połączenia dane pobierze następne zadanie; dostępna jest też ręczna synchronizacja. „Połącz zapisanymi danymi” odnawia samo połączenie.

Przycisk „Usuń zapamiętane dane” usuwa zaszyfrowany login i hasło, zachowując bieżącą sesję i historię. „Rozłącz” usuwa zarówno sesję, jak i dane automatycznego logowania. Udane ręczne połączenie z odznaczoną opcją również usuwa poprzednią zgodę i zapisane dane.

## Zabezpieczenia

- Login i hasło zapisujemy wyłącznie po jawnej zgodzie, po udanym logowaniu, w zaszyfrowanym polu dokumentu serwerowego `_eduConnections`. Nie zapisujemy hasła jawnym tekstem ani w pamięci przeglądarki.
- AES-256-GCM używa istniejącego klucza serwerowego. Osobny kontekst `eduvulcan-auto-login` i identyfikator połączenia uniemożliwiają podmianę zaszyfrowanych danych między połączeniami lub potraktowanie ich jako sesji. Dotychczasowa funkcja szyfrowania sesji nadal odrzuca hasła.
- Publiczny status zawiera wyłącznie flagi enabled/paused; nie zwraca loginu, hasła ani szyfrogramu. Istniejące reguły nie dopuszczają dostępu klientów do kolekcji serwerowej.
- Każda próba wymaga aktualnych uprawnień aktora i właściwego zakresu połączenia. Wspólna blokada logowania i dotychczasowe limity prób pozostają. Rozłączenie, zapomnienie danych oraz zmiana sesji wygrywają z opóźnioną odpowiedzią dostawcy.
- Błędny login/hasło, dodatkowe potwierdzenie lub nieprawidłowa tożsamość ucznia wstrzymują próby. Błąd chwilowy powoduje co najmniej godzinę przerwy. Nie ma pętli automatycznego wpisywania haseł ani obchodzenia potwierdzeń.
- Wybór dziecka zostaje zachowany tylko przy zgodności identyfikatora profilu, ucznia i szkoły. Zmieniony lub ponownie użyty identyfikator wymaga potwierdzenia rodzica.
- Dane pozostają zaszyfrowane do ich usunięcia, rozłączenia albo zastąpienia przy kolejnym logowaniu. Oboje aktywni rodzice mogą zarządzać wspólnym połączeniem.

## Weryfikacja

- 329/329 testów jednostkowych aplikacji PASS.
- 38/38 testów automatycznego logowania i harmonogramu PASS, w tym osiem nowych przypadków szyfrowania, braku zgody, wznowienia sesji, błędnego hasła/MFA i backoff, zapominania, wyścigów z rozłączeniem, nieaktywnego aktora i zmienionej tożsamości profilu.
- Szeroki zestaw serwerowy: 454/455 PASS przed ostatnim dodatkowym przypadkiem tożsamości. Niezaliczone utworzenie testowego symlinku wynika z EPERM Windows, jak w poprzednim audycie; nie uznano go za PASS.
- Chromium i WebKit: 2/2 PASS dla prawdziwych operacji serwisu na lokalnych emulatorach z syntetycznym adapterem logowania. Sprawdzono domyślnie odznaczoną zgodę, zaszyfrowany zapis, brak sekretów w odpowiedzi oraz usuwanie bez rozłączania; widok 1024×768 nie przepełnia strony.
- Lokalny build produkcyjny PASS. Wspólne moduły Functions wygenerowano ponownie. Nie zmieniano reguł ani sekretów.

Nie przeprowadzono rzeczywistego automatycznego logowania na koncie rodziny: funkcja wymaga jednorazowego wpisania danych w aplikacji przez rodzica. Nie należy przekazywać hasła w czacie. Dodatkowe potwierdzenie dostawcy, zmiana hasła lub dostępu mogą nadal wymagać interwencji. Funkcja dotyczy eduVULCAN; nie tworzy logowania do Fryderyka.

## Wdrożenie

Wyniki publikacji zostaną zapisane po potwierdzeniu Firebase i Vercel. Publikowane są wyłącznie dwa istniejące zadania eduVULCAN oraz aplikacja w istniejącym projekcie Vercel; nie są włączane zapamiętane dane żadnego konta bez zgody w formularzu.

### Potwierdzenie wdrożenia — 28.10.2026

- Kod `de19a241a7548ee8b90d6467f875b1df3ac783a8` opublikowano w istniejącym projekcie Vercel. Wdrożenie `dpl_2DK69n28GrxWWBNRYJ29VJpaK5FK`: READY, production, aliasError=null, główny adres `https://nasza-rodzina-web.vercel.app`.
- Kontrola HTTP po publikacji potwierdziła 200 dla strony i plików, obecność trzech nowych elementów interfejsu oraz 401/no-store dla niezalogowanych żądań status/connect/disconnect.
- Firebase CLI potwierdził udaną aktualizację wyłącznie eduVulcanSchoolHours i eduVulcanOffHours. Pierwsze lokalne sprawdzanie kodu przekroczyło limit 10 s przed aktualizacją; druga próba z FUNCTIONS_DISCOVERY_TIMEOUT=60 zakończyła się Deploy complete.
- Ponowny odczyt Google Cloud potwierdził ACTIVE obu funkcji, aktualizację 28.10.2026, zachowanie dotychczasowego sekretu EDUVULCAN_ENCRYPTION_KEY_BASE64 oraz ENABLED harmonogramów Europe/Warsaw: */10 8-14 * * * i 0 0-7,15-23 * * *.
- Nie wpisywano prawdziwego hasła rodziny ani nie włączano zapamiętywania bez zaznaczenia opcji w formularzu. Rzeczywiste ponowne logowanie zostanie zweryfikowane dopiero po takim jednorazowym połączeniu przez rodzica.
