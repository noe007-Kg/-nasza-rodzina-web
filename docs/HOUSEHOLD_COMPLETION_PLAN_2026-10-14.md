# Bezpieczne zakończenie migracji gospodarstwa — 14.10.2026

## Stan i granice potwierdzenia

Właściciel przekazał wynik produkcyjnego dry-run: **11 planowanych zmian, 0 blokad, 9 ostrzeżeń**. To dowód przejścia kontroli metadanych w tamtym uruchomieniu, a nie dowód wykonania kopii, poprawności wdrożonych Rules lub pełnej izolacji gospodarstw. Nie mamy prywatnego raportu z kodami wszystkich dziewięciu ostrzeżeń. Nie zgadujemy dwóch dodatkowych kodów; ponowna kontrola zapisze rzeczywistą listę w prywatnym `plan.private.json`.

Przygotowanie opiera się na `811f35fe4f00fb43ac9c5407f93f1ca4ea778f82`, na osobnej gałęzi `feature/household-migration-evidence-20261014`. Nie wykonano odczytu produkcji, backupu produkcji ani migracji w tym środowisku: brak produkcyjnego ADC i prywatnej konfiguracji pięciu UID. Nie zmieniono aplikacji, API, reguł, indeksów, Functions, sesji SP4, kluczy ani danych. Testy używają wyłącznie sztucznych danych i projektów `demo-*`.

**GOTOWE DO MIGRACJI PRODUKCYJNEJ: NIE.** Najpierw potrzebne są dowody poniżej. Narzędzie nie udostępnia trybu `apply`, migracji, deploymentu, tworzenia bucketa ani usuwania plików.

## Jeden plan wykonania

1. **Zebrać kopię i sprawdzić odtworzenie.** Uruchomić jedno polecenie z istniejącą prywatną konfiguracją UID. Automatycznie powstają zaszyfrowana kopia, porównanie bieżących danych przed/po odczycie, dowody Rules i lokalny test odtworzenia/rollbacku. Błąd odczytu lub przekroczenie limitu blokuje kompletność; nie jest zamieniany w pustą usługę. Zachować drugą sprawdzoną kopię poza tymczasowym Cloud Shell oraz klucz oddzielnie.
2. **Domknąć materiały do pełnego odzyskania.** Poniższa kopia obejmuje dane aplikacji w jawnie podanym zakresie, ale nie wszystkie poświadczenia Auth i chmurowe sekrety. Osobno zabezpieczyć istniejące materiały odzyskania Auth i istniejące klucze dostawców. Niczego nie rotować. Dopóki nie ma tych dowodów oraz drugiej kopii, kontrola gotowości pozostaje zablokowana.
3. **Potwierdzić rzeczywiste gospodarstwo i manifest.** Prywatnie porównać pięć UID z istniejącymi kontami/profilami, role dwóch rodziców, konta dzieci/profil bez loginu, własność i powiązania wszystkich proponowanych rekordów. Sprawdzić wszystkie 11 ścieżek, nie tylko pięć profili. Nie przypisywać hurtowo wszystkich rekordów `__legacy__`. Imiona i `householdConfirmed: true` nie są niezależnym dowodem; szablon potwierdzenia ma domyślnie `ownerReviewed: false` i hash konkretnego planu.
4. **Naprawić izolację w sposób skoordynowany.** Testy dwóch sztucznych gospodarstw potwierdzają luki starszych Rules. Samo dodanie `familyId` nie wystarczy. Przygotować zgodne zapytania klienta, API, Rules, mapowanie plików i odbiorców Functions. Zweryfikować dwie rodziny oraz rodzic/dziecko. Ta szersza zmiana wymaga osobnej implementacji i przeglądu; obecna poprawka nie publikuje nowych Rules ani nie przebudowuje działających Zadań, Zdrowia i Kalendarza.
5. **Rozstrzygnąć tokeny i lokalizacje.** Zidentyfikować prywatne pliki z bearer tokenem bez ujawniania jego wartości. Po backupie i osobnym zatwierdzeniu przygotować ograniczone odwołanie tokenów wyłącznie wskazanych prywatnych obiektów, sprawdzając wcześniej autoryzowany odczyt. Nie ruszać hurtowo zdjęć produktów. Odczytać rzeczywiste lokalizacje Firestore/bucketa i wybrać miejsce drugiej kopii w UE.
6. **Przygotować przyszłe wykonanie i rollback.** Po rozwiązaniu powyższych punktów: krótkie uzgodnione okno bez zmian, świeży plan i kopia, preconditions dokładnych wersji dokumentów, przetestowany atomowy zapis wszystkich zmian. Następnie osobna zgoda właściciela na konkretne operacje i wymagane wdrożenia. Ten zestaw nie zawiera produkcyjnego wykonawcy.

