# Przygotowanie gospodarstwa — wyłącznie dry-run

Narzędzie `scripts/prepare-household-migration.mjs` przygotowuje prywatną inwentaryzację i plan przypisania **jednego gospodarstwa do pięciu konkretnych UID**. Nie wykonuje migracji, nie zapisuje nic do Firebase, nie włącza flag zapisów i nie wdraża kodu. Nawet wynik bez blokad ma `canApply: false` i wymaga osobnej akceptacji.

Instrukcja dotyczy kontraktów lokalnego kodu po poprawce izolacji Finansów `da1c828`. Nie potwierdza wdrożenia tych kontraktów w produkcji. Nie zmienia API aplikacji, Functions, reguł Firestore/Storage, sekretów, zmiennych Vercel ani harmonogramów SP4.

## 1. Czego nie zweryfikowano na produkcji

Nie otrzymaliśmy pięciu rzeczywistych UID ani uprawnień do odczytu produkcyjnego Firestore/Auth/Storage. Testy syntetyczne nie potwierdzają istniejących danych gospodarstwa. Produkcyjny dry-run musi wykonać uprawniony operator. Konkretny nowy `familyId` powstanie dopiero w jego prywatnym katalogu wyników.

Brak `familyId` ani zgodne imiona nie dowodzą przynależności do jednego gospodarstwa. Operator musi niezależnie potwierdzić tożsamości i wspólne gospodarstwo Sebastiana, Dominiki, Pawła, Nikodema i Layli. Nie wolno automatycznie adoptować wszystkich dokumentów z `__legacy__`.

## 2. Uprawnienia i przygotowanie prywatnych plików

Wymagane: Node.js 22 zgodny z `package.json`, zależności z `package-lock.json` oraz istniejące **uprawnienia tylko do odczytu**:

| Zakres | Przykładowa rola tylko do odczytu | Cel |
|---|---|---|
| Projekt `nasza-rodzina` | `roles/datastore.viewer` | Odczyt projekcji dokumentów Firestore i ich wersji. |
| Ten sam projekt | `roles/firebaseauth.viewer` | Sprawdzenie istnienia pięciu kont Auth i stanu `disabled`. |
| Wyłącznie właściwy bucket | `roles/storage.objectViewer` | Lista obiektów i ograniczone metadane, bez zmiany plików. |

Narzędzie nie potrzebuje roli Owner, prawa zapisu Firestore/Storage, prawa zarządzania kontami, dostępu do Secret Manager ani eksportowanego klucza service account. Uprawnienia powinny zostać nadane i zatwierdzone osobno przez administratora; sam skrypt ich nie nadaje.

Można użyć ADC istniejącego, uprawnionego konta operatora. W Cloud Shell, jeśli ADC nie jest jeszcze skonfigurowane, operator może świadomie wykonać `gcloud auth application-default login`. Nie dodawać pliku ADC, klucza JSON ani tokenów do katalogu projektu i nie przesyłać ich w rozmowie. Skrypt używa jawnych `projectId` i `bucket` z konfiguracji, a nie domyślnego projektu aplikacji.

Przykład przygotowania katalogu poza repozytorium:

```bash
umask 077
mkdir -p /tmp/nasza-household-private
chmod 700 /tmp/nasza-household-private
mkdir -p /tmp/nasza-household-private/output
chmod 700 /tmp/nasza-household-private/output
```

Konfigurację należy zapisać jako `/tmp/nasza-household-private/household.private.json` i nadać jej `chmod 600`. Alternatywą jest ignorowany w Git katalog `migration-private/`, również z prawami `700`. Wyniki nie mogą trafić do zwykłego katalogu projektu, ZIP-a ani GitHub. Prawdziwe UID nie są hasłami, ale inwentaryzacja zawiera prywatne powiązania rodziny i plików.

Na systemach POSIX skrypt odrzuca pliki czytelne dla innych użytkowników, symlinki plików konfiguracji oraz nieprywatny/symlinkowany katalog wynikowy. Na Windows kontrola bitów POSIX nie obowiązuje: trzeba zapewnić równoważne ograniczenie dostępu przez ACL systemu.

## 3. Konfiguracja pięciu konkretnych UID

