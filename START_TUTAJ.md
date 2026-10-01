# Nasza Rodzina 1.4.2 — zacznij tutaj

To nowa wersja Twojej aplikacji, przygotowana dla **GitHub + Vercel + Firebase**. Działa pod jednym adresem na telefonie, tablecie i komputerze, także po obróceniu ekranu. Zachowano domyślną konfigurację Firebase z przesłanego projektu.

Wersja **1.4.2** dodaje Twoje logo w interfejsie i ikonach oraz różowo-lawendową kolorystykę według przesłanego wzoru. Aktualizacja z uruchomionej wersji **1.4.0 lub 1.4.1** wymaga podmiany plików strony; korzysta z tych samych profili i reguł Firebase.

## Aktualizacja Twojej strony

1. **Zachowaj kopię** obecnego projektu i danych Firebase. ZIP z kodem nie zawiera kopii bazy ani dokumentów rodziny.
2. Przygotuj Firebase według [docs/FIREBASE.md](docs/FIREBASE.md): sprawdź profile `members/{UID}`, ustaw role `parent`/`child` i flagi dostępu, wykonaj migrację czatu oraz starszych dokumentów, a potem opublikuj nowe reguły. Dotychczasowe konta i hasła mogą zostać te same. Ten krok jest potrzebny również wtedy, gdy strona już działała.
3. Rozpakuj paczkę **PROJEKT**. Do [Twojego repozytorium GitHub](https://github.com/noe007-Kg/-nasza-rodzina-web) wgraj **zawartość folderu Nasza_Rodzina_v1.4.2**, tak aby `package.json` był w głównym katalogu projektu. Nie wgrywaj samego ZIP-a jako pliku aplikacji.
4. W [Vercel](https://vercel.com/noe007-kg/nasza-rodzina-web/deployments) ustaw: **Vite**, **Node 22.x**, instalacja `npm ci`, budowanie `npm run build`, wynik `dist`. Zapisanie zmian w połączonej gałęzi GitHuba uruchomi wdrożenie.
5. Dodaj domenę strony w Firebase → Authentication → Settings → Authorized domains. Dla pobierania dokumentów ustaw CORS bucketa według instrukcji Firebase.
6. Po statusie **Ready** otwórz stronę. Sprawdź logowanie rodzica i dziecka, dodaj próbny zakup i zobacz go na drugim urządzeniu. Na stronie ma być wersja **1.4.2**; skrót PWA można dodać na ekran główny z menu przeglądarki.

Szczegółowa instrukcja, także dla zwykłego serwera: [docs/WDROZENIE.md](docs/WDROZENIE.md). Paczka **STRONA** zawiera już zbudowaną stronę do hostowania statycznego z konfiguracją Firebase z przesłanego projektu; jej pliki możesz wgrać do katalogu głównego witryny po przygotowaniu Firebase. Dla Vercel używaj paczki **PROJEKT**.

## Szkoła i eduVULCAN

Szkoła zawiera plan lekcji, zadania domowe, sprawdziany, oceny, wiadomości i zajęcia. Dane wpisujesz ręcznie albo importujesz z CSV/JSON według szablonów dostępnych w aplikacji.

**Ta wersja nie pobiera automatycznie danych z eduVULCAN.** Przycisk otwiera oficjalną stronę logowania. Dostępny interfejs do prawdziwej synchronizacji wymaga dalszego potwierdzenia. Hasła do dziennika nie wpisujesz w Naszej Rodzinie. Szczegóły: [docs/VULCAN.md](docs/VULCAN.md).

Opis zmian wyglądu: [ZMIANY_1.4.2.md](ZMIANY_1.4.2.md). Stan gotowości: [STAN_PROJEKTU.md](STAN_PROJEKTU.md). Wyniki sprawdzeń tej aktualizacji i 54 testów podstawowej wersji: [RAPORT_TESTOW.md](RAPORT_TESTOW.md). Podglądy menu oraz ekranu Start znajdują się w `preview/` i pokazują dane testowe.
