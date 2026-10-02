# Nasza Rodzina

Prywatna aplikacja rodzinna działająca w przeglądarce. Jeden adres dla telefonu, tabletu i komputera, w pionie i w poziomie. Zawiera kalendarz, zadania, zakupy, wiadomości, sprawy szkolne i zdrowotne.

To paczka projektu **1.5.0** do uruchomienia na Twoim hostingu. Rozpakowanie plików nie publikuje aplikacji. Konta i dane korzystają z Firebase: Authentication, Firestore i Storage. Nowe połączenie eduVULCAN wymaga dodatkowo funkcji serwerowych Vercel i prywatnej konfiguracji.

## Najprostsza droga dla Twojego projektu

Masz już [repozytorium GitHub](https://github.com/noe007-Kg/-nasza-rodzina-web), [projekt Vercel](https://vercel.com/noe007-kg/nasza-rodzina-web/deployments) i projekt w [Firebase Console](https://console.firebase.google.com/).

1. Zachowaj kopię obecnego projektu i danych przed podmianą.
2. Przygotuj konta rodziny, migrację istniejących danych z 1.3.3 i reguły dostępu Firebase zgodnie z [instrukcją wdrożenia](docs/WDROZENIE.md). Ten krok chroni dane na serwerze; zachowaj kolejność z dokumentacji.
3. Podmień pliki w repozytorium **zawartością paczki PROJEKT**, a nie całym ZIP-em; uwzględnij katalogi `api/` i `server/`. Zachowaj konfigurację własnego projektu Firebase. Nie dodawaj `node_modules`, plików `.env.local` ani kluczy administratora.
4. Zapisz zmiany w GitHub. Jeśli Vercel jest połączony z właściwą gałęzią, rozpocznie budowanie strony. Ustawienia: **Vite**, `npm run build`, folder wynikowy **dist**.
5. W Firebase → Authentication → Settings → Authorized domains dodaj domenę aplikacji.
6. Otwórz stronę, zaloguj się kontem rodzica, dodaj próbne zadanie i sprawdź, czy widać je na drugim urządzeniu. Sprawdź również konto dziecka i uprawnienia do dokumentów.

Dla połączenia eduVULCAN ustaw też **serwerowe** zmienne Vercel według [docs/VULCAN.md](docs/VULCAN.md), opublikuj nowe reguły, a następnie połącz własne konto rodzica na swojej stronie z HTTPS. Hasła nie podajesz w czacie ani w kodzie.

Szczegółowe kroki dla Vercel, zwykłego hostingu i Firebase Hosting znajdziesz w [docs/WDROZENIE.md](docs/WDROZENIE.md). Konfigurację dostępu i kont opisuje [docs/FIREBASE.md](docs/FIREBASE.md).

## Telefon, tablet i komputer

Układ dopasowuje się do wielkości ekranu. Na telefonie nawigacja i formularze są dostosowane do dotyku; na większych ekranach widać więcej treści. Obracanie ekranu nie wymaga osobnej wersji aplikacji.

Możesz dodać skrót z ikoną do ekranu głównego:

- **iPhone/iPad, Safari:** Udostępnij → Dodaj do ekranu początkowego.
- **Android, Chrome:** menu → Zainstaluj aplikację lub Dodaj do ekranu głównego.
- **Komputer, Chrome:** ikona instalacji przy pasku adresu, jeśli przeglądarka ją udostępnia.

Wymagany jest HTTPS. Skrót otwiera tę samą aplikację i dane. PWA przechowuje wyłącznie publiczne pliki interfejsu. Dane rodziny, dokumenty, hasła i odpowiedzi Firebase nie trafiają do pamięci podręcznej service workera. Odczyt i zapis danych wymagają internetu. Nowa wersja pokaże przycisk **Odśwież**; zapisz otwarte formularze przed jego użyciem.

## Szkoła i eduVULCAN

Plan lekcji, oceny i informacje szkolne możesz prowadzić ręcznie albo importować z CSV/JSON. Wersja 1.5.0 dodaje backend i panel połączenia do konta rodzica w eduVULCAN, jawny wybór ucznia **SP4** oraz pobieranie tylko do odczytu. Odświeżanie uruchamia rodzic; nie ma harmonogramu pobierania w tle. Hasło nie jest zapisywane, a dostęp przez szyfrowaną sesję wygasa najpóźniej po 24 godzinach. Wygasły rekord jest usuwany przy sprawdzeniu stanu lub próbie wczytania sesji; nie ustawiono automatycznej polityki usuwania Firestore TTL.

**Połączenie nie zostało sprawdzone na rzeczywistym koncie rodziny.** Konfiguracja Vercel i poprawny build nie dowodzą udanego logowania ani pełnego zakresu danych. Nie umieszczaj hasła w kodzie. Szczegóły wdrożenia, wyboru SP4 i formatu importu: [docs/VULCAN.md](docs/VULCAN.md).

## Uruchomienie na komputerze

Zainstaluj Node.js 22 LTS (co najmniej 22.12), otwórz terminal w folderze projektu i wykonaj:

```bash
npm ci
npm run dev
```

Otwórz adres pokazany w terminalu. Bez kont Firebase i uprawnień aplikacja nie odczyta danych rodzinnych. Aby przygotować pliki na zwykły serwer:

```bash
npm run build
```

Na zwykły serwer wgrywasz **zawartość `dist`** — to organizer bez backendu eduVULCAN. Serwer statyczny nie potrzebuje Node.js ani PHP; Firebase pozostaje potrzebny do kont, danych i plików. Aby uruchomić także integrację, publikuj pełny projekt przez GitHub/Vercel. Sam `npm run dev` uruchamia frontend Vite, bez funkcji `/api/eduvulcan/...`.

## Ograniczenia

- Przypomnienia w otwartej aplikacji nie są gwarantowanymi alarmami systemowymi. Przeglądarka lub telefon może wstrzymać stronę w tle. Nie używaj ich jako jedynego przypomnienia o lekach.
- Widoczność sekcji na ekranie nie zastępuje uprawnień Firebase. Reguły z paczki i konta rodziny trzeba wdrożyć przed korzystaniem z prywatnych danych.
- Firebase może wymagać planu rozliczeniowego do Storage i niektórych usług. Sprawdź wymagania w swoim projekcie i włącz alerty budżetu.

## Sprawdzenie paczki

Wyniki kompilacji i sprawdzeń są opisane w raporcie przekazanym z paczką. Testy lokalne nie potwierdzają wdrożenia na Twoim Vercel ani połączenia z Twoją produkcyjną bazą Firebase.