## Co kopiuje i weryfikuje narzędzie

| Źródło | Zakres i dowód |
|---|---|
| Firestore | Pełne dokumenty wszystkich kolekcji i podkolekcji **bazy `(default)`**, także pod nieistniejącymi rodzicami. Zachowanie natywnych wartości, int64, timestampów, odwołań i zaszyfrowanych envelope dostawców. Hash zawartości, wersje dokumentów i drugi pełny skan wykrywający dodanie/usunięcie/zmianę. |
| Storage | **Wszystkie bieżące obiekty wskazanego bucketa**, również poza znanymi prefiksami. Pobranie konkretnej generation, CRC32C, SHA-256 bajtów, MIME, custom metadata i właściwości obiektu; drugi skan generation/metageneration. Nie są kopiowane stare generacje ani soft-deleted obiekty. |
| Zdjęcia i załączniki poza Storage | `members.photoURL`, `familySettings.photoURL`, `quickProducts.imageURL`, `healthRecords.documentURL` oraz zdjęcia Auth i profilów dostawców. Obsługa dostępnych HTTPS PNG/JPG/GIF/WebP/PDF oraz poprawnych `data:`. Trwała kopia bajtów, nie sam URL. `blob:`, niedostępny plik, nieznany bucket lub niezatwierdzone źródło blokuje kompletność. |
| Auth | Metadane pięciu wskazanych UID, w tym role/autoryzacja w `customClaims`, provider profile metadata i zdjęcia. Lokalnie sprawdzane: UID, e-mail, telefon, avatar, disabled, emailVerified, claims i profile dostawców. **Nie są kopiowane/odtwarzane hashe haseł, MFA, aktywne sesje ani poświadczenia OAuth.** Historyczne czasy kont i unieważnienia sesji są zachowane w archiwum, ale nie odtwarzane w tej próbie. |
| Rules | Rzeczywisty odczyt aktywnych releases `cloud.firestore` oraz `firebase.storage/<bucket>`, odpowiadających rulesets i ponowny odczyt release. Dokładne porównanie zawartości z lokalnymi Rules. 403, różnica lub zmiana release to wynik niezweryfikowany. Test emulatora nie zastępuje tego odczytu. |
| Lokalizacje | Odczyt locationId Firestore oraz location i polityk bucketa. UE odróżniana od Wielkiej Brytanii/Szwajcarii. Dowód dotyczy **wyłącznie** tych dwóch usług, nie Auth, Vercel, logów, zdjęć Google czy miejsca wykonania Cloud Shell. |

Kopia aplikacji zawiera pełne treści dokumentów, dane medyczne, surowe URL i metadane plików; są one wyłącznie wewnątrz archiwum AES-256-GCM. Klucz kopii jest niezależny od eduVULCAN. Opaque sesje są zachowywane bez odszyfrowywania i bez próby logowania dostawców.

**Warunki rzeczywiście pełnego odzyskania:** osobno zatrzymać bezpieczną kopię właściwych sekretów szyfrowania/OAuth i, jeśli potrzebne jest odtworzenie Authentication po jego utracie, uprawniony eksport Auth wraz z konfiguracją hashowania/MFA/dostawców. Ta operacja wymaga oddzielnego bezpiecznego procesu i odpowiednich uprawnień odczytu; nie należy przekazywać eksportu ani kluczy w rozmowie lub GitHub. Obecna migracja nie zmienia Auth, więc zachowuje jego istniejące UID i metody logowania; próba metadanych nie dowodzi odzyskania hasła. Dodatkowe bazy/buckety lub niedostępna historia zewnętrznych dostawców również wymagają osobnego zakresu backupu.

Wyniki `captureComplete` i `restore.verified` dotyczą powyższego zakresu. Gotowość do migracji dodatkowo wymaga dowodów odzyskania kont/kluczy i drugiej kopii. Narzędzie nie zaznacza tych pól samodzielnie.

## Pliki i zabezpieczenia

