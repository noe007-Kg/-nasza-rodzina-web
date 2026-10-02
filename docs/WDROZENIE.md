# Wdrożenie aplikacji Nasza Rodzina

Projekt **1.5.0** składa się ze strony zbudowanej przez Vite, usług Firebase oraz funkcji serwerowych Vercel do połączenia eduVULCAN. Firebase Authentication obsługuje konta, Firestore dane, a Storage pliki. Organizer można uruchomić na zwykłym hostingu statycznym; integracja eduVULCAN wymaga pełnego projektu z `api/` i `server/`, wdrożonego do Vercel z konfiguracją serwerową.

## 1. Firebase i konta rodziny

Użyj swojego istniejącego projektu `nasza-rodzina`, jeśli chcesz zachować dane. Nowy projekt będzie miał osobną, pustą bazę.

1. Otwórz [Firebase Console](https://console.firebase.google.com/) i wybierz projekt.
2. W **Authentication → Sign-in method** włącz **Email/Password**. Utwórz osobne konta w **Users**.
3. Przygotuj profile rodziny i ich role według [FIREBASE.md](FIREBASE.md). Identyfikator profilu musi odpowiadać UID użytkownika z Authentication. Ten plik opisuje także utworzenie pierwszego rodzica i **migrację danych z 1.3.3**. Przy istniejącej bazie zrób kopię i migrację przed włączeniem nowych reguł; stare role i pliki wymagają aktualizacji.
4. Upewnij się, że **Cloud Firestore** jest uruchomione. Nie włączaj publicznego dostępu do bazy.
5. Dla zdjęć i dokumentów uruchom **Storage**. Sprawdź wymagania planu rozliczeniowego. Bucket musi odpowiadać konfiguracji aplikacji. Skonfiguruj też CORS dla swojej domeny według [FIREBASE.md](FIREBASE.md), aby autoryzowane pobieranie dokumentów działało w przeglądarce.
6. Opublikuj reguły **Firestore** i **Storage** do właściwego projektu według [FIREBASE.md](FIREBASE.md). Publikowanie strony w Vercel nie publikuje reguł Firebase.
7. W **Authentication → Settings → Authorized domains** dodaj domenę produkcyjną i własną domenę, jeśli jej używasz. Domenę podglądu dodaj, jeśli chcesz logować się także w podglądzie.

Publiczna konfiguracja Firebase Web identyfikuje projekt. Ochronę danych zapewniają reguły i uprawnienia użytkowników. Kluczy kont usługowych, haseł i danych logowania do eduVULCAN nie umieszczaj w `public`, `dist` ani w repozytorium.

## 2. Konfiguracja projektu

W `.env.example` znajdziesz nazwy obsługiwanych ustawień. Aby zmienić projekt Firebase, skopiuj plik do `.env.local` i uzupełnij wartości aplikacji Web z **Project settings → Your apps**. W Vercel dodaj te same wartości w **Settings → Environment Variables**. Po zmianie wykonaj nowy build/deployment: Vite umieszcza konfigurację w plikach podczas budowania.

Nie ustawiaj `VITE_USE_EMULATORS=true` na publicznym hostingu. Ta opcja służy do pracy lokalnej. Nie wprowadzaj sekretów do zmiennych zaczynających się od `VITE_`, ponieważ mogą trafić do kodu pobieranego przez przeglądarkę.

Dla eduVULCAN ustaw oddzielnie zmienne **serwerowe** w Vercel: `FIREBASE_PROJECT_ID`, jeden wariant klucza `FIREBASE_SERVICE_ACCOUNT_JSON` albo `FIREBASE_SERVICE_ACCOUNT_BASE64`, `EDUVULCAN_ENCRYPTION_KEY_BASE64` oraz domenę `EDUVULCAN_SITE_ORIGIN`. `.env.example` zawiera wyłącznie puste pola na sekrety. Szczegółowe kroki pobrania klucza Firebase Admin, wygenerowania klucza szyfrowania i wyboru SP4: [VULCAN.md](VULCAN.md). Do repozytorium nie dodawaj uzupełnionego pliku z sekretami.

Publikuj tę wersję w głównym katalogu domeny, np. `https://rodzina.example.pl/` lub na osobnej subdomenie. Adres `https://example.pl/rodzina/` wymaga dodatkowych zmian ścieżek zasobów i PWA w kodzie.

## 3. GitHub i Vercel — Twój obecny wariant

Repozytorium: [noe007-Kg/-nasza-rodzina-web](https://github.com/noe007-Kg/-nasza-rodzina-web).

Deployments: [projekt nasza-rodzina-web w Vercel](https://vercel.com/noe007-kg/nasza-rodzina-web/deployments).

1. Zachowaj kopię repozytorium. Dane Firebase zabezpiecz osobno: pliki projektu nie zawierają bazy rodzinnej.
2. Do głównego folderu repozytorium wgraj zawartość paczki **PROJEKT 1.5.0**, łącznie z `api/` i `server/`. `package.json` musi znajdować się bezpośrednio w katalogu ustawionym w Vercel jako **Root Directory**. Paczka **STRONA** i samo `dist` nie zawierają uruchamialnego backendu integracji.
3. Zacommituj także `package-lock.json`. Pomiń `node_modules`, `dist`, `.env.local` i klucze administratora.
4. Ustaw w Vercel:

   | Pole | Wartość |
   | --- | --- |
   | Framework Preset | Vite |
   | Node.js Version | 22.x |
   | Install Command | `npm ci` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |

5. Uzupełnij publiczne zmienne Firebase, jeśli zmieniasz domyślną konfigurację projektu. Dla integracji eduVULCAN dodaj również **serwerowe** zmienne z [VULCAN.md](VULCAN.md) dla **Production**. Sekrety nie mogą mieć przedrostka `VITE_`. Nie umieszczaj loginu/hasła dziennika w Vercel — wpiszesz je we własnym formularzu połączenia.
6. Zapisz zmiany w gałęzi połączonej z Vercel. Poczekaj na **Ready**. Przy **Error** otwórz Build Logs i sprawdź pierwszy błąd.
7. Dodaj domenę do Authorized domains w Firebase Authentication i wdróż reguły Firebase z kroku 1.
8. Sprawdź działanie według końca instrukcji.

`vercel.json` ustawia polecenie budowania i `dist`. Vercel zapewnia HTTPS, publikuje stronę oraz funkcje z katalogu `api/`. Poprawny build nie potwierdza konfiguracji sekretów ani udanego logowania do eduVULCAN; po publikacji sprawdź te kroki osobno. Logowanie i pobieranie z rzeczywistego konta rodziny nie zostały zweryfikowane podczas przygotowania paczki.

## 4. Zwykły hosting — FTP/SFTP lub panel serwera

Ten wariant uruchamia organizer na hostingu statycznym, także z Apache lub nginx. Serwer nie wymaga Node.js. **Połączenie eduVULCAN nie działa przez samo wgranie `dist`**; funkcje Vercel wymagają wdrożenia pełnego projektu według rozdziału 3. Wpisy ręczne i import szkoły pozostają dostępne.

Na komputerze w folderze projektu:

```bash
npm ci
npm run build
```

1. Przygotuj domenę lub subdomenę z certyfikatem HTTPS.
2. Wgraj **całą zawartość `dist`** do głównego katalogu strony, zwykle `public_html` lub `www`. `index.html` ma być dostępny bezpośrednio pod adresem strony, bez dodatkowego folderu `dist`.
3. Przenieś również `assets`, ikony, `manifest.webmanifest` i `sw.js`. Nie wgrywaj `src`, `.env.local`, kluczy ani `node_modules`.
4. Serwer musi zwracać `.js` jako JavaScript, `.css` jako CSS, `.webmanifest` jako JSON/manifest i `.svg` jako obraz SVG. `sw.js` ma zwracać kod JavaScript, nie stronę błędu ani przekierowanie.
5. Dla `index.html` i `sw.js` użyj `Cache-Control: no-cache`. Dla `assets/` z hashem w nazwie możesz użyć `public, max-age=31536000, immutable`.
6. Wyczyść cache hostingu/CDN po podmianie. Przy ręcznym wgrywaniu prześlij najpierw nowe `assets`, potem HTML i service worker. Zachowaj poprzednie pliki `assets` przez okres przejściowy dla otwartych kart starszej wersji.
7. Dodaj domenę do Authorized domains i sprawdź dostęp do danych.

Aplikacja wybiera sekcje wewnętrznie, więc podstawowe działanie nie wymaga wielu adresów i reguł przekierowania. Przykładowy nginx znajduje się w [deploy/nginx.conf](../deploy/nginx.conf).

Zbudowane pliki możesz sprawdzić lokalnie:

```bash
npm run preview -- --host 127.0.0.1
```

Adres poda terminal. To podgląd, nie serwer do hostowania produkcji.

## 5. Firebase Hosting

To alternatywa dla hostowania statycznego organizera. Baza może zostać w tym samym projekcie. Obecna konfiguracja Firebase Hosting nie publikuje funkcji z `api/`; dla integracji eduVULCAN użyj Vercel. Samo `firebase deploy --only hosting` nie uruchamia backendu.

Zainstaluj Firebase CLI według [oficjalnej instrukcji](https://firebase.google.com/docs/cli), zaloguj się kontem z dostępem do właściwego projektu i uruchom w folderze projektu:

```bash
npm ci
npm run build
firebase deploy --only hosting --project TWOJ_PROJECT_ID
```

Zastąp `TWOJ_PROJECT_ID` identyfikatorem, np. `nasza-rodzina`. `firebase.json` używa `dist`. Nie uruchamiaj `firebase init` z nadpisaniem plików reguł bez porównania z paczką.

`--only hosting` publikuje stronę. Reguły Firestore i Storage publikuje się osobno według [FIREBASE.md](FIREBASE.md). Sprawdź domenę `web.app` i własną domenę w Authorized domains.

## 6. Opcjonalnie: serwer z Dockerem

Dockerfile udostępnia **wcześniej zbudowane `dist`** przez nginx. Nie uruchamia backendu ani emulatorów. Obraz nie potrzebuje haseł ani kluczy administratora.

Ten kontener udostępnia organizer, bez backendu eduVULCAN. Nie kopiuj sekretów integracji do obrazu statycznej strony. Wariant dla działających funkcji integracji opisano w rozdziale Vercel.

```bash
npm ci
npm run build
docker build -t nasza-rodzina-web .
docker run --rm --name nasza-rodzina-web -p 127.0.0.1:8080:8080 nasza-rodzina-web
```

Kontener nasłuchuje na 8080. Przed nim ustaw reverse proxy z HTTPS lub skorzystaj z HTTPS dostawcy hostingu. PWA wymaga bezpiecznego połączenia. Wariant Docker wymaga osobnej konfiguracji i aktualizacji serwera.

## 7. PWA, aktualizacje i internet

Manifest nie blokuje orientacji ekranu. Skrót można dodać w Chrome lub Safari na iPhone/iPad; automatyczny przycisk instalacji zależy od przeglądarki.

Service worker zapamiętuje statyczny `index.html`, wygenerowane JavaScript/CSS i ikony z jawnej listy. Nie przechwytuje Firebase, dokumentów medycznych, API ani logowania. Nie zapisuje danych domowników w swoim cache. Bez internetu można co najwyżej wczytać interfejs; baza, pliki i logowanie nadal wymagają połączenia.

Nowa wersja pokaże komunikat i przycisk **Odśwież**. Kliknięcie przeładuje stronę, więc najpierw zapisz formularze. Jeśli nadal widzisz starą wersję, zamknij inne karty aplikacji i otwórz ją ponownie. W razie potrzeby usuń dane witryny w ustawieniach przeglądarki: wyloguje to użytkownika i zresetuje preferencje lokalne, ale nie usuwa danych z Firebase.

## 8. Sprawdzenie po publikacji

- Otwórz stronę w Chrome i Safari, na telefonie i tablecie. Sprawdź pion, poziom i dłuższe formularze.
- Zaloguj rodzica i dziecko osobnymi kontami. Niezalogowana osoba nie powinna czytać danych; dziecko nie powinno pobierać dokumentów rodziców.
- Dodaj próbne zadanie lub zakup i sprawdź je na drugim urządzeniu. Usuń próbny wpis.
- Prześlij niesensytywny plik testowy. Sprawdź, czy konto bez uprawnień nie może go pobrać.
- Wyloguj się i sprawdź ponowne logowanie.
- Zweryfikuj reguły Firebase na serwerze. Ukryta karta w interfejsie nie dowodzi ochrony danych.
- Jeśli włączasz eduVULCAN, połącz własne konto rodzica, wybierz jawnie SP4 i odpowiednie dziecko. Sprawdź wynik odświeżenia z oficjalnym dziennikiem oraz brak dostępu dziecka do połączenia i wiadomości rodziców. Nie testowano tego wcześniej na Twoim koncie.

## Typowe problemy

| Objaw | Co sprawdzić |
| --- | --- |
| Pusta strona lub błąd JavaScript | Całe `dist`, główny katalog domeny, serwer zwracający JavaScript zamiast HTML. |
| Nie można się zalogować | Email/Password w Authentication, konto, hasło i Authorized domains. |
| Brak dostępu po zalogowaniu | Profil z UID i rolą oraz reguły wdrożone do właściwego projektu. |
| Nie można zapisać danych | Reguły Firestore, profil rodziny, wyłączone emulatory na produkcji i internet. |
| Nie można wysłać pliku | Storage, bucket, reguły, limit rozmiaru i typ pliku. |
| Vercel nie buduje | Root Directory, Node.js 22.x, `package-lock.json` i pierwszy błąd w Build Logs. |
| Stara wersja strony | Przycisk aktualizacji PWA, cache CDN, kompletne `dist` i cache-control dla `sw.js`. |
| Brak przypomnienia w tle | Uprawnienia przeglądarki i systemu; zamknięta/wstrzymana strona nie daje niezawodnych alarmów. |
| eduVULCAN nie jest skonfigurowany | Pełny projekt z `api/`, serwerowe zmienne Vercel, zgodny klucz Firebase i redeployment. Szczegóły: [VULCAN.md](VULCAN.md). |
| Logowanie lub odczyt eduVULCAN nie działa | Własne konto na oficjalnej stronie, uprawnienia do SP4 i mechanizm portalu; zgodność adaptera wymaga sprawdzenia na rzeczywistym koncie. |
