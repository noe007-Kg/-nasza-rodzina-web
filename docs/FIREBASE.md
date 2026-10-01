# Uruchomienie prywatnego Firebase

Ta aplikacja używa istniejących kolekcji `members`, `calendarEvents`, `tasks`, `shoppingItems`, `quickProducts`, `familyMessages`, `healthRecords`, `medicalContacts`, `schoolItems`. Kod nie zakłada otwartych reguł. Uprawnienia działają na serwerze Firebase, niezależnie od tego, co ktoś zmieni w swojej przeglądarce.

## Konfiguracja projektu

1. W [Firebase Console](https://console.firebase.google.com/) wybierz własny projekt. Konfiguracja dostarczonego projektu `nasza-rodzina` pozostaje domyślna; trzeba mieć uprawnienia do tego projektu lub użyć nowego.
2. Włącz Authentication → Email/Password, Firestore w trybie produkcyjnym oraz Storage. Nowy Storage może wymagać planu Blaze i podpięcia rozliczeń; aktualne warunki pokazuje konsola. Ustaw alert budżetu.
3. W ustawieniach aplikacji webowej skopiuj publiczny obiekt Firebase do zmiennych z `.env.example`; plik lokalny nazwij `.env.local`. To publiczne identyfikatory projektu, a nie sekret administracyjny. W hostingu ustaw te same zmienne przed zbudowaniem aplikacji.
4. Authentication → Settings → Authorized domains: dodaj domenę strony; dla lokalnego uruchomienia dodaj `localhost`. W Authentication → Templates skonfiguruj polski szablon resetowania hasła i poprawny adres strony.
5. Firebase Storage musi zezwalać na pobieranie z domeny aplikacji przez CORS, gdy dokumenty pobiera `getBlob`. Przykład `config/storage-cors.example.json`; zamień domenę i uruchom `gcloud storage buckets update gs://TWOJ_BUCKET --cors-file=config/storage-cors.example.json`. CORS nie nadaje uprawnień do danych; nadal decydują reguły.

Zmienne `VITE_*` trafiają do publicznego kodu strony. Nigdy nie umieszczaj w nich haseł, loginów VULCAN ani klucza konta usługi.

## Konta członków rodziny

`members/{uid}` musi odpowiadać identyfikatorowi konta Firebase Authentication. Profil zawiera `name`, `personKey`, `role: parent|child`, `active: true`, `canLogin: true`. Wyłączenie dowolnej z dwóch ostatnich flag odbiera dostęp do danych. Profil osoby bez logowania może mieć `canLogin: false` i dokument z identyfikatorem `profile-layla`.

Zalogowanie samym e-mailem i hasłem nie nadaje dostępu do rodziny. Osoba spoza `members` jest blokowana. Przeglądarka nie tworzy ani nie zmienia członkostwa, imienia identyfikującego osobę i roli. Role ustawia wyłącznie właściciel Firebase lub poniższy skrypt administracyjny. Daty urodzenia możesz dodać jako `birthDate: RRRR-MM-DD` w prywatnym pliku profili; nie zapisuj ich w kodzie strony.

1. Skopiuj `config/family-members.example.json` do prywatnego pliku poza publicznym repozytorium, np. `family-members.private.json`. Wpisz e-maile rodziny, opcjonalne daty urodzenia i role. Nie wpisuj haseł.
2. W Firebase → Project settings → Service accounts pobierz klucz administratora i zapisz poza katalogiem projektu oraz publikowanym `dist`. Ustaw `GOOGLE_APPLICATION_CREDENTIALS` na ścieżkę do tego pliku. Alternatywnie użyj własnych Application Default Credentials przez `gcloud auth application-default login`.
3. Sprawdź plan: `node scripts/bootstrap-family.mjs --project TWOJ_PROJECT_ID --members family-members.private.json`.
4. Zapisz konta/profile: ta sama komenda z `--apply`. Nowe konta dostają losowe hasło, którego skrypt nie wyświetla. Członkowie ustawiają własne hasło przez „Nie pamiętam hasła” w aplikacji; można także wysłać reset z Authentication w konsoli. Używaj kont z prawdziwymi skrzynkami e-mail. Dla istniejących kont hasło pozostaje bez zmian.

`firebase-admin` służy tylko temu narzędziu. Administrator omija reguły Firebase, dlatego klucz konta usługi nigdy nie może znaleźć się w aplikacji, repozytorium ani katalogu strony.

## Jeśli masz już konta — ustawienia w konsoli

Bez tworzenia nowych kont możesz przygotować profile w Firebase Console:

1. W Authentication → Users otwórz konto osoby i skopiuj jego UID.
2. W Firestore → Data → `members` otwórz dokument o dokładnie tym UID. Jeśli go nie ma, utwórz go z takim identyfikatorem.
3. Ustaw pola tekstowe: `name` i `personKey` na imię tej osoby; `role` na `parent` dla Sebastiana/Dominiki albo `child` dla dzieci.
4. Ustaw pola logiczne, nie tekstowe: `active: true`, `canLogin: true`. Dla profilu dziecka bez własnego konta użyj `canLogin: false`.
5. Powtórz dla pozostałych kont. Hasła istniejących użytkowników zostają te same.

Przykład profilu rodzica:

```json
{ "name": "Sebastian", "personKey": "Sebastian", "role": "parent", "active": true, "canLogin": true }
```

Ta metoda ustawia tylko profile. Migracja starego czatu i plików nadal wymaga kolejnego kroku; nie zastępuje też opublikowania reguł.

## Migracja danych z wersji 1.3.3

Przed migracją wykonaj eksport/kopię Firestore oraz Storage. Zaktualizuj profile do ról `parent` i `child` przez skrypt; stare nazwy ról „Tata”, „Mama”, „Syn” nie uprawniają do danych w nowych regułach. Skrypt nie usuwa istniejących kont ani dokumentów.

Plan migracji: `node scripts/bootstrap-family.mjs --project TWOJ_PROJECT_ID --migrate --migrate-files --bucket TWOJ_BUCKET`. Po sprawdzeniu dodaj `--apply`. Możesz połączyć tę komendę z `--members family-members.private.json`.

- Czat otrzymuje `participants: []` dla kanału rodzinnego i dwa UID dla prawidłowego kanału prywatnego. Wiadomości o nieprawidłowym kanale wymagają ręcznej korekty i nie są automatycznie udostępniane.
- Stare rekordy zdrowotne otrzymują jawne `privateToParents: false`, jeśli pole nie istnieje. Zweryfikuj prywatność starych dokumentów przed wdrożeniem; oznacz w konsoli te, które mają widzieć wyłącznie rodzice.
- `--migrate-files` kopiuje stare dokumenty do `health/{shared|parents}/{person}/migration/...`, zapisuje `documentPath` i czyści `documentURL`. Usuwa również tokeny pobierania ze wszystkich obiektów pod `health/`, w tym oryginałów. Dawne publiczne linki z tokenem przestają działać. Oryginalne obiekty pozostają, lecz nowe reguły zabraniają dostępu do ich starych ścieżek. Ta zmiana tokenów jest celowa; kopie wcześniej pobranych plików pozostają u odbiorców.
- Obsługiwane są standardowe adresy `firebasestorage.googleapis.com` właściwego bucketa. Inne adresy wymagają ręcznego przeniesienia; skrypt nie pobiera danych z obcych serwerów. Brak dostępu do starego pliku przerywa migrację, więc usuń przyczynę i uruchom skrypt ponownie.
- Migracja nie usuwa szczegółów zdrowotnych już skopiowanych do starego wspólnego kalendarza. Sprawdź stare wizyty w `calendarEvents` i usuń wrażliwe opisy/kody skierowań, które nie powinny być wspólne.

W nowej aplikacji dokumenty zdrowotne pobierane są przez autoryzowane SDK i tymczasowy adres Blob. Nie twórz dla nich nowych `getDownloadURL`: publiczny token daje dostęp bez ponownego sprawdzania roli i pozostaje ważny aż do jego unieważnienia.

## Reguły i indeksy

Najpierw przygotuj profile, migrację oraz zaktualizowaną aplikację. Następnie wdróż reguły i indeksy:

```bash
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes,storage --project TWOJ_PROJECT_ID
```

Pierwsze włączenie reguł Storage odwołujących się do Firestore może poprosić o nadanie usłudze Firebase odpowiednich uprawnień. Zatwierdź konfigurację we własnym projekcie w konsoli. Czekaj, aż tworzenie indeksów się zakończy. Nie zastępuj tych reguł `allow read, write: if true`.

Rodzice czytają szkołę i zdrowie wszystkich osób. Dziecko czyta własną szkołę oraz własne/rodzinne zdrowie oznaczone jako wspólne. Prywatny czat czytają wyłącznie uczestnicy, także gdy inny zalogowany członek jest rodzicem. Rodzice moderują wspólny czat. Dziecko zgłasza wykonanie przydzielonych zadań, a punkty i zatwierdzanie należą do rodziców. Dziecko nie może tworzyć ocen ani wiadomości przedstawianych jako pochodzące ze szkoły.

## Lokalne testy bez danych rodziny

Wymagane Node 22+ i Java 21+ oraz pakiety `firebase-tools`, `firebase-admin`, `@firebase/rules-unit-testing`.

```bash
npx firebase emulators:exec --only firestore,storage --project demo-nasza-rodzina "node --test tests/security.rules.test.mjs"
```

Do przeglądarki uruchom emulatory `auth,firestore,storage`; ustaw `VITE_USE_EMULATORS=true`, `VITE_FIREBASE_PROJECT_ID=demo-nasza-rodzina`, `VITE_FIREBASE_STORAGE_BUCKET=demo-nasza-rodzina.appspot.com`. Konta testowe przygotuj prywatnym plikiem i `bootstrap-family.mjs --project demo-nasza-rodzina --emulators --members ... --apply`. Interfejs emulatorów: `http://127.0.0.1:4000`. Porty Auth/Firestore/Storage: 9099/8080/9199. Przy produkcyjnym buildzie `VITE_USE_EMULATORS=false`.

## Kontrakt zapytań aplikacji

Firestore nie odfiltrowuje dokumentów na podstawie reguł. Zbyt szerokie zapytanie zostanie odrzucone w całości.

| Moduł | Zapytanie dziecka | Zapytanie rodzica |
| --- | --- | --- |
| Szkoła, także Start/Rodzina | `where('person', '==', personKey)` | pełna kolekcja |
| Zdrowie | `where('privateToParents', '==', false)` i `where('person', 'in', ['family', personKey])` | pełna kolekcja |
| Kontakty medyczne | `where('person', 'in', ['family', personKey])` | pełna kolekcja |
| Czat wspólny | `where('channel', '==', 'family')` | identycznie |
| Czat prywatny | `where('participants', 'array-contains', uid)`; opcjonalnie ograniczenie `channel` | identycznie |

Listener należy uruchamiać dopiero po sprawdzeniu uprawnionego profilu i wyłączyć przy wylogowaniu lub zmianie konta. Pola `participants`, `privateToParents` i `personKey` muszą być uzupełnione w starych danych. Nowe ścieżki Storage: `health/shared/{person}/{uploaderUid}/{file}`, `health/parents/{person}/{uploaderUid}/{file}`, `quick-products/{uploaderUid}/{file}`. Pliki zdrowotne: PDF/JPEG/PNG/WebP/GIF do 10 MiB; zdjęcia produktów do 5 MiB. Zakaz dostępu obejmuje także nieznane kolekcje i nieznane ścieżki plików.
