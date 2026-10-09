# Etap 3 — dynamiczne profile i „Cała rodzina”

Baza: lokalny commit etapu 2 `1f4f442`, gałąź `work/family-evolution-1f75aa2`. Działający commit `1f75aa2` i oryginalny katalog projektu pozostają dostępne. Nie wykonano push, deploymentu, migracji ani zmiany danych produkcyjnych.

## Zachowanie

`members/{UID}` pozostaje istniejącym rejestrem profili. Profil może istnieć bez konta Authentication: `canLogin=false`. Późniejsze włączenie logowania zachowuje identyfikator tego profilu; konflikt z istniejącym kontem o tym samym e-mailu jest odrzucany zamiast tworzenia duplikatu lub przenoszenia danych.

Role to `parent`, `adult` i `child`. „Profil bez konta” opisuje dostęp do logowania, nie nadaje nowej roli administratora. Dorosły ma dostęp zwykłego członka, bez zarządzania rodziną i bez rodzicielskiej skrzynki szkolnej. Archiwizacja wyłącza aktywność i logowanie, unieważnia refresh tokens, ale zachowuje konto, UID i historyczne dane. Reguły odmawiają dostępu profilowi archiwalnemu także przy niespójnych pozostałych flagach.

Rodzic zarządza profilami wyłącznie w Ustawieniach. Każdy zalogowany członek może edytować własne imię, emoji i zdjęcie. Rodzic może również edytować zdjęcie i prezentację aktywnego dziecka lub profilu bez konta. Nie może nadpisywać zdjęcia innego aktywnego rodzica/dorosłego. Dziecko nie edytuje rodzeństwa ani rodziców.

Zmiana imienia nie zmienia tożsamości danych. Przy starym profilu bez `personKey` backend utrwala dotychczasowy prawidłowy klucz przed zmianą nazwy. Jawnie nieprawidłowy klucz blokuje zmianę imienia. Kontrolowane pola nie pozwalają klientowi zmieniać UID, roli lub powiązania szkolnego przez edytor zdjęcia.

„Cała rodzina” jest specjalnym widokiem kalendarza, nie kontem. Rodzic otwiera go z górnego paska; aktualnie zalogowana osoba nadal pozostaje pierwsza. Przycisk wybiera istniejący rodzinny widok kalendarza, bez dodatkowych zapytań do prywatnych kolekcji. Metadane emoji/zdjęcia agregatora zapisuje backend w `familySettings/profile`; nie powstaje dokument członka ani konto Authentication.

Lista członków, filtr kalendarza oraz lista kontaktów czatu korzystają z dynamicznego rejestru. Liczba osób nie jest ograniczona do pięciu. Nazwy pięciu dawnych profili pozostają jedynie jako zgodne ze starymi danymi aliasy tożsamości. Nową rozmowę prywatną można rozpocząć tylko z aktywnym, niearchiwalnym profilem posiadającym login. Istniejąca historia pozostaje dostępna zgodnie z dotychczasowymi uprawnieniami.

## Zdjęcia i Google

Zdjęcia JPG/PNG/WebP/GIF do 5 MiB trafiają do chronionych ścieżek Storage:

- `avatars/members/{targetUid}/{uploaderUid}/{UUIDv4.ext}`,
- `avatars/family/{uploaderUid}/{UUIDv4.ext}`.

Firestore przechowuje ścieżkę `avatarPath` i `avatarSource`, bez publicznego download URL lub tokenu. Odczyt odbywa się przez uwierzytelnione `getMetadata` i ograniczone rozmiarem `getBlob`; lokalne object URL są usuwane przy zmianie pliku, konta lub odmontowaniu. Reguły sprawdzają członka, docelowy profil, uploadującego, typ i rozmiar. Usuwanie zdjęcia sprawdza uprawnienie do profilu, także gdy pierwotnie przesłał je rodzic. Dane Zdrowia mają dotychczasowe oddzielne ograniczenia.

„Usuń zdjęcie” zachowuje wybrane emoji. „Domyślna ikona” przywraca także domyślne emoji. Postęp transferu nie osiąga 100% przed zakończeniem uploadu; zapis metadanych jest osobnym krokiem. Nieudany zapis metadanych powoduje próbę usunięcia nowo przesłanego pliku; nieudane sprzątnięcie starego zdjęcia nie ukrywa udanego zapisu profilu.