Poniższy szablon **celowo nie nadaje się do uruchomienia**. Podstaw rzeczywisty bucket, pięć UID, dokładne nazwy oraz istniejące role i booleany `canLogin`. Nie zmieniaj ról ani możliwości logowania po to, żeby przejść weryfikację.

```json
{
  "schemaVersion": 1,
  "projectId": "nasza-rodzina",
  "bucket": "REPLACE_ACTUAL_BUCKET",
  "householdConfirmed": false,
  "members": [
    {
      "uid": "REPLACE_UID_SEBASTIAN",
      "expectedName": "Sebastian",
      "expectedRole": "parent",
      "expectedCanLogin": true
    },
    {
      "uid": "REPLACE_UID_DOMINIKA",
      "expectedName": "Dominika",
      "expectedRole": "parent",
      "expectedCanLogin": true
    },
    {
      "uid": "REPLACE_UID_PAWEL",
      "expectedName": "Paweł",
      "expectedRole": "REPLACE_CURRENT_ROLE",
      "expectedCanLogin": "REPLACE_WITH_CURRENT_BOOLEAN"
    },
    {
      "uid": "REPLACE_UID_NIKODEM",
      "expectedName": "Nikodem",
      "expectedRole": "REPLACE_CURRENT_ROLE",
      "expectedCanLogin": "REPLACE_WITH_CURRENT_BOOLEAN"
    },
    {
      "uid": "REPLACE_UID_LAYLA",
      "expectedName": "Layla",
      "expectedRole": "REPLACE_CURRENT_ROLE",
      "expectedCanLogin": "REPLACE_WITH_CURRENT_BOOLEAN"
    }
  ],
  "reviewedRecordPaths": []
}
```

Zasady konfiguracji:

- Dokładnie pięć unikalnych UID; placeholdery są odrzucane przed odczytem Firebase.
- `expectedName` musi zgadzać się znak w znak z istniejącym `members/{UID}.name`. Dopasowanie po imieniu nie zastępuje wskazania konkretnego UID.
- `expectedRole` to aktualna wartość `parent`, `adult` albo `child`; `expectedCanLogin` to JSON `true`/`false`, nie napis. W tym narzędziu wymaganych jest dokładnie dwoje rodziców z aktywnym logowaniem.
- Opcjonalne `expectedPersonKey` warto podać, gdy operator zweryfikował dokładne istniejące pole. Skrypt nie zmienia `personKey`.
- `householdConfirmed` zmień na `true` **dopiero po ręcznym, odnotowanym potwierdzeniu wszystkich pięciu UID i jednego gospodarstwa**. Inaczej skrypt zatrzyma się przed inwentaryzacją.
- Nie dodawaj na początku `familyId`: narzędzie zaproponuje `family-<losowy UUID>`. Jeśli operator świadomie dostarcza ID przez opcjonalne `familyId`, przechodzi ono te same walidacje i kontrolę kolizji.
- `reviewedRecordPaths` przy pierwszym odczycie pozostaw puste. Po analizie właścicieli można w osobnym dry-run wpisać indywidualnie sprawdzone ścieżki `financeBills/<ID>` i `financeBillAudit/<ID>`. Dotyczy to każdego starego rachunku, okresu i audytu wymagającego przypisania; nie ma wildcardów ani zgody na całą kolekcję.

Brak konta Auth jest dopuszczalny dla profilu z `expectedCanLogin: false`. Profil wymagający logowania musi mieć istniejące, niewyłączone konto Auth. Skrypt nie tworzy kont, nie zmienia UID i nie przypina nowych providerów logowania.

## 4. Uruchomienie produkcyjnego odczytu dry-run

Z katalogu projektu, po przygotowaniu ADC i prywatnej konfiguracji:

```bash
chmod 600 /tmp/nasza-household-private/household.private.json
npm run household:migration:dry-run -- \
  --config /tmp/nasza-household-private/household.private.json \
  --output /tmp/nasza-household-private/output \
  --dry-run
```

Przed odczytem produkcji nie mogą być ustawione `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` ani `FIREBASE_STORAGE_EMULATOR_HOST`. Jeśli `GCLOUD_PROJECT` jest ustawione, musi zgadzać się z konfiguracją. Nie rozwiązywać błędu przez zmianę produkcyjnych danych ani nadanie praw zapisu.

