# Szkoła i eduVULCAN

Wersja **1.5.1**, stan: 2 października 2026 r. Moduł „Szkoła” zachowuje ręczne wpisy i import CSV/JSON oraz korzysta z serwerowego połączenia do portalu **uczen.eduvulcan.pl**. Aktywni rodzice mają **jedno wspólne połączenie rodzinne**. Przed użyciem integracji trzeba wdrożyć pełny projekt z funkcjami Vercel i ustawić sekretne zmienne serwerowe opisane poniżej. Aktualizacja z 1.5.0 nie wymaga żadnych nowych zmiennych środowiskowych.

W paczce jest kod połączenia, wyboru ucznia i pobierania danych tylko do odczytu. **Nie sprawdzono udanego logowania ani pobrania danych z rzeczywistego konta rodziny/SP4.** Zidentyfikowanie endpointów portalu i lokalne testy nie potwierdzają całego procesu na Twoim koncie. Jeżeli portal zmieni logowanie, wymaga dodatkowego potwierdzenia lub odmówi dostępu, aplikacja ma pokazać błąd; nie tworzy przykładowych danych zamiast wyniku dziennika.

## Co działa teraz

- Przycisk „Otwórz eduVULCAN” pozwala przejść do dziennika w osobnej karcie. Aktywny rodzic ma formularz **Połącz konto** oraz przyciski **Połącz**, **Sprawdź stan połączenia**, **Synchronizuj teraz** i **Rozłącz**. Panel pokazuje wspólny stan, wybranego ucznia i czas ostatniej udanej synchronizacji.
- Konta Naszej Rodziny Sebastiana i Dominiki z rolą `parent` korzystają z tej samej sesji. Login/e-mail i hasło wpisujesz do aktywnego konta eduVULCAN Dominiki; wybranym uczniem jest Nikodem/SP4. Konto logowania dziennika i konto zalogowane w rodzinnej aplikacji są odrębne. Backend nie wymaga zgodności nazw rodzica i ucznia.
- Rodzic może dodawać i edytować ręczne wpisy dla wszystkich dzieci oraz importować JSON/CSV. Dziecko widzi własne dane; uzupełnia własne lekcje, zadania, sprawdziany i zajęcia. Ręczne oceny i wiadomości uzupełnia rodzic. Wpisy oznaczone jako pochodzące z eduVULCAN aktualizuje wyłącznie backend integracji; nie edytuje się ich jak notatek.
- Lekcje i zajęcia można zapisać na konkretny dzień lub jako plan powtarzający się w wybranym dniu tygodnia.
- Zajęcia dodatkowe dodawane lub edytowane przez formularz można połączyć z rodzinnym kalendarzem. Sam import zapisuje wpisy szkolne i nie tworzy wydarzeń kalendarza.
- Dane zapisuje Firebase/Firestore projektu rodziny. Dostęp wymaga konfiguracji opisanej w [FIREBASE.md](FIREBASE.md), zalogowanego konta i przypisanej roli.

Integracja jest wyłącznie do odczytu. Nie wysyła wiadomości nauczycielom i nie zmienia ocen ani danych w dzienniku. Synchronizację inicjuje dowolny aktywny rodzic przyciskiem; nie ma harmonogramu cron ani obietnicy pobierania w tle. Rodzice dzielą też limit synchronizacji i stan rozłączenia. Ręczne wpisy i import pozostają dostępne także bez połączenia.

## Co pobiera obecny adapter

Zakres dotyczy **jednego, jawnie wybranego profilu szkoły i dziecka**, potwierdzonego w `Context` portalu. Backend odrzuca profil przedszkolny oraz niejednoznaczne powiązanie ucznia. Daty okien wylicza według polskiej strefy `Europe/Warsaw`.

