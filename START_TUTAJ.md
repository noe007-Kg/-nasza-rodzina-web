# Nasza Rodzina 1.5.0 — zacznij tutaj

Szybka lista plików i kroków aktualizacji: [AKTUALIZACJA_1.5.0.md](AKTUALIZACJA_1.5.0.md).

To nowa wersja Twojej aplikacji, przygotowana dla **GitHub + Vercel + Firebase**. Działa pod jednym adresem na telefonie, tablecie i komputerze, także po obróceniu ekranu. Zachowano domyślną konfigurację Firebase z przesłanego projektu.

Wersja **1.5.0** zachowuje Twoje logo i różowo-lawendową kolorystykę oraz dodaje backend i panel połączenia eduVULCAN. Aktualizacja wymaga podmiany pełnego projektu, opublikowania nowych reguł Firebase i — jeśli chcesz połączyć dziennik — ustawienia sekretów serwerowych Vercel. Nie sprawdzono jeszcze połączenia na Twoim rzeczywistym koncie.

## Aktualizacja Twojej strony

1. **Zachowaj kopię** obecnego projektu i danych Firebase. ZIP z kodem nie zawiera kopii bazy ani dokumentów rodziny.
2. Przygotuj Firebase według [docs/FIREBASE.md](docs/FIREBASE.md): sprawdź profile `members/{UID}`, role `parent`/`child` i flagi dostępu. Przy przejściu ze starej wersji wykonaj opisaną migrację czatu i dokumentów. Opublikuj nowe reguły także przy aktualizacji z 1.4.x — chronią między innymi sesje dziennika i wiadomości rodziców. Konta i hasła Naszej Rodziny mogą zostać te same.
3. Rozpakuj paczkę **PROJEKT**. Do [Twojego repozytorium GitHub](https://github.com/noe007-Kg/-nasza-rodzina-web) wgraj **zawartość folderu Nasza_Rodzina_v1.5.0**, razem z `api/` i `server/`, tak aby `package.json` był w głównym katalogu projektu. Nie wgrywaj samego ZIP-a jako pliku aplikacji.
4. W [Vercel](https://vercel.com/noe007-kg/nasza-rodzina-web/deployments) ustaw: **Vite**, **Node 22.x**, instalacja `npm ci`, budowanie `npm run build`, wynik `dist`. Zapisanie zmian w połączonej gałęzi GitHuba uruchomi wdrożenie.
5. Dodaj domenę strony w Firebase → Authentication → Settings → Authorized domains. Dla pobierania dokumentów ustaw CORS bucketa. Jeśli włączasz eduVULCAN, przygotuj klucz Firebase Admin i klucz szyfrowania wyłącznie w zmiennych serwerowych Vercel według [docs/VULCAN.md](docs/VULCAN.md). Po zapisaniu ustawień wykonaj nowe wdrożenie.
6. Po statusie **Ready** otwórz stronę. Sprawdź logowanie rodzica i dziecka, dodaj próbny zakup i zobacz go na drugim urządzeniu. Na stronie ma być wersja **1.5.0**; skrót PWA można dodać na ekran główny z menu przeglądarki.

Szczegółowa instrukcja, także dla zwykłego serwera: [docs/WDROZENIE.md](docs/WDROZENIE.md). Paczka **STRONA** zawiera statyczny organizer z konfiguracją Firebase z przesłanego projektu; możesz wgrać ją do katalogu głównego witryny. **Nie uruchamia backendu eduVULCAN.** Dla Vercel z integracją używaj paczki **PROJEKT**.

## Szkoła i eduVULCAN

Szkoła zawiera plan lekcji, zadania domowe, sprawdziany, oceny, wiadomości i zajęcia. Dane wpisujesz ręcznie albo importujesz z CSV/JSON według szablonów dostępnych w aplikacji.

Po wdrożeniu i skonfigurowaniu backendu rodzic może użyć panelu połączenia. Wpisz login i hasło wyłącznie do formularza na swojej stronie z HTTPS, wybierz właściwe dziecko i **SP4**, a potem uruchom odświeżenie. Jeśli pojawia się także przedszkole, nie wybieraj go zamiast szkoły. Sesja jest szyfrowana i ważna maksymalnie 24 godziny; hasło nie jest zapisywane. Kolejne udane pobrania mają limit 5 minut. Wiadomości rodzica pozostają dostępne tylko rodzicom.

**Nie potwierdzono udanego połączenia na rzeczywistym koncie rodziny**; logowanie i kompletność danych trzeba sprawdzić po wdrożeniu. Nie ma pobierania według harmonogramu ani wysyłania wiadomości do nauczycieli. Hasła i kluczy nie podawaj w czacie. Instrukcja: [docs/VULCAN.md](docs/VULCAN.md).

Opis nowej integracji: [ZMIANY_1.5.0.md](ZMIANY_1.5.0.md). Zachowany wygląd: [ZMIANY_1.4.2.md](ZMIANY_1.4.2.md). Stan gotowości: [STAN_PROJEKTU.md](STAN_PROJEKTU.md). Wykonane sprawdzenia i ich zakres: [RAPORT_TESTOW.md](RAPORT_TESTOW.md). Podglądy w `preview/` pokazują dane testowe.