Google avatar pochodzi wyłącznie ze zweryfikowanego tokenu Google i HTTPS `googleusercontent.com`. Aktualizacja odbywa się transakcyjnie. Własne zdjęcie (`custom`) oraz stare zdjęcie bez informacji o źródle nie są nadpisywane. Źródło `google` można odświeżać przy kolejnym logowaniu. Mechanizm logowania/linkowania i istniejący UID pozostają.

## Przygotowane zmiany bezpieczeństwa

Nowy endpoint Vercel: `POST /api/account/profile`, wymagający aktywnego członka i dotychczasowej ochrony same-origin. Uprawnienia są ponownie sprawdzane wewnątrz transakcji; nie wystarcza dawny stan z klienta.

Zmodyfikowano lokalne `firestore.rules` i `storage.rules`: obsługa zwykłego dorosłego, odmowa dla archiwum, metadane agregatora tylko do odczytu dla klienta, chronione awatary oraz aktywni uczestnicy nowych wiadomości prywatnych. Zmiany są przygotowane, nie opublikowane. Nie dodano globalnego publicznego odczytu/zapisu ani dostępu dziecka do wiadomości rodzica.

Brak nowych Environment Variables, sekretów, zależności lub migracji. Po dodaniu endpointu profilu Vercel ma 12 plików API; przed kolejnymi integracjami trzeba uwzględnić ewentualny limit planu Hobby, zachowując istniejące adresy i autoryzację przy grupowaniu handlerów. Nie zmieniono `firebase.json`, eksportów Functions, szyfrowania eduVULCAN, klucza/ID, provider/service/storage, session envelope, lease, deduplikacji slotów i harmonogramów. `server/edu-auth.mjs` otrzymał wyłącznie spójne sprawdzenie aktywnego członka; operacje wspólnego połączenia nadal wymagają rodzica.

Obecna aplikacja jest pojedynczą rodziną w jednym projekcie, z kolekcjami globalnymi. Dodanie wielu niezależnych rodzin wymaga osobnego modelu i planu migracji; ten etap nie deklaruje izolacji tenantów, których obecny model nie zawiera. Niezarejestrowane konto Authentication nie ma dostępu członka.

## Weryfikacja

Node.js 22.23.3, wyłącznie lokalne emulatory `demo-nasza-rodzina`.

| Kontrola | Wynik |
| --- | --- |
| Build / TypeScript | PASS; istniejące ostrzeżenie o rozmiarze głównego bundla |
| Unit | 105/105 PASS |
| Server | 275/275 PASS |
| Functions | 49/49 PASS |
| Rules | 39/39 PASS |
| Integracje emulatorowe eduVULCAN/powiadomień/harmonogramu | 18/18 PASS |
| E2E Chromium / WebKit | Wszystkie 214 unikalnych scenariuszy zweryfikowane; końcowa powtórka nowych profili 26/26 PASS |

Pierwsze pełne uruchomienie E2E: **200 PASS / 10 FAIL**. Wszystkie niepowodzenia dotyczyły etykiet nowych pól w obu przeglądarkach. Rozdzielono etykietę i pomoc (`useId`, `htmlFor`, `aria-describedby`). Dalsza powtórka ujawniła rzeczywisty błąd: Firebase 12 w `getBlob(ref, maxBytes)` wywołuje `Blob.slice()` bez typu, przez co poprawny plik miał pusty MIME. Odczyt sprawdza teraz chronione metadane, rzeczywisty rozmiar pobranego pliku i odtwarza typ wyłącznie z dozwolonego MIME metadanych. Usunięto również nieprawidłowy CRC w maleńkim testowym PNG.

Podgląd wykazał ściskanie imion przez akcje na telefonie. Aktywowano istniejący układ container query w panelu rodziny: akcje przechodzą poniżej danych osoby. Własne kontrolki profili korzystają z istniejącego design systemu; pozostałe ustawienia i menu nie zostały przebudowane. Test sprawdza pięć rozmiarów, brak przepełnienia oraz rzeczywistą szerokość danych osoby, nie tylko szerokość strony. Awatar w Szkole ma klucz odpowiadający zdjęciu i poprawnie wraca po błędzie starego obrazu.