| Dane | Zakres i sposób odczytu |
| --- | --- |
| Oceny | `OkresyKlasyfikacyjne` i pełne `Oceny` dla okresu obejmującego dzisiejszą datę. Oceny cząstkowe, poprawy, opisowe, proponowane i okresowe oraz podsumowania pozostają tekstem dziennika. Nie przeliczamy ocen opisowych na stopnie ani nie wymyślamy średniej; zachowujemy podaną przez szkołę, jeśli jest dostępna. |
| Plan lekcji | `PlanZajec`: konkretne daty od **7 dni wstecz do 21 dni naprzód**, z godzinami, salą, nauczycielem i informacjami o zmianach lub odwołaniu. To plan datowany, nie powtarzanie stałego tygodnia. |
| Zadania i sprawdziany | `SprawdzianyZadaniaDomowe`: od **7 dni wstecz do 30 dni naprzód**. Szczegóły przez `ZadanieDomoweSzczegoly` albo `SprawdzianSzczegoly`, najwyżej dla **30 wpisów** na pobranie tej sekcji. Dla zadań zachowujemy termin odpowiedzi, jeśli portal go podaje. |
| Wiadomości rodzica | `OdebraneSkrzynka` dla `globalKeySkrzynka` wybranego profilu, najwyżej **30 ostatnich wiadomości**, oraz GET `WiadomoscSzczegoly`. Treść jako zwykły tekst, do **20 000 znaków**. Nie wczytujemy zewnętrznych obrazków i nie pobieramy załączników; załączniki pozostają dostępne w oficjalnym dzienniku. |

Jedna synchronizacja zapisuje najwyżej **400 wpisów łącznie**. Nie jest to eksport całej historii dziennika. Osiągnięcie limitu szczegółów, rozmiaru lub czasu może dać częściowy wynik i komunikat z zakresem, którego nie pobrano. Liczba zero przy ostrzeżeniu nie jest potwierdzeniem, że w dzienniku nie ma wpisów.

Udane sekcje można zapisać mimo błędu innej sekcji. **Nieudany odczyt zachowuje wcześniej pobrane dane tej sekcji.** Gdy cały bieżący zakres ocen albo datowany zakres planu został poprawnie odczytany, backend usuwa z lokalnej kopii wycofane oceny i nieaktualne lekcje wyłącznie wybranego profilu i dziecka. Nie usuwa ręcznych wpisów, danych innych dzieci, ocen innych okresów ani planu poza pobranym oknem. Nie wykonuje takiego usuwania dla częściowo odczytanych zadań lub wiadomości.

Wszystkie żądania danych dziennika są **GET**; logowanie i przekazywanie formularzy SSO mogą używać POST. Backend nie wysyła `PUT` oznaczającego wiadomość jako przeczytaną, odpowiedzi do nauczyciela, usuwania ani przenoszenia wiadomości. Frekwencja, archiwalne okresy, załączniki i inne zakresy nie zostały dodane do tej integracji.

## Logowanie w obecnej wersji portalu