`--dry-run` jest opcjonalnym jawnym potwierdzeniem trybu: również bez tej flagi istnieje wyłącznie dry-run. Opcje `--apply`, `--rollback`, `--migrate` i inne nieobsługiwane argumenty są odrzucane. Narzędzie nie potrafi uruchomić migracji ani deploymentu.

Powtórzenie polecenia z tym samym katalogiem wyników i tą samą mapą profili korzysta z `proposal.private.json` i zachowuje propozycję `familyId`. Każdy przebieg ma nowy podkatalog `run-...`. Zmiana mapy UID, oczekiwanych tożsamości, projektu lub bucketa powoduje zatrzymanie zamiast podmiany gospodarstwa. Dla takiej zmiany należy utworzyć osobny prywatny katalog i ponownie potwierdzić konfigurację. Uzupełnienie `reviewedRecordPaths` nie zmienia mapy gospodarstwa.

## 5. Co narzędzie odczytuje i sprawdza

Odczyt jest stronicowany i ograniczony do jawnego zestawu pól. Sprawdza:

- Pięć profili, role/aktywność, przypisania `personKey`, stan kont Auth oraz obce profile powodujące kolizję osoby albo proponowanego gospodarstwa.
- Zależności Zadań: zadanie, wykonanie, saldo, księga punktów, nagroda, prośba, oczekujący wskaźnik oraz tickety plików i kolejki sprzątania.
- Zdrowie: kartoteka, metadokument pliku, właściciel, jawne ACL i zgody/upoważnienia, dwustronne połączenie wizyty z dokumentem oraz odwołanie do kalendarza.
- Kalendarze rodzinne/prywatne, właścicieli zewnętrznych połączeń i map eksportu; metadane szkolnych przypisań bez treści wiadomości lub ocen.
- Stare rachunki i audyty, właścicieli, dzieci z `sharedWith`, serie/okresy oraz ich indywidualną kwalifikację do gospodarstwa.
- Metadane wpisów istniejących skrzynek powiadomień pięciu UID, bez zmiany wpisów lub resetowania deduplikacji.
- Obiekty w `taskProof/`, `taskRewardImages/`, `healthDocuments/`, `health/`, `avatars/`: ścieżkę, generację, metagenerację, rozmiar, MIME i techniczne identyfikatory powiązania.

Nie odczytuje opisów medycznych, numerów dokumentów, kwot i danych przelewów, treści kalendarzy/wiadomości, sesji eduVULCAN, haseł, tokenów OAuth, tokenów FCM ani tokenów pobierania Storage. Do planu nie pobiera binarnej zawartości dokumentów. Auth jest używane wyłącznie do sprawdzenia UID, istnienia konta i `disabled`.

Domyślny `--max-documents 10000` oznacza limit **na każdą kolekcję**, a nie łącznie na cały projekt. Maksymalna dopuszczalna wartość to `50000`. Narzędzie odczytuje 26 kolekcji głównych, pięć skrzynek `notificationInbox/<UID>/items`, pięć kont Auth oraz pięć prefiksów Storage z wspólnym limitem liczby obiektów. Dodatkowy rekord służy wykryciu przekroczenia limitu; niepełna inwentaryzacja blokuje plan.

Przy jednej małej rodzinie koszt jednorazowego odczytu powinien być niewielki, ale zależy od faktycznej liczby dokumentów i obiektów w całym projekcie. Projekcja mniejszej liczby pól nie obniża liczby rozliczanych odczytów Firestore. Należy uwzględnić stronicowane zapytania, listowanie Storage i odczyty Auth; nie uruchamiać dry-run w pętli. Skrypt nie pobiera plików ani nie wykonuje operacji zapisu.

## 6. Interpretacja prywatnego wyniku

W katalogu `--output` znajduje się stabilna propozycja `proposal.private.json`, a w każdym `run-...`:

