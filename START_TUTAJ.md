# Nasza Rodzina 1.5.1 — zacznij tutaj

Szybka lista plików i kroków aktualizacji: [AKTUALIZACJA_1.5.1.md](AKTUALIZACJA_1.5.1.md).

To nowa wersja Twojej aplikacji, przygotowana dla **GitHub + Vercel + Firebase**. Działa pod jednym adresem na telefonie, tablecie i komputerze, także po obróceniu ekranu. Zachowano domyślną konfigurację Firebase z przesłanego projektu.

Wersja **1.5.1** poprawia dostęp do eduVULCAN: aktywni rodzice mają jedno wspólne połączenie, status i dane wybranego ucznia. Możesz połączyć aktywne konto eduVULCAN Dominiki z dziennikiem Nikodema/SP4, a następnie korzystać z danych przez konta Sebastiana i Dominiki w Naszej Rodzinie. Logo, kolorystyka i wygląd pozostałych modułów pozostają zachowane. Aktualizacja z 1.5.0 nie wymaga nowych zmiennych Vercel; zachowaj istniejące klucze. Nie sprawdzono jeszcze połączenia na Twoim rzeczywistym koncie.

## Aktualizacja Twojej strony

1. **Zachowaj kopię** obecnego projektu i danych Firebase. ZIP z kodem nie zawiera kopii bazy ani dokumentów rodziny.
2. Przygotuj Firebase według [docs/FIREBASE.md](docs/FIREBASE.md): sprawdź profile `members/{UID}`, role `parent`/`child` i flagi dostępu. Profile Sebastiana i Dominiki muszą mieć `role: parent`, `active: true` i `canLogin: true`. Przy przejściu ze starej wersji wykonaj opisaną migrację czatu i dokumentów. Opublikuj reguły tej paczki — chronią między innymi sesje dziennika i rozdzielone wiadomości. Konta i hasła Naszej Rodziny mogą zostać te same.
3. Rozpakuj paczkę **PROJEKT**. Do [Twojego repozytorium GitHub](https://github.com/noe007-Kg/-nasza-rodzina-web) wgraj **zawartość folderu Nasza_Rodzina_v1.5.1**, razem z `api/` i `server/`, tak aby `package.json` był w głównym katalogu projektu. Nie wgrywaj samego ZIP-a jako pliku aplikacji.
4. W [Vercel](https://vercel.com/noe007-kg/nasza-rodzina-web/deployments) ustaw: **Vite**, **Node 22.x**, instalacja `npm ci`, budowanie `npm run build`, wynik `dist`. Zapisanie zmian w połączonej gałęzi GitHuba uruchomi wdrożenie.
5. Dodaj domenę strony w Firebase → Authentication → Settings → Authorized domains. Dla pobierania dokumentów ustaw CORS bucketa. Jeśli włączasz eduVULCAN, przygotuj klucz Firebase Admin i klucz szyfrowania wyłącznie w zmiennych serwerowych Vercel według [docs/VULCAN.md](docs/VULCAN.md). Po zapisaniu ustawień wykonaj nowe wdrożenie.
6. Po statusie **Ready** otwórz stronę. Sprawdź logowanie rodzica i dziecka, dodaj próbny zakup i zobacz go na drugim urządzeniu. Na stronie ma być wersja **1.5.1**; skrót PWA można dodać na ekran główny z menu przeglądarki.

Szczegółowa instrukcja, także dla zwykłego serwera: [docs/WDROZENIE.md](docs/WDROZENIE.md). Paczka **STRONA** zawiera statyczny organizer z konfiguracją Firebase z przesłanego projektu; możesz wgrać ją do katalogu głównego witryny. **Nie uruchamia backendu eduVULCAN.** Dla Vercel z integracją używaj paczki **PROJEKT**.

## Szkoła i eduVULCAN

Szkoła zawiera plan lekcji, zadania domowe, sprawdziany, oceny, wiadomości i zajęcia. Dane wpisujesz ręcznie albo importujesz z CSV/JSON według szablonów dostępnych w aplikacji.

Po wdrożeniu i skonfigurowaniu backendu zaloguj się w Naszej Rodzinie jako Sebastian albo Dominika. W panelu **Połącz konto** wpisz login/e-mail i hasło aktywnego konta eduVULCAN Dominiki, a potem wybierz **Połącz**. Wybierz jawnie profil **Nikodema w SP4** i przypisz go **Nikodemowi**. Jeśli pojawia się także przedszkole, pomiń je. Drugie konto rodzica korzysta z tego samego połączenia bez ponownego wpisywania hasła. Dostępne są **Sprawdź stan połączenia**, **Synchronizuj teraz** i **Rozłącz**; panel pokazuje stan, ucznia i ostatnią udaną synchronizację.

Po aktualizacji z 1.5.0 połącz dziennik raz ponownie. Stare indywidualne sesje rodziców zostaną zastąpione wspólną sesją, a pobrane wcześniej dane szkolne pozostaną zachowane. Sesja jest szyfrowana i ważna maksymalnie 24 godziny; hasło nie jest zapisywane. Kolejne udane pobrania mają wspólny limit 5 minut. Wiadomości z konta rodzica pozostają dostępne tylko rodzicom. Oddzielny zakres dla przyszłego połączenia ucznia jest przygotowany na serwerze; formularz dla dziecka nie jest obecnie włączony.

**Nie potwierdzono udanego połączenia na rzeczywistym koncie rodziny**; logowanie i kompletność danych trzeba sprawdzić po wdrożeniu. Nie ma pobierania według harmonogramu ani wysyłania wiadomości do nauczycieli. Hasła i kluczy nie podawaj w czacie. Instrukcja: [docs/VULCAN.md](docs/VULCAN.md).

Opis poprawki: [ZMIANY_1.5.1.md](ZMIANY_1.5.1.md). Pierwsza wersja integracji: [ZMIANY_1.5.0.md](ZMIANY_1.5.0.md). Zachowany wygląd: [ZMIANY_1.4.2.md](ZMIANY_1.4.2.md). Stan gotowości: [STAN_PROJEKTU.md](STAN_PROJEKTU.md). Wykonane sprawdzenia i ich zakres: [RAPORT_TESTOW.md](RAPORT_TESTOW.md). Podglądy w `preview/` pokazują dane testowe.