Adapter korzysta z formularza [`/logowanie`](https://eduvulcan.pl/logowanie), jego tokenu anty-CSRF, pól `UserName`/`Password` oraz zapytania `Account/QueryUserInfo`. Jeśli portal wymaga swojego opublikowanego widgetu obliczeniowego (`ShowCaptcha`), adapter wykonuje to obliczenie w ograniczonym czasie. Nieznane dodatkowe lub interaktywne potwierdzenie logowania kończy się komunikatem o konieczności sprawdzenia konta w oficjalnym portalu.

Po zalogowaniu odczytuje listę dostępów także z aktualnego panelu [`/dostep-do-dziennika/`](https://eduvulcan.pl/dostep-do-dziennika/). Dopiero potwierdzenie profilu przez rodzica rozpoczyna wejście do konkretnego dziennika i jego SSO. Portal wiadomości ma osobne przejście logowania z tą samą sesją. Wybrana skrzynka pochodzi z identyfikatora konkretnego profilu; wiadomości nie są przypisywane dziecku na podstawie słów w temacie lub imieniu.

## Wdrożenie integracji na Twoim Vercel

Użyj paczki **PROJEKT 1.5.1**, z katalogami `api/` i `server/`. Wgranie samego `dist` lub paczki **STRONA** uruchamia organizer, ale nie uruchamia funkcji integracji. Dotychczasowy statyczny Firebase Hosting i Docker/nginx również nie uruchamiają tego backendu.

1. W swoim Firebase przygotuj profile rodziny oraz opublikuj reguły z tej paczki według [FIREBASE.md](FIREBASE.md). Wspólną integracją zarządza zalogowany użytkownik z profilem `members/{UID}`: `role: parent`, `active: true`, `canLogin: true`. Te pola sprawdza serwer po weryfikacji tokenu Firebase. Pola `name` i `personKey` nadal służą aplikacji do prezentacji i powiązania danych, ale autoryzacja rodzica w integracji nie wymaga zgodności nazwy z krótkim imieniem. Dla Sebastiana i Dominiki ustaw rolę na ich rzeczywistych UID z Authentication; nazwa lub e-mail nie nadają uprawnień.
2. W **Firebase Console → Project settings → Service accounts → Firebase Admin SDK → Generate new private key** pobierz plik JSON dla tego samego projektu, którego używa aplikacja. Zachowaj plik poza repozytorium i katalogiem strony. Nie przesyłaj go w czacie.
3. W **Vercel → projekt nasza-rodzina-web → Settings → Environment Variables** dodaj poniższe zmienne dla **Production**. Nie dodawaj ich do `VITE_*` ani do plików `public`/`dist`.

   | Zmienna | Wymagana | Wartość |
   | --- | --- | --- |
   | `FIREBASE_PROJECT_ID` | Tak | Identyfikator Twojego projektu, np. `nasza-rodzina`; taki sam jak `VITE_FIREBASE_PROJECT_ID` i `project_id` w kluczu. |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` **albo** `FIREBASE_SERVICE_ACCOUNT_BASE64` | Dokładnie jeden wariant | Pełna zawartość klucza Firebase Admin w JSON albo ten sam plik zakodowany w base64. |
   | `EDUVULCAN_ENCRYPTION_KEY_BASE64` | Tak | Losowy klucz 32-bajtowy zakodowany w base64; zachowaj istniejącą wartość przy aktualizacji. |
   | `EDUVULCAN_ENCRYPTION_KEY_ID` | Nie | Domyślnie `v1`; zachowaj wartość zgodną z dotychczasowym kluczem. |
   | `EDUVULCAN_SESSION_TTL_HOURS` | Nie | Domyślnie `24`; dopuszczalny zakres to 1–24 godziny. |
   | `EDUVULCAN_SITE_ORIGIN` | Nie | Dokładny adres produkcyjnej aplikacji, np. `https://twoja-rodzina.vercel.app`, bez dodatkowej ścieżki. Gdy puste, serwer porównuje origin z hostem żądania. |

   **Nowe zmienne wymagane w 1.5.1: żadne.** Model wspólnego połączenia nie wymaga ustawiania UID rodziców, loginu, hasła, tokenów ani kodów aktywacyjnych w Vercel. Publiczne `VITE_FIREBASE_*` pozostają bez zmian.

4. W terminalu na swoim komputerze z Node.js wygeneruj klucz szyfrowania. **Nie uruchamiaj tego polecenia podczas każdego buildu** — wynik ma pozostać stałą, prywatną wartością w Vercel:

   ```bash
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Skopiuj wynik wyłącznie do `EDUVULCAN_ENCRYPTION_KEY_BASE64` w Vercel i przechowaj bezpiecznie. Nie wklejaj go do rozmowy ani repozytorium. Jeśli klucz jest już skonfigurowany z 1.5.0, pozostaw jego wartość — nie generuj nowej tylko z powodu tej aktualizacji. Zmiana klucza lub jego ID unieważni odczyt zapisanych sesji; dziennik trzeba wtedy połączyć ponownie.

5. Zamiast `FIREBASE_SERVICE_ACCOUNT_JSON` możesz użyć `FIREBASE_SERVICE_ACCOUNT_BASE64` z tym samym plikiem zakodowanym w base64. Ustaw **tylko jeden** z tych dwóch wariantów; base64 jest sposobem zapisu, nie szyfrowaniem. Opcjonalne polecenie lokalne:

   ```bash
   node -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))" "/prywatna/sciezka/firebase-admin.json"
   ```

6. Do GitHub wgraj pełny projekt razem z `api/`, `server/` i `package-lock.json`, bez prawdziwych sekretów. Ustaw Vercel: **Vite**, **Node 22.x**, `npm ci`, `npm run build`, wynik `dist`. Po zapisaniu zmiennych wykonaj nowe wdrożenie.
7. Dodaj domenę w Firebase Authentication → Authorized domains. Po statusie **Ready** zaloguj się jako rodzic i otwórz Szkołę. Brak konfiguracji serwera powinien wyświetlić czytelny komunikat, nie formularz udający połączenie.

Klucz administratora Firebase ma dostęp do danych poza regułami klienta. Udostępniaj go tylko swojemu projektowi Vercel. Nie ustawiaj produkcyjnych sekretów dla przypadkowych podglądów pull requestów. Jeśli testujesz własny Preview, użyj właściwej domeny i osobnych ustawień środowiska. Backend Vercel wymaga jawnego klucza; ścieżka `GOOGLE_APPLICATION_CREDENTIALS` z Twojego komputera nie działa jako plik w Vercel.

## Połączenie konta i wybór SP4

1. Zaloguj się do Naszej Rodziny kontem rodzica. Otwórz **Szkoła → eduVULCAN**.
2. W formularzu **Połącz konto** wpisz login/e-mail i hasło aktywnego konta eduVULCAN Dominiki na swojej stronie z HTTPS i wybierz **Połącz**. Możesz wykonać ten krok będąc zalogowanym w Naszej Rodzinie jako Sebastian albo Dominika, jeżeli konto ma aktywną rolę rodzica. UUID i kod aktywacyjny z dziennika nie zastępują danych logowania do istniejącego konta. Formularz wysyła hasło do backendu tylko w żądaniu logowania; hasło nie jest zapisywane w Firestore ani w konfiguracji aplikacji.
3. Po udanym logowaniu sprawdź listę uczniów i placówek. Dla planowanego połączenia wybierz jawnie profil **Nikodema w SP4** i przypisz go Nikodemowi w Naszej Rodzinie. Jeśli konto zawiera również przedszkole, pomiń ten profil. Aplikacja nie zgaduje szkoły na podstawie imienia ani nie wybiera pierwszej placówki.
4. Przypisz wybrany profil do właściwego dziecka w Naszej Rodzinie. Sprawdź szkołę i klasę, a potem wybierz **Połącz wybrany dziennik**. Wybór zapisuje się od razu i uruchamia próbę pobrania danych.
5. Sprawdź wspólny status, nazwę Nikodema i datę ostatniej udanej synchronizacji. Z drugiego konta rodzica wybierz **Sprawdź stan połączenia** — zobaczysz ten sam dziennik bez ponownego wpisywania danych. Kolejne pobrania uruchamiaj przez **Synchronizuj teraz**. Udane synchronizacje są ograniczone do jednej na **5 minut dla całego wspólnego połączenia**; zmiana konta rodzica lub przeładowanie strony nie omija tego limitu.
6. Po wygaśnięciu sesji połącz konto ponownie. **Dostęp przez zapisaną sesję jest ważny maksymalnie 24 godziny**, a eduVULCAN może unieważnić go wcześniej. Nie przechowujemy hasła do automatycznego ponownego logowania. Ten limit dotyczy możliwości użycia sesji na serwerze; nie oznacza automatycznego fizycznego usunięcia rekordu z Firestore dokładnie po 24 godzinach.

Jeżeli SP4 lub właściwy uczeń nie pojawi się na liście, nie wybieraj przedszkola jako zamiennika. Sprawdź uprawnienia i powiązania swojego konta w dzienniku. Przy błędzie logowania najpierw sprawdź to samo konto na oficjalnej stronie; dodatkowe kroki logowania mogą wymagać dopracowania adaptera.

Wybierz **Rozłącz** i potwierdź rozłączenie, aby usunąć wspólną zapisaną sesję z Naszej Rodziny. Dotyczy to wszystkich rodziców. Wcześniej pobrane wpisy szkolne pozostają w organizerze; rozłączenie nie usuwa konta ani danych w eduVULCAN.

Przy aktualizacji z 1.5.0 połącz dziennik **raz ponownie**. Backend używa teraz jednego dokumentu `_eduConnections/family`, a wcześniejsze sesje zapisane pod UID rodziców nie są używane jako wspólna sesja. Przy połączeniu porządkuje stare indywidualne sesje rodziców; pobrane wcześniej wpisy szkolne pozostają zachowane. Nie kopiuj ani nie odszyfrowuj dokumentów sesji ręcznie.

## Prywatność i zakres techniczny

- Endpointy `/api/eduvulcan/status`, `connect`, `select`, `sync` i `disconnect` sprawdzają token Firebase oraz aktualny profil użytkownika na każdym żądaniu. Domyślny zakres rodzinny wymaga aktywnego rodzica. Wybrany profil musi pochodzić z jednej zapisanej sesji rodziny. Żądanie nie może wskazać dowolnego właściciela sesji przez UID.
- Backend przechowuje sesję/cookies w zaszyfrowanej postaci AES-256-GCM w `_eduConnections/family`. Hasło nie jest przechowywane. Szyfrowanie wiąże sesję z identyfikatorem konkretnego połączenia i zakresem; klucz jest osobno w Vercel. Przeglądarka nie ma dostępu do kolekcji sesji. Wygasła sesja przestaje dawać dostęp; zaszyfrowany rekord jest usuwany przy sprawdzeniu stanu lub próbie użycia. Paczka **nie konfiguruje automatycznej polityki Firestore TTL**: bez osobnego ustawienia jej w Firebase rekord może pozostać w bazie do następnego żądania albo rozłączenia konta.
- Pobraną szkołę zapisujemy w Firestore. Dziecko widzi własne oceny, plan i sprawdziany zgodnie z regułami. Wiadomości pobrane z konta rodzica trafiają do `schoolParentMessages` i są dostępne **wyłącznie rodzicom**. Ręczne wiadomości/notatki w organizerze pozostają osobną funkcją.
- Odpowiedzi integracji nie są cache'owane przez PWA. Hasła, cookies i tokeny nie powinny trafiać do logów ani eksportu danych interfejsu.
- Zakres danych zależy od odpowiedzi portalu i praw zalogowanego konta. Nie potwierdzono jeszcze kompletności ocen, planu, sprawdzianów ani wiadomości na Twoim rzeczywistym koncie. Nie jest to oficjalny plugin ani oficjalnie gwarantowane API eduVULCAN.

## Przygotowanie przyszłego konta ucznia

Zakres połączenia jest oddzielony od roli konta logującego do eduVULCAN. Domyślny zakres `family` pozostaje wspólny dla rodziców. Serwer obsługuje także odrębny zakres `student`, wskazywany przez nagłówek `x-edu-connection-scope: student`; identyfikator połączenia wyprowadza z UID zweryfikowanego użytkownika, a nie z podanego przez klienta UID.

Uczeń może w tym zakresie korzystać tylko ze swojej osoby i szkolnej tożsamości zatwierdzonej przez rodzica w prywatnym `_eduStudentBindings/{personKey}`. Brak zatwierdzonego powiązania albo wybór innego ucznia kończy się odmową. Takie połączenie ma własną sesję, blokady, status i synchronizację. Uczeń nie uzyskuje dostępu do `schoolParentMessages` ani rodzinnej sesji rodzica.

**Pobieranie wiadomości w zakresie ucznia jest wyłączone.** Adapter pomija żądania wiadomości, a zapis serwerowy odrzuca wiadomości w tym zakresie. Do włączenia tej funkcji potrzebne będzie potwierdzenie roli właściciela skrzynki po stronie eduVULCAN; sam wybór profilu dziecka nie dowodzi, że sesja pochodzi z konta ucznia. Przygotowane reguły przyszłej kolekcji `schoolStudentMessages` dopuszczają wyłącznie właściciela konta ucznia, bez dostępu rodziców i rodzeństwa.

**Formularz połączenia ucznia nie jest obecnie włączony w interfejsie.** Przygotowany zakres pozwala dodać go później bez wykorzystania danych logowania rodzica. Nie wymaga nowego klucza lub osobnych zmiennych Vercel.

## Problemy po wdrożeniu

| Komunikat/objaw | Co sprawdzić |
| --- | --- |
| Integracja nie jest skonfigurowana | Zmienne serwerowe w Production, poprawny projekt klucza JSON, klucz szyfrowania i nowe wdrożenie po zmianie ustawień. |
| Endpoint `/api/eduvulcan/...` zwraca 404 lub HTML | Czy opublikowano pełny projekt z `api/`, a nie sam `dist`; Vite `npm run dev` również nie uruchamia funkcji Vercel. |
| Dostęp tylko dla rodzica | Czy zweryfikowany UID konta Naszej Rodziny ma profil `members/{UID}` z `role: parent`, `active: true` i `canLogin: true`. Pełne nazwisko lub brak krótkiego `personKey` rodzica nie powinny blokować tego panelu w 1.5.1. |
| Niedozwolona domena | `EDUVULCAN_SITE_ORIGIN` musi odpowiadać domenie otwartej aplikacji i właściwemu środowisku. |
| Sesja wygasła lub nie można jej odczytać | Połącz ponownie; sprawdź, czy nie zmieniono klucza szyfrowania/ID. |
| Poczekaj na odświeżenie | Limit 5 minut lub trwające pobieranie. Nie uruchamiaj wielu równoległych prób. |
| Logowanie do eduVULCAN lub pobranie nie działa | Poprawne własne konto na oficjalnej stronie, uprawnienia do SP4 i aktualny mechanizm portalu. Sam poprawny build nie potwierdza tego kroku. |

## Import CSV albo JSON

Szablony dostępne są w oknie „Importuj plik” i w katalogu `public`:

- [szkola-szablon.csv](../public/szkola-szablon.csv)
- [szkola-szablon.json](../public/szkola-szablon.json)

To **format Naszej Rodziny**, przygotowywany samodzielnie. Nie jest potwierdzonym formatem eksportu eduVULCAN. Przepisz do niego potrzebne informacje z własnego dziennika albo przygotuj plik w arkuszu kalkulacyjnym. Zapisz CSV jako UTF-8; separator może być przecinkiem albo średnikiem.

1. Pobierz szablon i uzupełnij jego wiersze. Przykładowe daty zastąp aktualnymi.
2. Zaloguj się jako rodzic, otwórz „Szkoła”, a następnie „Importuj plik”.
3. Wybierz plik `.csv` lub `.json`. Aplikacja sprawdzi cały plik i pokaże podgląd.
4. Sprawdź osoby, terminy i treść. Dopiero przycisk zatwierdzenia zapisuje dane w Firestore.

CSV wymaga dokładnie takiego nagłówka i kolejności kolumn:

```csv
person,type,title,subject,date,time,endTime,weekday,note
Nikodem,lesson,Matematyka,Matematyka,,08:00,08:45,1,Sala 12
Paweł,grade,5,Matematyka,2026-10-02,,,0,Kartkówka
Layla,message,Zebranie rodziców,,2026-10-05,,,0,Zebranie o 17:00
```

W JSON użyj tablicy obiektów z tymi samymi nazwami pól:

```json
[
  {
    "person": "Nikodem",
    "type": "lesson",
    "title": "Matematyka",
    "subject": "Matematyka",
    "date": "",
    "time": "08:00",
    "endTime": "08:45",
    "weekday": 1,
    "note": "Sala 12"
  }
]
```

| Pole | Zasada |
| --- | --- |
| `person` | `Paweł`, `Nikodem` albo `Layla`; dokładna pisownia |
| `type` | `lesson`, `homework`, `test`, `grade`, `message` albo `activity` |
| `title` | Wymagany tekst, do 160 znaków; dla oceny np. `5` lub `4+` |
| `subject` | Nazwa przedmiotu, do 100 znaków; może być pusta |
| `date` | Data `RRRR-MM-DD`; wymagana dla zadania i sprawdzianu |
| `time`, `endTime` | Godziny `GG:MM`; wymagane dla lekcji i zajęć; zakończenie po rozpoczęciu |
| `weekday` | `0` oznacza brak powtarzania; `1` poniedziałek, …, `7` niedziela; tylko lekcje i zajęcia |
| `note` | Treść/notatka, do 2000 znaków; może być pusta |

Dla lekcji i zajęć podaj **albo** datę i `weekday: 0`, **albo** pustą datę i dzień tygodnia `1–7`. Godziny oznaczają lokalny czas pokazywany przez przeglądarkę; dla planu szkoły ustaw urządzenie na polską strefę czasową. CSV przechowuje teksty z przecinkami, średnikami, cudzysłowami lub nowymi liniami w cudzysłowie zgodnie z zasadami CSV; cudzysłów w wartości zapisuje się podwójnie.

Limit jednego importu to **200 wierszy i 1 MiB**. Nieznane pola, nieznane osoby, błędne daty i godziny powodują odrzucenie całego pliku przed zapisem. Nie dodawaj loginów, haseł, tokenów ani kodów parowania jako dodatkowych kolumn. Oceny i wiadomości są zwykłymi wpisami tekstowymi, bez obliczania oficjalnej średniej lub statusu odczytu w dzienniku.

Import rozpoznaje identyczne importowane wpisy po całej treści i pomija powtórzenia. Nie zastępuje istniejących wpisów. Zmieniony wiersz jest nowym wpisem, a identyczny wpis wcześniej dodany ręcznie może zostać dodany ponownie — po imporcie sprawdź listę.

## Co udało się potwierdzić o integracji

Na 1 października 2026 r. przejrzano aktualne publiczne implementacje korzystające z portali `uczen.eduvulcan.pl` i `wiadomosci.eduvulcan.pl`. Poniższe linki prowadzą do konkretnych przejrzanych wersji kodu, a nie do zmiennej gałęzi. Są źródłami ustaleń o protokole, nie oficjalną dokumentacją producenta i nie dowodem udanego połączenia konta rodziny:

| Źródło | Co potwierdza |
| --- | --- |
| [htomasz/vultron — vultron.py](https://github.com/htomasz/vultron/blob/69cbc4a6ef3f93e53f2b6d805afe7d9c15bd9d07/vultron/vultron.py) | Odczyt współczesnych API ucznia i wiadomości, okresy ocen, zmiany planu i rozdzielone skrzynki placówek. |
| [budzikt/edu-vulcan-mcp — auth.ts](https://github.com/budzikt/edu-vulcan-mcp/blob/bf7cbbfb1623b3b3b559be30158276704ab4f0a8/auth.ts) i [grades.ts](https://github.com/budzikt/edu-vulcan-mcp/blob/bf7cbbfb1623b3b3b559be30158276704ab4f0a8/grades/grades.ts) | Sesje HTTP z cookies i formularzami federacji oraz szczegółowy format ocen, w tym tryb opisowy. |
| [tumski/eduvulcan-cli — fetch.ts](https://github.com/tumski/eduvulcan-cli/blob/b582b14d8a0a0fa86777e53185d699c8dbc834c7/src/fetch.ts) i [types.ts](https://github.com/tumski/eduvulcan-cli/blob/b582b14d8a0a0fa86777e53185d699c8dbc834c7/src/types.ts) | Plan, lista zadań i ich szczegóły w nowoczesnym API webowym. Automatyczny wybór pierwszego profilu z tej implementacji nie jest używany w Naszej Rodzinie. |
| [DzienniczekSzpontniczek — PrometheusMessagesApi.kt](https://github.com/szponciciel04/DzienniczekSzpontniczek/blob/73d35c3d4a331fe009919004df860c9e97067374/composeApp/src/commonMain/kotlin/io/github/szpontium/api/prometheus/PrometheusMessagesApi.kt) | Osobne SSO wiadomości, nagłówki, GET treści oraz oddzielny PUT oznaczający przeczytanie, którego nie używamy. |
| [PrometheusMailbox.kt](https://github.com/szponciciel04/DzienniczekSzpontniczek/blob/73d35c3d4a331fe009919004df860c9e97067374/composeApp/src/commonMain/kotlin/io/github/szpontium/api/prometheus/models/PrometheusMailbox.kt) i [PrometheusMessage.kt](https://github.com/szponciciel04/DzienniczekSzpontniczek/blob/73d35c3d4a331fe009919004df860c9e97067374/composeApp/src/commonMain/kotlin/io/github/szpontium/api/prometheus/models/PrometheusMessage.kt) | Pola identyfikatora skrzynki, nadawcy, treści i metadanych załączników. |
| [omirek/eduvulcan-scraper — index.js](https://github.com/omirek/eduvulcan-scraper/blob/761e402df280449579bc303afb3bdc8fc8e0e600/index.js) | Endpoint listy sprawdzianów/zadań, typ zadania domowego i adresy `App`. Wybór pierwszego profilu w tym projekcie nie jest stosowany u nas. |

Starsze zgodne warianty struktury ocen sprawdzono również w [pdobosz-playground/vulcan-sdk](https://github.com/pdobosz-playground/vulcan-sdk/tree/fc343c3cbff8c7927c1b6d049222ae05f94689cf). To materiał historyczny, nie bieżąca odpowiedź eduVULCAN. Opis adaptera powyżej obejmuje zakres faktycznie zaimplementowany; publiczne źródła zawierają też funkcje, których ta aplikacja nie pobiera.

### Wcześniejsze sprawdzenie przy wersji 1.4.0

Przejrzano publiczne README i metadane poniższych repozytoriów przez GitHub. Te źródła są informacjami autorów nieoficjalnych projektów, nie dokumentacją producenta eduVULCAN.

| Źródło | Potwierdzony fakt | Znaczenie dla tej aplikacji |
| --- | --- | --- |
| [kapi2289/vulcan-api — README](https://github.com/kapi2289/vulcan-api/blob/master/README.md) | Opisuje nieoficjalny interfejs **UONET+** korzystający z mobilnego API i rejestracji jako urządzenie mobilne. | Samo istnienie tej biblioteki nie potwierdza obsługi konta eduVULCAN rodziny. |
| [kapi2289/vulcan-api — metadane](https://api.github.com/repos/kapi2289/vulcan-api) | Repozytorium nie jest oznaczone jako zarchiwizowane; metadane ostatniego push wskazują 14.01.2025. | Nie daje to dowodu bieżącej zgodności z eduVULCAN ani konkretnej szkoły. |
| [wulkanowy/wulkanowy — README](https://github.com/wulkanowy/wulkanowy/blob/develop/README.md) | Opisuje nieoficjalnego klienta **VULCAN UONET+** z ocenami, planem i wiadomościami. | Funkcji starszego klienta nie można obiecać jako funkcji nowej integracji eduVULCAN. |
| [wulkanowy/sdk — metadane](https://api.github.com/repos/wulkanowy/sdk), [wulkanowy/wulkanowy — metadane](https://api.github.com/repos/wulkanowy/wulkanowy) | Oba sprawdzone repozytoria mają `archived: true`; ostatnie push wskazują czerwiec 2024. | Nie przyjmujemy tych repozytoriów jako dowodu utrzymywanego wsparcia eduVULCAN. |

Powyższe starsze repozytoria nie stanowią podstawy obietnicy zgodności z eduVULCAN. Nowy adapter 1.5.0 opiera się na formularzu producenta i aktualnych publicznych implementacjach wskazanych wcześniej. Logowanie i zakres danych nadal wymagają potwierdzenia na koncie rodzica. Nie uzyskano oficjalnej gwarancji API dla tej prywatnej integracji ani potwierdzenia oficjalnego eksportu CSV/JSON. Dlatego szablony importu pozostają formatem aplikacji.

Adresy producenta do sprawdzenia przy dalszych pracach: [eduVULCAN](https://eduvulcan.pl/) oraz [VULCAN](https://www.vulcan.edu.pl/). W tej paczce nie ma fikcyjnych endpointów ani przycisku udającego udaną synchronizację.

## Sprawdzenie rzeczywistego połączenia

Po wdrożeniu backendu i sekretów sprawdź logowanie własnym kontem, poprawną listę placówek i jawny wybór SP4. Następnie porównaj kilka ocen, lekcji, sprawdzianów i treści wiadomości z oficjalnym dziennikiem. Sprawdź również zachowanie statusu odczytu wiadomości. Zwróć uwagę na właściwe dziecko, terminy i dostęp rodzic/dziecko. Nie przekazuj danych logowania w rozmowie.

Potwierdzenie tych kroków jest oddzielne od testów lokalnych. Jeśli portal zgłasza dodatkowe uwierzytelnienie lub adapter nie potrafi odczytać odpowiedzi, wymaga dalszej poprawki; nie należy nazywać samego endpointu „działającą synchronizacją” bez udanego wyniku na koncie. Sam statyczny hosting lub dopisanie hasła do `.env` frontendu nie uruchamiają integracji.

Ręczne wpisy, import i odnośnik do dziennika pozostają dostępne podczas konfiguracji i w razie wygaśnięcia połączenia. Nie dodano automatycznego harmonogramu pobierania ani wysyłania wiadomości do szkoły.