| Plik | Znaczenie |
|---|---|
| `report.md` | Podsumowanie źródła inwentaryzacji, liczby zmian, blokad i ograniczeń oraz sumy lokalnych reguł. |
| `plan.private.json` | Dokładne ścieżki zmian wyłącznie `familyId`, poprzednia obecność/wartość pola, nowa wartość i wersje `updateTime`. |
| `inventory.private.json` | Ograniczona projekcja powiązań i metadanych, nie pełna baza. |
| `rollback.private.json` | Instrukcyjny manifest odwrotnych zmian; nie program wykonujący rollback. |
| `checksums.private.json` | SHA-256 integralności czterech plików przebiegu. Nie zastępuje autoryzacji ani backupu. |

Status `blocked` wymaga rozstrzygnięcia każdej blokady; CLI kończy się kodem `2`. Wynik `prepared-requires-approval` oznacza przygotowany plan bez wykrytych blokad, **nie zgodę ani możliwość zastosowania**. Zawsze obowiązują `writesPerformed: 0`, `canApply: false`, `migrationExecutable: false`.

### Niedostępny Storage: raport pozostaje, migracja jest zablokowana

Jeśli odczyty Firestore i pięciu kont Auth powiodły się, błąd listowania Storage nie przerywa przygotowania ich prywatnego raportu. CLI zapisuje wszystkie powyższe pliki, pokazuje bezpieczny kod błędu Storage i kończy się kodem `2` (`blocked`). W szczególności:

| Odpowiedź Storage | Kod blokady | Znaczenie |
|---|---|---|
| HTTP 404 | `STORAGE_BUCKET_NOT_FOUND` | Nie udało się zweryfikować wskazanego magazynu. Nie jest to dowód braku plików. |
| HTTP 403 | `STORAGE_ACCESS_DENIED` | Brak uprawnień do kontroli Storage. Nie jest to dowód braku plików. |
| Inny błąd HTTP/transportu | `STORAGE_READ_FAILED` | Kontrola nie została ukończona. |
| Limit lub zapętlona paginacja | `STORAGE_SCAN_LIMIT_REACHED` / `STORAGE_PAGINATION_STALLED` | Skan jest częściowy; nie można uznać go za kompletny. |

Dla nieutworzonego magazynu `nasza-rodzina.firebasestorage.app` zwracającego 404 raport wyraźnie wskazuje **„Storage: NIE ZWERYFIKOWANO — BLOKADA MIGRACJI”**. Liczba `0` przy „Zaobserwowane obiekty Storage” oznacza wyłącznie zero obserwacji z nieudanego skanu, a nie pusty magazyn.

`inventory.private.json` zachowuje odczytane kolekcje i Auth, ale ma `coverage.complete: false`, `missingCollections` zawierające `storage` oraz `coverage.storageCheck.verified: false`. `plan.private.json` ma `summary.storageVerified: false`, odpowiednią blokadę i `canApply: false`. Kandydackie zmiany Firestore pozostają dostępne do przeglądu; nie stanowią gotowej migracji, nawet jeśli żaden dokument nie odwołuje się do pliku.

Po błędzie na dalszej stronie skrypt zachowuje wcześniej zaobserwowane metadane. `storagePrefixes` obejmuje tylko prefiksy, których wszystkie strony udało się odczytać. Odwołanie do niezaobserwowanego pliku w niesprawdzonym prefiksie otrzymuje `STORAGE_OBJECT_NOT_VERIFIED`, a nie potwierdzenie `STORAGE_OBJECT_MISSING`. Tylko pomyślny skan wszystkich wymaganych prefiksów może zweryfikować pusty wynik.

Analiza offline zachowuje ten stan blokady i odrzuca sprzeczną deklarację kompletności. Nowy stan Storage jest sanitizowany do czterech pól: `verified`, `status`, `code` i `httpStatus`; treść błędu, stos, odpowiedź HTTP, adresy i nagłówki uwierzytelniania nie trafiają do raportów ani logów. Kompletne snapshoty starego formatu pozostają obsługiwane, ale nie potwierdzają aktualnego stanu produkcji.

Narzędzie nie tworzy magazynu, nie nadaje uprawnień, nie przełącza się automatycznie na inny bucket i nie ponawia błędnego skanu w pętli. Rozstrzygnięcie właściwego magazynu oraz uzyskanie pełnej kontroli tylko do odczytu wymagają osobnego działania administratora; następnie należy ponownie wykonać dry-run. **Nie stosować migracji przy niekompletnej kontroli Storage.**

