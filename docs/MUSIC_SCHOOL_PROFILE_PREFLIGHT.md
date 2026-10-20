# Kontrola przed uzupełnieniem profili — wyłącznie odczyt

## Ustalenie z produkcyjnego odczytu właściciela 20.10.2026

Cloud Shell zwrócił: Node.js 22.23.3, 5 aktywnych profili, 2 rodziców,
5 brakujących `familyId`, 0 jawnych gospodarstw i 0 jawnych `schoolEnabled: true`.
To nie oznacza, że dzieci nie mają szkoły: dotychczasowy frontend korzysta z
wartości zgodności w `src/family-members.ts`. Nowy moduł wymaga rzeczywistego
przypisania UID i gospodarstwa, nie nazwy ani `__legacy__`.

## Dlaczego nie zmieniamy wyłącznie pięciu profili

Przy obecnej bazie kodu `2c29afc` istnieją zależności:

- `server/finance-model.mjs`, `server/finance-service.mjs`, `firestore.rules`:
  brak gospodarstwa prowadzi do `__legacy__`; po dodaniu `familyId` stare
  rachunki tego gospodarstwa mogą przestać być widoczne. Nie należy ich
  przypisywać po samym imieniu, kwocie ani roli rodzica.
- `storage.rules`: `_taskPhotoUploads` i `_taskRewardImageUploads` porównują
  `familyId` zgłoszenia z profilem. Stare zdjęcia mogą stracić dostęp mimo
  zachowania zadań i punktów.
- `server/health-service.mjs`, `firestore.rules`, `storage.rules`: załączniki
  `attachmentKind: health-record` również wymagają zgodnego gospodarstwa.
  Zmiana samych profili może ukryć dokument i zablokować edycję powiązanej wizyty.
- Pozostałe starsze moduły nie stanowią pełnej izolacji wielu gospodarstw.
  Nie należy deklarować takiej izolacji tylko dlatego, że dodano `familyId`.

To analiza lokalnego kodu, **nie potwierdzenie aktualnie wdrożonych Rules**.
Zagrożone rekordy i rzeczywisty zakres zmiany ustala poniższe narzędzie.
Nie uruchamia ono narzędzi `bootstrap-family --apply`, żadnej migracji ani deployu.

## Jedno polecenie kontroli w przygotowanym Cloud Shell

Po pobraniu tej gałęzi i przy istniejących zależnościach oraz ADC:

```bash
node scripts/check-music-school-profile-impact.mjs --project nasza-rodzina
```

Wymagany Node.js 22. Odczyty są ograniczone do jawnej listy 20 kolekcji
i maksymalnie 1001 dokumentów/kolekcję/przebieg. Dwa przebiegi pozwalają wykryć
zmianę wersji lub metadanych; nie tworzą atomowej kopii ani pełnego backupu.
To płatne odczyty Firestore/Auth zgodnie z planem projektu, bez Storage download.

SDK Firestore pobiera wyłącznie wskazane pola techniczne przypisań/uprawnień.
Nie pobiera tytułów, opisów medycznych, URL-i dokumentów, haseł, sesji ani
tokenów. Firebase Auth sprawdza istnienie i wyłączenie kont dla konkretnych
identyfikatorów profili logujących się. Nie tworzy kont i nie zmienia ich UID.
Do wyniku trafiają tylko liczniki i kody blokad. Nie publikować prywatnych
raportów wcześniejszej migracji ani backupów. Nie trzeba przesyłać UID do rozmowy.

Pusta kolekcja lub prawidłowe liczniki nie potwierdzają uprawnień do Storage,
kompletności backupu ani odtworzenia. Błąd odczytu i przekroczenie limitu są
oznaczane jako niekompletna kontrola. Narzędzie zawsze zwraca `canApply: false`
i `profileUpdateReady: false`: nie ma w nim kodu zapisującego produkcję.

## Najkrótsza bezpieczna kolejność dalszych działań

1. Uruchomić kontrolę. Rozstrzygnąć wyłącznie wykazane zależności i niejednoznaczne
   UID. Właściciel potwierdza prywatnie pięć rzeczywistych profili jednego
   gospodarstwa i wskazuje szkolne UID; nazwy i liczba pięć nie są dowodem.
2. Powiązać przegląd z prywatnym raportem wcześniejszego preflight — nie zakładać,
   że zakres 236 zmian nadal jest aktualny. Jeśli rachunki lub pliki zależą od
   brakujących pól, przygotować spójny, osobno zatwierdzany zakres; bez retagowania
   nieznanych rekordów i bez automatycznego powiększenia migracji.
3. Potwierdzić wdrożone Rules i zabezpieczyć pełną prywatną kopię danych i plików,
   wraz z ich metadanymi/ACL. Snapshot wybranych pól z tego narzędzia nie wystarcza.
   Wykonać i sprawdzić odtworzenie wyłącznie w izolowanym projekcie demo/emulatorach.
   Starsze narzędzia backup/restore istnieją na odrębnych gałęziach audytu — nie są
   uruchamiane ani scalane automatycznie do tej poprawki muzycznej.
4. Dopiero na podstawie dowodów przygotować prywatny, powiązany z aktualnymi
   wersjami dokumentów plan zmiany i rollback. Przed zapisem wymagana dodatkowa
   akceptacja właściciela. Ta gałąź nie zawiera narzędzia wykonującego taki zapis.
5. Po zaakceptowanej konfiguracji profili wrócić do aktywacji modułu muzycznego.
   Nie włączać globalnych zapisów Finansów/Zadań ani nowych Rules w ramach tej pracy.

## Wymagany rollback przyszłej zmiany (jeszcze niewykonywalny)

Prywatna kopia musi zachować informację, czy pole było nieobecne czy miało `null`,
poprzednie wartości i wersje wszystkich zmienianych dokumentów oraz metadane plików.
Plan i potwierdzenie wykonania muszą wiązać dokładne UID i wersje; jeśli dokument
zmienił się później, rollback ma odmówić nadpisania zamiast przywracać stary stan
w ciemno. Najpierw wyłączyć wyłącznie flagę nowego modułu. Zachować UID, punkty,
historię, kalendarze, tokeny/sesje eduVULCAN i klucze szyfrowania bez zmian.
Nie używać resetu Firestore, ręcznego kasowania dokumentów ani globalnego fallbacku.

## Testy tej poprawki

Node.js 22.23.3: 15/15 testów, kontrola składni obu plików `.mjs` PASS.
Sprawdzono brak zapisu, redakcję wyniku, błędy odczytu i niepełne zbiory,
zmianę metadanych między odczytami, powiązania UID z Auth, ryzyko utraty dostępu
oraz rzeczywistą odmowę starego rachunku w obecnej logice Finansów po zmianie profili.
Nie uruchamiano kontroli produkcyjnej z konta Codexa, migracji ani deploymentu.
Nie zmieniano kodu aplikacji, Functions, reguł, indeksów ani integracji szkolnych.