Końcowe uruchomienie całego `tests/family-profiles.spec.ts`: **26/26 PASS**, 13 w Chromium i 13 w WebKit. Obejmuje wszystkie wcześniejsze przypadki i dwa nowe scenariusze na przeglądarkę. Razem z pozostałymi scenariuszami pełnego uruchomienia daje 214 unikalnych zweryfikowanych E2E; nie jest to deklaracja jednego pełnego przebiegu 214/214. Dodatkowy test Rules pokrywa brak `canLogin` u dorosłego/rodzica: brak pola nie oznacza profilu bez konta i nie daje prawa edycji jego zdjęcia.

Porównania z rzeczywistej aplikacji, przy tych samych testowych członkach i rozmiarach:

- [Telefon — przed](../preview/stage-3/family-settings-phone-portrait-before.png)
- [Telefon — po](../preview/stage-3/family-settings-phone-portrait-after.png)
- [Tablet poziomo — przed](../preview/stage-3/family-settings-tablet-landscape-before.png)
- [Tablet poziomo — po](../preview/stage-3/family-settings-tablet-landscape-after.png)

Zrzuty „przed” pochodzą z oddzielnej kopii dokładnego commita etapu 2, „po” z przetestowanego kodu etapu 3. Mają rozmiar całego viewportu; stała nawigacja nie jest sztucznie ukrywana. Nie przedstawiają danych produkcyjnych.

Produkcji nie odczytywano. Przyczyna zgłaszanego przez Sebastiana `permission-denied` w chmurze nadal wymaga porównania faktycznej reguły i profilu produkcyjnego. Etap 1 poprawił potwierdzone lokalne błędy zakresów/subskrypcji i dodał bezpieczne diagnostyki; lokalne testy nie są dowodem stanu wdrożonych reguł.

## Pliki aplikacji i testów

Backend i API: `server/account-auth.mjs`, `server/account-http.mjs`, `server/account-members.mjs`, nowy `server/account-profiles.mjs`, `server/edu-auth.mjs`, nowy `api/account/profile.mjs`, `server/notification-events.mjs`, `server/notification-refresh.mjs`.

Reguły: `firestore.rules`, `storage.rules`.

Frontend: `src/FamilyTopBar.tsx`, `src/SchoolModule.tsx` (wyłącznie odświeżenie obrazu awatara), `src/account/FamilyMembersSettings.tsx`, `src/account/account-client.ts`, `src/account/account.css`, nowe `src/account/ProfileSettings.tsx`, `src/account/profile-avatar.ts`, `src/account/useProfileAvatars.ts`, `src/app-shared.tsx`, `src/family-directory.tsx`, `src/family-members.ts`, `src/family-shell.css`, `src/features/CalendarPage.tsx`, `src/features/ChatPage.tsx`, `src/features/FamilyPage.tsx`, `src/features/SettingsPage.tsx`, `src/main.tsx`, `src/notifications/refresh.ts`.

Testy: `tests/account-auth.test.mjs`, `tests/account-members.test.mjs`, nowy `tests/account-profiles.test.mjs`, `tests/security.rules.test.mjs`, `tests/notification-events.test.mjs`, `tests/notification-refresh.test.mjs`, nowe `tests/profile-avatar.test.ts`, `tests/family-profiles.spec.ts`.

Kopie `functions/server/` generuje istniejący `functions:prepare`; zgodność z kanonicznym `server/` jest sprawdzana testami. Podglądy generowane rutynowo przez E2E nie są traktowane jako zmiana kodu.

## Rollback

Etap zamykamy oddzielnym lokalnym commitem po weryfikacji. Cofnięcie tego commita przywraca UI/API/reguły z etapu 2. Nie wykonano żadnych produkcyjnych zapisów ani migracji. W ewentualnej przyszłej aktualizacji dane nowych profili i awatarów należy zachować także przy rollbacku; nie usuwać kont lub historii. Powrót do `1f75aa2` pozostaje możliwy.