Wersje dokumentów są preconditionami przyszłego wykonawcy. Metadane z kilku odczytów nie tworzą atomowej migawki; tuż przed ewentualną migracją trzeba ponownie sprawdzić wszystkie wersje i zależności.

Typowe blokady:

- Zły/missing UID, niespójna nazwa/rola/logowanie, wyłączony profil lub nieweryfikowalne konto Auth.
- Kolizja `personKey` z obcym profilem, istniejący inny `familyId`, nieznany właściciel albo połączenie z obcą osobą.
- Brakujące lub sprzeczne referencje task/reward/record/ticket/document; niespójny identyfikator księgi lub salda.
- Czynny upload, oczekujące usuwanie, szkic dokumentu albo osierocony plik wymagający ręcznego rozstrzygnięcia.
- Brak gotowego pliku, różne metadane lub generacje, konflikt ACL lub zgody; skrypt nie dopisuje ani nie usuwa osób uprawnionych.
- Stary rachunek lub jego audyt bez indywidualnego potwierdzenia w `reviewedRecordPaths`.
- Przekroczony limit inwentaryzacji lub plan większy niż 450 zmian.

Ostrzeżenia pozostają także przy planie bez blokad: poświadczenie operatora nie jest niezależnym dowodem gospodarstwa, aktywne reguły chmurowe nie zostały porównane, pełny backup nie został wykonany, odczyt metadanych nie jest atomowy i starsze niefinansowe moduły nie zapewniają pełnej izolacji gospodarstw. Narzędzie nie sprawdza ani nie unieważnia tokenów pobierania plików.

## 7. Emulatory i analiza offline

Tryb emulatorowy wymaga osobnej konfiguracji z `projectId: "demo-nasza-rodzina"`, jawnym bucketem testowym, pięcioma syntetycznymi UID oraz wszystkich trzech hostów:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
npm run household:migration:dry-run -- \
  --config /tmp/nasza-household-private/demo-household.private.json \
  --output /tmp/nasza-household-private/demo-output \
  --emulators --dry-run
```

Emulatory trzeba uruchomić wcześniej dla projektu demo. Nie używać prawdziwych UID, dokumentów ani credentials do fixture’ów. Skrypt nie uruchamia emulatorów i w tym trybie nie pobiera ADC.

Analiza zapisanej, prywatnej inwentaryzacji bez połączenia z Firebase:

```bash
npm run household:migration:dry-run -- \
  --config /tmp/nasza-household-private/household.private.json \
  --output /tmp/nasza-household-private/offline-output \
  --snapshot /tmp/nasza-household-private/previous-run/inventory.private.json \
  --dry-run