Odtwarzanie jest ograniczone do nowego `demo-household-restore-*` oraz **literalnego `127.0.0.1`** na trzech osobnych portach emulatorów. Zdalny host, projekt produkcyjny, niepusty cel lub błędny hash są odrzucane. Dane Firestore zapisuje się z `exists:false`; odwołania do własnego projektu przepinane są wyłącznie w lokalnej kopii. Test porównuje typed values i oryginalne bajty, także obiekty z gzip, oraz metadane po ponownym odczycie. Nie usuwa ani nie czyści celu.

Prywatny katalog wymaga `0700`, pliki `0600`; klucze/symlinki i katalog w repozytorium poza ignorowanym `migration-private/` są odrzucane. Wyniki zawierają tylko potrzebne kody/liczniki i prywatny manifest; CLI nie wypisuje URL, tokenów, treści dokumentów ani surowych odpowiedzi. Logowanie requestów Firestore emulatora jest wyłączone, a wyjście procesu odtworzenia nie jest przepisywane do raportu. Nie publikować całego prywatnego katalogu. Zmienne z kluczami produkcji i poświadczeniami ADC nie są przekazywane do procesu odtworzenia; proces lokalny nadal działa jako ten sam użytkownik systemowy i nie stanowi izolowanej maszyny.

Pobieranie zewnętrzne nie wysyła cookies, Authorization ani innych poświadczeń. Dozwolone są HTTPS zdjęcia `googleusercontent.com`, zatwierdzona domena aplikacji i dodatkowe dokładne domeny z prywatnego pliku. DNS jest sprawdzany i przypinany do publicznych adresów; każdy redirect sprawdzany ponownie. Blokowane są adresy lokalne/prywatne, userinfo, niedozwolone protokoły, zbyt duże pliki, niezgodne MIME/sygnatury, błędy i timeout. Limit jednego pliku zewnętrznego: 10 MiB. Transport nie obsługuje bezpiecznego CONNECT proxy; przy ustawionym HTTP(S)_PROXY zgłasza `EXTERNAL_PROXY_TRANSPORT_NOT_SUPPORTED`, zamiast omijać proxy. Nie obchodzi CAPTCHA/MFA ani ograniczeń źródła. Ochroniony URL niedostępny bez logowania wymaga legalnie pobranej prywatnej kopii lub osobnego adaptera, nie otwarcia dostępu.

Limity kontrolne: domyślnie 10 000 dokumentów/węzłów, 128 MiB natywnego JSON Firestore, 10 000 obiektów Storage, 64 MiB na obiekt i 128 MiB wszystkich jego bajtów, 256 MiB plaintext całego archiwum. Przekroczenie jest blokadą, nie cichym pomijaniem. Dla większego projektu potrzebne jest osobno przygotowane strumieniowanie; nie uruchamiać narzędzia w pętli. Odtworzenie i kolejność kontroli są automatyczne, bez Functions czy nowych usług chmurowych.

## Izolacja i pozostałe ostrzeżenia

Testy wykorzystują faktyczny tekst odczytanych Rules; przy braku odczytu produkcyjnych Rules nie można potwierdzić produkcji. Lokalny fallback służy jedynie próbie odtworzenia; gate Rules nadal pozostaje niezweryfikowany.

- Finanse odrzucają brak `familyId` i `__legacy__`; rodzice tego samego gospodarstwa mają wspólne rachunki, a dziecko tylko wskazaną opłatę. Test kontroluje dostęp własnej rodziny, dziecka oraz odmowę dla obcej rodziny.
- Lokalny Kalendarz rodzinny, Zadania i szkolna skrzynka rodzica dopuszczają starszy dostęp projektowy między aktywnymi rodzicami. Avatary i legacy `health/parents/...` w Storage również nie mają pełnej granicy gospodarstwa. Testy celowo raportują te luki, nie uznają ich za poprawne uprawnienia.
- Nowe dokumenty medyczne z indywidualnym UID ACL oraz prywatny kalendarz zachowują odmowę dla obcej osoby. Nie udostępniać dokumentów dorosłego na podstawie samej roli rodzica.
- Sam test Rules **nigdy** nie ustawia `fullMultiHouseholdVerified: true`: wymagane pozostają API, zapytania UI, Functions i odbiorcy powiadomień. Harmonogramy i wspólna sesja SP4 mają teraz kontekst legacy; wymagają sprawdzonego mapowania gospodarstwa przed rozszerzeniem na wiele rodzin, bez niepotrzebnej zmiany obecnego połączenia.
- Token pobierania omija Rules przy znajomości URL. Licznik jest oparty na rzeczywistych metadanych obiektu; kopia zachowuje token wyłącznie zaszyfrowany. Odwołanie nie jest wykonywane. Skan nie dowodzi braku wcześniejszych zewnętrznych kopii ani poprawności IAM/ACL publicznego bucketa; te konfiguracje też wymagają odczytu przed zatwierdzeniem prywatności.
- Dwa zgodne skany nie tworzą atomowej migawki kilku usług. Kontrola wersji dokładnego manifestu i krótkie uzgodnione okno obejmujące automatyczne synchronizacje są nadal wymagane. Nie wyłączono teraz żadnego joba.
- Dostępność zewnętrznego zdjęcia nie dowodzi zgody na jego dowolne rozpowszechnianie ani gwarantowanej retencji. Kopia jest prywatna; URL nie staje się publicznym plikiem aplikacji.