```

Plik snapshot również wymaga praw `600`. Jest filtrowany przez tę samą allowlistę. `--snapshot` nie łączy się z Firebase i zawsze ma oznaczenie `offline`; nie dowodzi aktualnego stanu produkcji. Nie można łączyć go z `--emulators`. Nie przyjmować starego snapshotu jako preconditionu produkcyjnego zapisu.

## 8. Kopia bezpieczeństwa — osobny, przyszły etap po zatwierdzeniu

Prywatny raport metadanych **nie jest backupem**. Przed jakimkolwiek przyszłym zastosowaniem planu uprawniony administrator musi po osobnej akceptacji:

1. Ustalić okno spójności, zakres danych i zasady dostępu do zaszyfrowanej kopii. Zatrzymać operacje mogące zmieniać objęte planem profile, zadania, księgę, nagrody, tickety i dokumenty; osobno skoordynować cleanup plików i przypomnienia Finansów. Nie wyłączać ani nie zmieniać działającego SP4 bez potrzeby.
2. Wykonać prywatny zarządzany eksport wybranych kolekcji Firestore. Operacja eksportu wymaga odrębnych uprawnień i generuje koszty — nie jest wykonywana przez dry-run ani przez powyższe role tylko do odczytu.
3. Zachować pełne preimage wszystkich zatwierdzonych dokumentów wraz z ich ID i wersjami w osobnym chronionym backupie. Nie ograniczać kopii do pól projekcji i nie dopisywać jej do repozytorium.
4. Wykonać osobno wersjonowaną, prywatną kopię oryginalnych powiązanych plików GCS, z generacjami i metadanymi. Nie tworzyć publicznych linków; zachować oryginalne formaty i wszystkie binarne strony dokumentów.
5. Sprawdzić kompletność/integralność i odtworzenie kopii poza produkcją, retencję oraz uprawnienia administratora. Zachować istniejące ACL, zgody, historię, kwoty, salda i identyfikatory.

Powyższa procedura nie upoważnia narzędzia do wywołania eksportu, kopiowania plików ani zmiany konfiguracji bucketa. Pełny backup medyczny wymaga szczególnie ograniczonego dostępu.

## 9. Przyszłe wykonanie migracji — plan, nie dostępna funkcja

Po zatwierdzeniu pełnego raportu i backupu potrzebny będzie osobno sprawdzony wykonawca. Powinien ponownie odczytać profile i zależności oraz atomowo zastosować **wyłącznie manifest zmian `familyId`**, z preconditionami wersji każdego objętego dokumentu:

- Pięć profili oraz wszystkie zweryfikowane tickety zdjęć zadań/nagród i powiązane załączniki wizyt muszą otrzymać to samo ID w jednym spójnym kroku. `null == nowe ID` nie przechodzi istniejących reguł: samo przypisanie profili odcina pliki.
- Plan nie przelicza punktów, nie tworzy nowych wykonań, okresów ani kopii wydarzeń. Nie zmienia ról, UID, kwot, zgód, `readers`/`editors`, `sharedWith`, treści medycznych, prywatności i źródeł kalendarza.
- Samodzielne dokumenty zdrowotne bez `attachmentKind: "health-record"` zachowują dotychczasowe ACL; nie są pretekstem do poszerzenia praw rodziców do kartoteki osoby dorosłej.
- Stare rachunki i audyty kwalifikuje się indywidualnie; przypadek obcego UID lub niejasnej własności zatrzymuje migrację zamiast usunięcia współdzielenia albo hurtowego zastąpienia `__legacy__`.
- Nie zmieniać sesji eduVULCAN, Google, planów szkolnych, reguł, `notificationInbox`, baseline ani identyfikatorów deduplikacji. Sama zmiana `familyId` jest techniczną metadaną, a nie nową treścią zadania/wizyty.
- Weryfikować limit transakcji: narzędzie blokuje ponad 450 zmian; wykonawca musi dodatkowo policzyć pełny rozmiar żądania i wymóg maksymalnie 10 MiB. Duży plan wymaga osobnego zaprojektowania maintenance/rollback — nie wolno automatycznie rozbić go na nieskoordynowane paczki.
- Zabezpieczyć okno przed równoległymi zapisami SDK i endpointów, uploadami oraz jobami dotyczącymi zmienianych danych. Sama flaga `FAMILY_V2_WRITES_ENABLED` nie zamraża wszystkich zapisów klienta, uploadów i schedulerów. W tym etapie **nie zmieniamy żadnej flagi ani harmonogramu**.

Po przyszłym wykonaniu trzeba sprawdzić odczyt tych samych plików przez uprawnione osoby, wspólny dostęp obu rodziców do rachunków i dostęp dziecka tylko do wskazanej opłaty, zachowanie sald/księgi, prywatnego kalendarza oraz brak duplikatów. Nie wystarczy sprawdzić liczby nadanych pól.

## 10. Wycofanie zmian — wyłącznie procedura

`rollback.private.json` nie wykonuje zapisu. Po ewentualnej migracji rollback wymaga osobnej akceptacji, pełnego backupu, utrzymania okna spójności i **wersji dokumentów zapisanych po zastosowaniu planu**, których dry-run jeszcze nie zna.

Przyszły wykonawca powinien:

1. Sprawdzić, że bieżące `familyId` jest dokładnie ID migracji i `updateTime` odpowiada zarejestrowanej wersji post-apply. Przy jakiejkolwiek równoległej zmianie przerwać, bez nadpisywania nowej treści.
2. Atomowo odwrócić tylko pole `familyId` we wszystkich powiązanych dokumentach. Dla `before.present: false` usunąć pole przez `deleteField`; dla `before.present: true` przywrócić dokładną wartość, odróżniając `null`, pusty napis i wcześniejsze `__legacy__` od braku pola.
3. Nie odtwarzać całej bazy z metadanych dry-run, nie resetować kont, księgi, ACL, plików, kalendarzy, inbox ani baseline. Jeśli potrzeba pełnego odtworzenia po innej awarii, to osobna procedura z pełnej kopii.
4. Zachować nowe zabezpieczenia Finansów. Powrót starej wartości pola nie uzasadnia przywrócenia fallbacku `__legacy__` ani otwarcia odczytu; takie rachunki pozostają bezpiecznie odizolowane do ponownego zweryfikowania.

## 11. Testy lokalne

Poniżej rzeczywiste wyniki lokalnej weryfikacji. Testy planowania, odczytu i CLI nie wykonują migracji produkcyjnej. Testy Rules używają wyłącznie syntetycznego projektu demo i pokazują zarówno odcięcie po błędnym patchu samych profili, jak i zachowanie dostępu po kompletnym patchu fixture’ów.

| Sprawdzenie | Wynik |
|---|---|
| Walidacja UID, gospodarstwa i planu | 43/43 PASS, Node.js 22.23.3; 404/403 blokują także plan bez referencji do plików. |
| Odczyt ograniczony do projekcji i bez operacji zapisu | 15/15 PASS — typy pól, paginacja, limity, Auth UID, brak tokenów/treści, zachowanie Firestore/Auth przy 404/403 i błędzie dalszej strony. |
| CLI, tryb offline i prywatne wyniki | 8/8 PASS — brak apply, prawa plików, stabilny ID, odmowa błędnych manifestów, zapis raportu i kod wyjścia 2 przy 404/403. |
| Bezpieczna klasyfikacja i kompletność kontroli Storage | 14/14 PASS — kody 404/403, pozostałe błędy, sprzeczne statusy, częściowe prefiksy, stare snapshoty i brak wycieku danych błędów. |
| Firestore/Storage: zachowanie uprawnionego dostępu i odmowy | 21/21 PASS w bazowym etapie `e374b0e`; nie uruchamiano ponownie w poprawce Storage — reguły pozostają bez zmian. |
| Rzeczywisty Firebase Admin SDK na emulatorach Auth/Firestore/Storage | 1/1 PASS, uruchomiony ponownie po poprawce — pełny odczyt, metadane pliku, plan bez zastosowania; niezmienione dokumenty i ich wersje oraz generacja/metageneracja/bajty pliku. |
| TypeScript i Vite (`npm run build`) | PASS, uruchomiony ponownie po poprawce; wcześniejsze ostrzeżenie o wielkości bundle pozostaje. |

Po poprawce Storage: **80/80 testów narzędzia i 1/1 test integracyjny PASS**. W bazowym etapie wykonano również 21 scenariuszy reguł. Błędy 404/403 testowano na syntetycznych odpowiedziach i prywatnych fixture’ach offline; nie odpytywano produkcyjnego magazynu. Nie uruchamiano pełnego E2E aplikacji ani nie deklarowano produkcyjnej weryfikacji pięciu rzeczywistych UID. Kod aplikacji, reguły i backend nie zostały zmienione przez ten etap. Ostatnia poprawka izolacji Finansów nadal ma opisane osobno ograniczenia starszego zestawu E2E Kalendarza.

Minimalny zestaw testów narzędzia (Node.js 22):

```bash
node --test --experimental-test-isolation=none \
  tests/household-migration-plan.test.mjs \
  tests/household-migration-inventory.test.mjs \
  tests/household-migration-cli.test.mjs \
  tests/household-storage-status.test.mjs
```

Testy wykryły różnicę SDK: `getFiles` z parametrem `fields` zwraca surowe JSON-y obiektów zamiast instancji `File`. Reader obsługuje poprawnie oba formaty; rzeczywisty transport emulatora to potwierdził. Typy dozwolonych pól są sprawdzane przed zapisaniem inwentaryzacji — zagnieżdżony obiekt z tokenem pod błędnym `familyId` lub polem grantu przerywa dry-run, zamiast trafiać do raportu albo zostać zamieniony na `null`.

**Produkcja nie została zmieniona. Dry-run nie jest zgodą na migrację.**