## Rollback po przyszłej, osobno zatwierdzonej migracji

1. Zachować plan, kopię, hash archiwum i receipt zawierający **rzeczywiste wersje po produkcyjnym zapisie**. Receipt z emulatora nie nadaje się do produkcji.
2. Przed rollbackiem porównać wersje wszystkich zmienionych dokumentów. Gdy ktoś dopisał dane, przerwać; nie nadpisywać nowszej historii.
3. Atomowo przywrócić **wyłącznie `familyId`** do dokładnego poprzedniego stanu: brak pola, `null`, pusty tekst lub poprzednia wartość. Nie zastępować całych dokumentów starą kopią.
4. Nie cofać transakcji punktów, historii zadań, leków czy nowych wydarzeń. Cofnięcie Rules/kodu musi uwzględniać bezpieczeństwo — stara luka nie jest bezpiecznym rollbackiem.
5. Po ponownym odczycie sprawdzić uprawnienia dwóch rodziców, udostępnioną opłatę dziecka, metadane i otwieranie plików, Zadania/Punkty, Zdrowie, Kalendarz i SP4. Brak aktywnej sesji dostawcy rozstrzygać istniejącym bezpiecznym mechanizmem, nie odszyfrowanym tokenem w logach.

Lokalna próba stosuje nowy identyfikator, cofa tylko to pole, porównuje treść i testuje równoczesną zmianę. Stara precondition musi spowodować odmowę całej operacji. Nie ma produkcyjnego trybu rollback ani kasowania plików.

## Uruchomienie przez właściciela — jedno polecenie

W checkout tej gałęzi, w środowisku z istniejącym ADC **do odczytu**, Node.js 22, Javą 21+ i zależnościami `npm ci`:

```bash
npm run household:preflight -- --config /PRYWATNY_KATALOG/config.private.json --output /PRYWATNY_KATALOG/wyniki
```

Użyj istniejącej poprawnej konfiguracji poprzedniego dry-run i już utworzonego prywatnego katalogu. Nie wpisuj UID/sekretów w publiczne polecenia ani w repo. Pierwszy run tworzy niezależny klucz kopii i nowy katalog wyników. Dodatkowe domeny można podać przez `--external-domains-file /PRYWATNY_KATALOG/domains.private.json` (lista dokładnych domen); `--app-origin` tylko gdy realny adres aplikacji różni się od domyślnego. Nie są wymagane nowe Environment Variables ani wdrożenia Firebase/Vercel.

Niezbędne odczyty: Firestore list/get oraz informacje o bazie, Auth getUser, Storage objects list/get oraz buckets.get, Firebase Rules releases/rulesets.get. Przykładowe istniejące role: Datastore Viewer, Firebase Authentication Viewer, Storage Object Viewer, Firebase Rules Viewer; odczyt metadanych bucketa może wymagać dodatkowego `storage.buckets.get`. To lista wymagań, nie potwierdzenie produkcyjnego IAM. Nie nadawać praw zapisu tylko po to, żeby odczytać dowody.

Narzędzie może zakończyć się kodem **2** z raportem blokad mimo udanej kopii/odtworzenia — to prawidłowe działanie. Pełna izolacja, weryfikacja materiałów odzyskania, druga kopia i potwierdzenie gospodarstwa nie są automatycznie zatwierdzane przez właściciela. Nie próbować obejść ich flagą.

**Po uruchomieniu:** zachowaj sprawdzoną drugą kopię `.nrb` poza środowiskiem tymczasowym, klucz oddzielnie w bezpiecznym magazynie, prywatnie potwierdź pięć UID i manifest. Do dalszej analizy przekaż wyłącznie kody/liczniki z raportu; nie archiwum, klucz, raw URL, UID ani pełne dokumenty. Migrację rozpatrzymy dopiero po usunięciu rzeczywistych blokad i osobnej zgodzie.

## Koszty i UE

Odczyty metadanych + dwa pełne skany Firestore, listowanie/metadane/pobieranie Storage i transfer kopii generują koszty zależne od liczby dokumentów i bajtów, nie tylko 11 zmian. Emulatory działają lokalnie i nie uruchamiają płatnych Functions. Dla małej rodziny jednorazowy run powinien mieć niewielką skalę, ale bez rzeczywistej inwentaryzacji nie podajemy gwarantowanego kosztu.

Przechowywanie kopii w regionalnym magazynie Standard w UE (np. istniejącej Belgii `europe-west1`) lub bezpiecznym lokalnym nośniku w UE wymaga decyzji właściciela. Nie tworzyć nowego magazynu, dopóki nie wiadomo, że jest potrzebny. Zachować przemyślaną retencję i drugą niezależną kopię; soft delete/wersjonowanie zwiększa przechowywanie. Lokalizacji istniejącego Firestore nie zmienia się automatycznie. Nie wybrać regionu USA wyłącznie dla darmowego progu. Aktualne stawki należy sprawdzić przed zmianą usługi; poprzedni audyt zawiera orientacyjną skalę kosztów i oficjalne odnośniki.

## Zmienione i nowe pliki

Zmiana istniejąca: `package.json` — polecenie `household:preflight`. Nowe CLI: `scripts/household-preflight.mjs`, `scripts/verify-household-backup.mjs`. Nowe biblioteki w `scripts/lib/`: `household-backup-archive`, `household-production-evidence`, `household-external-files`, `household-private-files`, `household-storage-backup`, `household-native-values`, `household-restore-verifier`, `household-rollback-rehearsal`, `household-isolation-probes`, `household-evidence-capture`, `household-readiness-policy` (wszystkie `.mjs`). Nowe testy: `household-backup-archive.test.mjs`, `household-production-evidence.test.mjs`, `household-external-files.test.mjs`, `household-evidence-controls.test.mjs`, `household-evidence-capture.test.mjs`, `household-backup.integration.mjs`. Ta dokumentacja jest nowa. Rules, backend produkcyjny, aplikacja, zależności i konfiguracja wdrożeń pozostały bez zmian.

## Wyniki wykonanej kontroli — Node.js 22.23.3

| Kontrola | Wynik |
|---|---|
| Build (`tsc -b` + Vite) | PASS; istniejące ostrzeżenie o chunkach powyżej 500 kB. |
| Testy narzędzi gospodarstwa i Finansów | **192/192 PASS**: 54 nowe, 108 dotychczasowych narzędzi i 30 Finansów. |
| Odtworzenie kopii / gzip / claims Auth / rollback / 15 sond Rules i Storage | **1/1 PASS** w nowych lokalnych emulatorach. Sondy poprawnie wykrywają wymienione luki legacy; PASS testu nie oznacza pełnej izolacji. |
| Dotychczasowe Rules migracji i integracja SDK dry-run | **6/6 PASS** (5 testów Rules i 1 integracja), wyłącznie emulator `demo-nasza-rodzina`. |
| Dodatkowy przegląd bezpieczeństwa kodu | Sprawdzone ograniczenia zapisów do emulatorów, prywatność artefaktów i brak automatycznego zatwierdzania dowodów. |
| Backup produkcyjny / odtworzenie danych produkcyjnych | **NIE WYKONANO — brak poświadczeń i prywatnej konfiguracji.** |
| Odczyt aktywnych Rules/IAM/lokalizacji produkcji | **NIE WYKONANO.** Przygotowany rzeczywisty odczyt, nie potwierdzenie stanu chmury. |

Pierwsze uruchomienie zbiorczego globu testów omyłkowo objęło plik Rules bez emulatorów (192 PASS, 1 odmowa uruchomienia). Po rozdzieleniu testów wszystkie wskazane zestawy przeszły. Nie deklarujemy pełnych E2E ani pełnego testowania wszystkich modułów aplikacji; nie były potrzebne dla dodatku odczytowych narzędzi. Te wyniki nie są dowodem odczytu produkcji.
