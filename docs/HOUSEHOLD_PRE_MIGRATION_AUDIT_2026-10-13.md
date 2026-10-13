# Audyt przed migracją gospodarstwa — 13.10.2026

## Zakres i wynik

Audyt lokalnego kodu opiera się na `8167bc7` oraz wyniku produkcyjnego dry-run przekazanym przez właściciela: **11 kandydackich zmian, 7 blokad, 7 ostrzeżeń, 0 zapisów**. Prace przygotowano na osobnej gałęzi `feature/household-migration-audit-20261013`. Nie dysponujemy produkcyjnymi poświadczeniami, prywatnym manifestem tych 11 ścieżek ani odczytem konfiguracji chmurowej. Nie potwierdzamy liczby istniejących plików, lokalizacji usług ani zgodności wdrożonych reguł z repozytorium.

**Migracja pozostaje zablokowana.** Nie wykonano migracji, nie utworzono magazynu, nie zmieniono danych, sekretów ani ustawień produkcyjnych. Nie wdrożono reguł ani Functions i nie włączono zapisów. Aktualna poprawka dotyczy narzędzia odczytowego, jego testów i dokumentacji; nie zmienia API aplikacji, Zadań, Zdrowia, Kalendarza ani sesji/harmonogramów SP4.

## 1. Siedem blokad ma jeden wskazany powód

| Komunikat | Liczba | Interpretacja |
|---|---:|---|
| `STORAGE_BUCKET_NOT_FOUND` | 1 | Wskazany w konfiguracji bucket `nasza-rodzina.firebasestorage.app` nie został zweryfikowany; odczyt zwrócił 404. |
| `INVENTORY_INCOMPLETE` | 1 | Raport Firestore/Auth powstał, ale inwentaryzacja wszystkich wymaganych usług jest niekompletna. |
| `STORAGE_PREFIX_NOT_VERIFIED` | 5 | W audytowanej wersji nie zweryfikowano prefiksów `taskProof/`, `taskRewardImages/`, `healthDocuments/`, `health/`, `avatars/`. |

To zależne komunikaty o niepełnym skanie, a nie siedem niezależnych awarii. **404 nie oznacza „brak plików w projekcie”.** Może istnieć starszy bucket `nasza-rodzina.appspot.com`, dodatkowy bucket lub dane wskazane przez adresy zewnętrzne. Narzędzie nie przełącza się na inne źródło automatycznie. Przy 403 potrzebne jest sprawdzenie uprawnień odczytu, nie zmiana danych czy przyznanie prawa zapisu.

Kod aplikacji korzysta także z `quick-products/`; poprawka narzędzia już obejmuje sześć znanych prefiksów, `quickProducts` i `familySettings`, oraz klasyfikuje `photoURL`, `documentURL`, `imageURL` bez zachowania pełnych URL/tokenów. Starszy snapshot pomijający ten zakres pozostaje niekompletny. Przy dalszym 404 nowy raport może wskazać sześć brakujących prefiksów zamiast pięciu; dodatkowy komunikat nie oznacza dodatkowej awarii. Nieznane prefiksy, obcy bucket lub zewnętrzne odwołania wymagają odnotowanego sprawdzenia; nie można potwierdzić ich dostępności samym skanem jednego domyślnego bucketa.

Narzędzie blokuje odwołania do innego bucketa, niespójne ścieżki, URL-only dokumenty medyczne i brakujące pliki. Awatary są sprawdzane zgodnie z wymaganiami aplikacji: UUIDv4 w nazwie i maksymalnie 5 MiB. Zdjęcia zakupów oraz wspólny awatar są kontrolowane, ale ich globalne rekordy nie otrzymują automatycznie `familyId`. Dodatkowy aktywny profil poza potwierdzonymi UID blokuje przygotowanie (`ADDITIONAL_ACTIVE_MEMBER_REQUIRES_ISOLATION_REVIEW`); samo `disabled: true` nie jest dowodem odebrania uprawnień w starych Rules. Osierocone zdjęcia produktów/awatary są zgłaszane, nie usuwane.

## 2. Ostrzeżenia wymagają niezależnych działań

W `scripts/lib/household-migration-plan.mjs` siedem wskazanych ostrzeżeń jest dodawanych bezwarunkowo. Dokumentują granice narzędzia. Nie są siedmioma dodatkowymi blokadami, lecz niektóre dotyczą realnych ryzyk, które należy rozstrzygnąć przed zastosowaniem planu. Utworzenie pustego magazynu ani zaznaczenie pola w konfiguracji nie usuwa ich znaczenia.

| Ostrzeżenie | Działanie i kryterium weryfikacji |
|---|---|
| `OPERATOR_ATTESTATION_IS_NOT_INDEPENDENT_HOUSEHOLD_PROOF` | Właściciel prywatnie potwierdza pięć dokładnych UID, istniejące role, konta i wspólne gospodarstwo. Zgodne imiona oraz `householdConfirmed: true` nie stanowią niezależnego dowodu. Nie przypisywać zbiorczo wszystkich rekordów `__legacy__`. |
| `LEGACY_NON_FINANCIAL_RULES_ARE_NOT_FULL_MULTI_HOUSEHOLD_ISOLATION` | Potrzebna skoordynowana izolacja pozostałych modułów: API, reguły, zapytania klienta i powiadomienia. Sama migracja `familyId` nie naprawia opisanych niżej braków. |
| `NO_SECRET_SESSION_OR_PROVIDER_CONTENT_INSPECTED` | Celowe ograniczenie dry-run. Zachować sesję i klucze; sprawdzić istniejące połączenie operacyjnie po osobno zatwierdzonej migracji. Nie żądać odszyfrowanych sesji, tokenów ani treści dostawców w raporcie. |
| `STORAGE_DOWNLOAD_TOKEN_REVOCATION_NOT_PERFORMED` | Sprawdzić istnienie tokenów bez wypisywania ich wartości. Prywatne bearer linki odwołać dopiero według zatwierdzonej, ukierunkowanej procedury po backupie i potwierdzeniu autoryzowanego odczytu. Zmiana Rules nie unieważnia istniejącego linku z tokenem. |
| `METADATA_SNAPSHOT_NOT_ATOMIC` | Przed migracją potrzebne krótkie okno bez zmian, świeży dry-run i kontrola wersji dokumentów/obiektów. Zastosowanie całego manifestu z preconditionami musi być atomowe lub mieć niezależnie uzasadniony plan większej migracji. |
| `DEPLOYED_RULES_NOT_VERIFIED` | Odczytać aktywne Rules i porównać z lokalnymi plikami. Test emulatora nie potwierdza, że produkcja używa tych samych reguł. Nie wdrażać reguł w ramach tej kontroli. |
| `FULL_DOCUMENT_AND_BINARY_BACKUP_NOT_CAPTURED` | Potrzebna osobno zatwierdzona pełna kopia dokumentów i istniejących plików wraz z wersjami oraz sprawdzona procedura odtworzenia. Prywatna projekcja metadanych i `rollback.private.json` nie są backupem. |

## 3. Co rzeczywiście może być przechowywane w Storage

Poniższa tabela wynika z kodu, **nie z odczytu produkcyjnych obiektów**. Brak domyślnego bucketa nie dowodzi, że każda funkcja była używana ani że pliki zniknęły. Plików niewysłanych z urządzenia nie można odzyskać z samej metadanej Firestore.

| Funkcja / źródło | Miejsce i format | Dostęp oraz kod |
|---|---|---|
| Potwierdzenie zadania zdjęciem | `taskProof/<taskId>/<uid>/<uploadId>.(jpg|png|webp)`; do 8 MiB | Admin-issued ticket, dokładny rozmiar/MIME, kontrola treści; odczyt autoryzowany. Po zatwierdzeniu usuwanie i kolejka ponowień. `server/tasks-photos.mjs`, `server/tasks-service.mjs`, `storage.rules`. |
| Własne zdjęcie nagrody | `taskRewardImages/<rewardId>/<uid>/<uploadId>.(jpg|png|webp)`; do 8 MiB | Ticket oraz ograniczenie do osób uprawnionych; plik nie jest usuwany po kilku dniach tylko dlatego, że istnieje. `server/tasks-reward-images.mjs`, `storage.rules`. |
| Chronione dokumenty i załączniki wizyt | `healthDocuments/<documentId>/<uploaderUid>/<uuid>.(pdf|jpg|png|webp)`; do 10 MiB | Jawne UID ACL metadanych i pliku; draft nie jest gotowym dokumentem. Dokumenty dorosłych wymagają zgody/zweryfikowanego umocowania, nie samej roli rodzica. `server/health-service.mjs`, `server/health-visit-attachments.mjs`, `src/health/ProtectedHealthDocuments.tsx`. |
| Starsze załączniki Zdrowia | `health/<parents|shared>/<person>/<uid>/<filename>`; PDF/obrazy do 10 MiB | Legacy dostęp według roli/osoby; stare krótsze ścieżki są lokalnie odrzucone. `storage.rules`, `scripts/bootstrap-family.mjs`. Historyczny `documentURL` wymaga prywatnego audytu źródła; nowe zapisy nie mogą dodawać publicznego URL dokumentu. |
| Awatar członka | `avatars/members/<targetUid>/<uploaderUid>/<uuid>.<image>`; do 5 MiB | `src/account/ProfileSettings.tsx`, `src/account/useProfileAvatars.ts`, `server/account-profiles.mjs`; odczyt przez SDK `getBlob`, tymczasowy URL tylko w pamięci. |
| Zdjęcie „Cała rodzina” | `avatars/family/<uploaderUid>/<uuid>.<image>`; do 5 MiB | To prezentacja agregatora, nie konto logowania. Ten sam mechanizm odczytu awatarów; metadata w singletonie `familySettings/profile`. |
| Własne zdjęcie szybkiego produktu | `quick-products/<uid>/<timestamp>-<filename>`; obrazy do 5 MiB | `src/features/ShoppingPage.tsx:324–326` używa `uploadBytes` i `getDownloadURL`, a URL zapisuje w metadanych produktu. Ten link nie jest dowodem prywatnego dostępu opartego na Rules. Nie odwoływać zbiorczo zdjęć produktów bez analizy skutków. |
| Awatar Google / stary `photoURL` | URL dostawcy lub inny istniejący URL | `server/account-auth.mjs`, `src/account/useProfileAvatars.ts`. Może wyświetlać się bez Firebase Storage; nie dowodzi istnienia rodzinnego zdjęcia w domyślnym bucketcie. Nie nadpisywać własnych zdjęć. |
| Statyczne ilustracje / ikony | `public/`, zasoby bundla, emoji/SVG | Dostarczane ze strony/Vercel, nie z Firebase Storage. Nie nadają się na magazyn prywatnych dokumentów. |
| `blob:` / lokalny podgląd pliku | Pamięć przeglądarki | `URL.createObjectURL` to tymczasowy podgląd autoryzowanych lub wybranych lokalnie bajtów, nie zapisana kopia ani trwały adres. |

Google Calendar zapisuje wydarzenia i zaszyfrowane tokeny w Firestore, a eduVULCAN sesję i rekordy szkolne również w Firestore; te integracje nie potrzebują bucketa do samych danych synchronizacji. Zakupy tekstowe, punkty, kalendarze, role i wiadomości nie są plikami Storage. Nie przenosić dokumentów zdrowotnych do zewnętrznego publicznego URL, `public/`, localStorage ani Vercel jako obejścia 404. Inny magazyn prywatny wymaga osobnego adaptera, autoryzacji, unieważniania dostępu i kopii bezpieczeństwa; nie jest automatycznym zamiennikiem obecnego SDK.

## 4. Konfiguracja musi wskazywać ten sam rzeczywisty magazyn

| Warstwa | Konfiguracja |
|---|---|
| Klient React | `VITE_FIREBASE_STORAGE_BUCKET`; `src/firebase.ts` ma produkcyjny fallback `nasza-rodzina.firebasestorage.app`. Wartość jest używana podczas builda. |
| Serwer Vercel | `FIREBASE_STORAGE_BUCKET`; `server/tasks-photos.mjs` wymaga nazwy albo jawnego `storageBucket`, a `server/health-service.mjs` ma dodatkowy fallback z project ID. |
| Firebase Functions | Parametr `FIREBASE_STORAGE_BUCKET`; `functions/index.mjs:37` ma domyślne `''`. `familyJobContext()` wymaga zarówno tego parametru, jak i osobnego przełącznika zapisów. |
| Dry-run | Jawne `projectId` i `bucket` w prywatnej konfiguracji; nie wybiera bucketa z konfiguracji aplikacji ani z błędu 404. |

Jednakowe nazwy nie potwierdzają istnienia magazynu, regionu ani uprawnień. `.env.example` jest wzorcem, nie stanem Vercel/Functions. W repozytorium nie ma `.firebaserc`; operator wskazuje projekt jawnie, nie zakłada domyślnego aliasu CLI. Jeśli po audycie trzeba zmienić nazwę bucketa, trzy warstwy aplikacji i prywatna konfiguracja muszą zostać uzgodnione w osobno zatwierdzonym etapie; niczego nie przełączamy teraz.

`config/storage-cors.example.json` zawiera placeholder `https://twoja-domena.pl`. Jest to przykład, nie potwierdzenie działającego CORS. Autoryzowane pobieranie `getBlob` potrzebuje konfiguracji rzeczywistych, zatwierdzonych originów; CORS nie daje uprawnień do plików i nie zastępuje Rules. Nie kopiować placeholdera, nie dodawać `*` jako obejścia błędu dostępu.

## 5. Izolacja gospodarstw: realny, niezależny problem

Warunkiem ryzyka jest **obcy użytkownik posiadający aktywny profil `members/{uid}` w tym samym projekcie Firebase**. Samo konto Auth bez profilu nie daje dostępu, a klient nie może nadać sobie membership ani `familyId`. Nie twierdzimy, że taki obcy profil istnieje na produkcji.

Finanse są fail-closed: `server/family-identity.mjs`, `server/finance-model.mjs`, `server/finance-service.mjs` i `firestore.rules:168–184` odrzucają brakujące/nieprawidłowe ID oraz `__legacy__`. Sebastian i Dominika po zweryfikowanym przypisaniu tego samego ID zachowują wspólne rachunki; dziecko ma dostęp tylko do konkretnie udostępnionej opłaty w tym gospodarstwie. Brak dwóch ID nie jest dowodem wspólnej rodziny.

Pozostała architektura jest częściowo nadal jedno-gospodarstwowa:

- `firestore.rules`: globalny odczyt members (76), rodzinnego kalendarza (87), tasks (154), zakupów (206), kanału family (225); rodzicowski odczyt legacy Zdrowia (41/299), szkoły i wiadomości rodziców (318/331) nie sprawdza rodziny. Prywatny kalendarz i prywatne rozmowy zachowują ochronę UID, a dzieci nie mogą odczytać skrzynki rodziców.
- `storage.rules`: legacy `health/` (16), avatary (36/42) i quick products (48) nie mają pełnej granicy gospodarstwa. Ticket task/reward używa zgodności `familyId` (71/97), lecz w nieprzypisanym stanie `null == null` nie rozdziela rodzin. Chronione nowe dokumenty mają dodatkowy UID ACL.
- `server/tasks-service.mjs:30` dopuszcza legacy rekord bez `familyId`; `server/account-members.mjs:14–17` traktuje dwa nieprzypisane profile jako zgodne w administracji; `server/account-profiles.mjs:62–68` nie kontroluje rodziny przy edycji dziecka. Historyczny `scripts/bootstrap-family.mjs:103–112` nie nadaje `familyId`, a nowy członek dziedziczy je tylko od już przypisanego rodzica (`server/account-members.mjs:125`).
- `server/calendar-storage.mjs:16–30` przy wyborze profilu nie wymaga tej samej rodziny. Globalne `familySettings/profile` i część identyfikatorów opartych na samej osobie nie są pełnym modelem wielu gospodarstw.
- `server/edu-access.mjs:14–26` jawnie zakłada „jeden projekt = jedna rodzina” i globalne `_eduConnections/family`. Samo dopisanie ID nie zmieni zakresu tego połączenia. Naprawa pełnej izolacji wymaga osobnej, zgodnej wstecz decyzji; nie przebudowujemy działającego SP4 w tej poprawce.
- `server/notification-inbox.mjs:20–22` pobiera globalną listę członków; `server/notification-events.mjs:53–67` dla nie-finansowych źródeł wybiera odbiorców po rolach/osobie/UID, bez rodziny. Istniejące `medicineReminders` korzysta z tego samego mechanizmu. Przypomnienia nowych dokumentów (`server/health-reminders.mjs`) korzystają z jawnego UID ACL; dla załączników wizyty trzeba również uzgodnić z Rules kontrolę bieżącego gospodarstwa po zmianie membership. Finanse ponownie sprawdzają rodzinę, ACL i stan rachunku w transakcji.

Utrzymywanie projektu dla jednego zweryfikowanego gospodarstwa i nieaktywowanie obcych memberships ogranicza ryzyko przejściowo. **Nie jest naprawą izolacji ani zgodą na pominięcie tego etapu.** Globalny filtr w UI również nie zabezpieczy API/Rules/powiadomień.

## 6. Jeden plan wykonania, z oddzieleniem odczytu od przyszłych zmian

1. **Właściciel — odczyt w konsolach.** W jednym przeglądzie sprawdzić listę bucketów Google Cloud Storage (także starszy `.appspot.com` i ewentualne dodatkowe), lokalizacje, istniejące obiekty oraz nazwy skonfigurowane w trzech warstwach. Sprawdzić lokalizację Firestore, aktywne Firestore/Storage Rules oraz pięć dokładnych UID w Auth/members. Nie tworzyć bucketa „na próbę”; 404 nie zweryfikuje plików w innym źródle.
2. **Ustalić właściwe źródło plików.** Porównać metadane/referencje z faktycznymi obiektami, bez otwierania publicznych URL dokumentów. Odtworzyć listę źródeł i brakujących obiektów, nie zamieniać błędu w pusty wynik. Jeśli brak magazynu jest rzeczywisty i nie ma innych źródeł, przygotować decyzję o docelowym magazynie w UE. Jego utworzenie, IAM, CORS i konfiguracja wymagają osobnej zgody; ten audyt ich nie wykonuje.
3. **Powtórzyć wyłącznie dry-run.** Uzupełnić prywatną konfigurację o faktycznie zweryfikowany bucket. Przy zmianie bucketa względem poprzedniej propozycji użyć nowego prywatnego katalogu wyników, zgodnie z kontrolą mapy gospodarstwa. Zachować wynik i sprawdzić wszystkie blokady, referencje plików i dodatkowe zakresy. Ostrzeżeń nie „kasować” checkboxem.
4. **Backup i odtworzenie — dopiero po akceptacji.** Pełny eksport dokumentów, binaria/wersje/ACL/metadane oraz bezpieczna dostępność istniejących kluczy w zaszyfrowanym, ograniczonym dostępem magazynie UE. Snapshot dry-run nie zawiera pełnych danych. Nie kopiować sekretów do Git ani publicznego raportu. Sprawdzić odtworzenie poza produkcją; ustalić retencję i koszty kopii.
5. **Przygotować dokładny manifest, nadal bez zastosowania.** Nie znamy prywatnych 11 ścieżek, więc nie zakładamy, że to wyłącznie pięć members. Sprawdzić cały `plan.private.json`: dokumenty zależne, tickety, ACL, salda, księgę, kalendarze i finance sharing. Nie uruchamiać starego `bootstrap-family --apply` jako zastępstwa — ma szerszy zakres, w tym operacje Auth. Zachować UID, sesję, istniejące zgody i uprawnienia.
6. **Migracja tylko po osobnej zgodzie.** Okno bez zmian i aktywnych uploadów/sprzątania, świeży dry-run, wszystkie warunki `updateTime`/wersji oraz jedno atomowe zastosowanie kompletnego manifestu. Nie aktualizować samych pięciu profiles: niezgodność z ticketami/załącznikami odcina prawidłowy dostęp. Rollback przywraca wcześniejszą obecność/wartość pola warunkowo, z uwzględnieniem zmian po migracji; nie nadpisuje późniejszych danych. Narzędzie dry-run nie ma wykonawcy migracji/rollbacku.
7. **Pełna izolacja w skoordynowanej zmianie.** Fail-closed membership, bezpieczny model starych rekordów, query constraints klienta, API/Firestore/Storage Rules oraz routing wszystkich powiadomień. Singletony rodziny, globalne połączenie szkolne i klucze sald wymagają zgodności wstecz; nie renamować ich ani nie zmieniać SP4 automatycznie. Jeśli istnieje dodatkowe aktywne gospodarstwo/profil, ten krok wymaga rozstrzygnięcia **przed migracją**; nie archiwizować profilu, żeby obejść blokadę. Testy dwóch gospodarstw muszą poprzedzać osobno zatwierdzone wdrożenie. Nie włączać obecnie `FAMILY_V2_WRITES_ENABLED` ani innych przełączników zapisów/jobs.
8. **Prywatne linki — ukierunkowane unieważnienie po akceptacji.** Po backupie i testach autoryzowanego odczytu usunąć tokeny prywatnych dokumentów wskazanych w planie, zachowując obiekty i ACL. Sprawdzić brak dostępu starym linkiem. Nie odwoływać w ciemno wszystkich ilustracji i zdjęć produktów. Weryfikacja produkcji po migracji obejmuje dwóch rodziców, dziecko z udostępnioną opłatą i odcięcie obcego gospodarstwa.

Minimalne polecenie dla właściciela po sprawdzeniu UID/bucketa i przygotowaniu prywatnej konfiguracji z uprawnieniami **tylko do odczytu**:

```bash
npm run household:migration:dry-run -- --config /tmp/nasza-household-private/household.private.json --output /tmp/nasza-household-private/output --dry-run
```

Kod wyjścia `2` oznacza plan zablokowany, ale raport nadal może zawierać wartościowe odczyty Firestore/Auth. Szczegóły bezpiecznego przygotowania plików/ADC: [instrukcja dry-run](HOUSEHOLD_MIGRATION_DRY_RUN_2026-10-13.md). Nie ma teraz polecenia „apply”, „deploy” ani automatycznej zgody na zapisy. Kolejne kroki należy zatwierdzić na podstawie prywatnego raportu i wyników backupu.

## 7. Lokalizacja UE, koszty i weryfikacja

Cloud Storage for Firebase wymaga obecnie **Blaze**; sam plan nie tworzy magazynu. Aktualnego stanu rozliczania nie odczytywaliśmy. Nowy bucket `PROJECT_ID.firebasestorage.app` ma lokalizację niezależną od domyślnego Firestore. Kod Functions wskazuje `europe-west1`, lecz nie potwierdza lokalizacji istniejącej bazy/bucketów.

Jeśli rzeczywiście nie istnieje właściwy magazyn, rekomendacja po osobnym zatwierdzeniu to **regionalny Standard Storage `europe-west1` — Belgia, UE**, blisko istniejących Functions. Najpierw odczytać lokalizację Firestore i istniejących plików. Nie przenosić działającej bazy ani Functions tylko z powodu braku Storage. Magazyn o istniejącej lokalizacji nie zostanie przeniesiony przez zmianę nazwy w `.env`; to byłaby osobna, jawnie zatwierdzona kopia/migracja. Nie wybierać USA wyłącznie dla darmowego progu GCS: dotyczy on `us-west1`, `us-central1`, `us-east1`, nie Belgii.

Regionalny bucket nie gwarantuje przechowywania/przetwarzania **wszystkich** danych w UE. Trzeba osobno sprawdzić Firestore, lokalizacje backupów i logów, realne regiony Functions Vercel oraz warunki Auth i zewnętrznych źródeł Google. `vercel.json` nie ustala regionu wykonywania backendu. Jeśli wymagane jest przetwarzanie backendu w UE, wybór obsługiwanego regionu UE w Vercel należy uwzględnić w osobnej konfiguracji przed jej zatwierdzeniem; nie zmieniono jej teraz.

Orientacyjne stawki publicznego cennika GCS dla Standard w Belgii (USD, bez podatków; przed decyzją sprawdzić bieżący cennik):

| Składnik | Skala kosztu |
|---|---|
| Przechowywanie | Około 0,020 USD/GiB/miesiąc. |
| Operacje Class A, w tym listowanie/zapis | Około 0,005 USD/1000. |
| Operacje Class B, np. metadane | Około 0,0004 USD/1000. |
| Transfer internetowy, standardowy pierwszy próg | Około 0,12 USD/GiB; faktyczna stawka zależy od kierunku i progów. |
| Kopie, wersje, soft delete | Dodatkowe przechowywanie; domyślne soft delete zatrzymuje usunięte obiekty przez 7 dni. |

Przykład skali, **nie prognoza użycia rodziny**: 10 GiB przechowywania to około 0,20 USD/miesiąc, a 10 GiB pobrań internetowych około 1,20 USD. Do tego dochodzą operacje, odczyty/backupy Firestore, logi i istniejące Functions. Bez liczby/rozmiaru rzeczywistych plików nie podajemy całkowitej miesięcznej kwoty. Standard nie ma minimalnego okresu przechowywania i opłat za odzyskanie danych właściwych Nearline/Coldline; dla małej aktywnej rodziny jest prostszym wyborem.

Retencję należy świadomie uzgodnić: usunięcie zdjęcia zadania przez API może pozostawić odzyskiwalną kopię soft delete. Nie jest to to samo co natychmiastowe nieodwracalne usunięcie. Nie wyłączono ochrony dokumentów ani retencji automatycznie; jeśli wymagania plików tymczasowych różnią się od trwałych, potrzebna osobna decyzja o polityce, ewentualnie oddzielnym magazynie i adapterze, a nie hurtowy lifecycle usuwający dokumenty medyczne.

Koszt odczytu zależy od rzeczywistej liczby dokumentów i operacji listowania, nie liczby 11 zmian; mniejsza projekcja pól nie zmniejsza liczby odczytów Firestore. Później dochodzą przechowywanie binariów, transfer, operacje, kopie/wersje/retencja oraz uruchomienia jobs. Dla jednej małej rodziny można ograniczyć koszt standardowym magazynem regionalnym i świadomą retencją, lecz bez inwentaryzacji nie podajemy gwarantowanej kwoty. Alert budżetu nie jest twardym limitem wydatków. Nie uruchamiać inwentaryzacji w pętli.

Źródła oficjalne sprawdzone dla tego audytu:

- [Zmiany i wymóg Blaze](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).
- [Lokalizacje Storage](https://firebase.google.com/docs/storage/locations) i [Firestore](https://firebase.google.com/docs/firestore/locations).
- [Cennik GCS](https://cloud.google.com/storage/pricing).
- [Soft delete](https://cloud.google.com/storage/docs/soft-delete).
- [Budżety i alerty](https://cloud.google.com/billing/docs/how-to/budgets).

## 8. Sprawdzenia poprawki

Rzeczywiste wyniki, Node.js 22.23.3:

| Sprawdzenie | Wynik |
|---|---|
| Planer, reader, CLI, klasyfikacja Storage i źródeł plików | 108/108 PASS. |
| Model Finansów, API i przypomnienia | 30/30 PASS. |
| Firestore/Storage Rules: gospodarstwo i istniejące zabezpieczenia czterech pakietów | 21/21 PASS. |
| Rzeczywisty Firebase Admin SDK, odczyt i brak zmian danych | 1/1 PASS. |
| TypeScript + Vite (`npm run build`) | PASS; wcześniejsze ostrzeżenie o dużym bundle pozostaje. |

Testy `household-migration.rules` sprawdzają odcięcie plików po migracji samych members i zachowanie dostępu po pełnym batchu; `four-packages.security.rules` sprawdzają izolację Finansów i udostępnienie pojedynczej opłaty dziecku. **Nie dowodzą pełnej izolacji wszystkich legacy modułów.** Testy używają danych syntetycznych i lokalnych emulatorów, nigdy produkcyjnych danych. Pełnego E2E nie uruchamiano, ponieważ nie zmieniono UI.

Pierwszy wspólny przebieg emulatorów wykrył pozostałe syntetyczne pliki wcześniejszego zestawu przy świeżym fixture Firestore. Planner poprawnie blokował je jako osierocone. Test integracyjny teraz czyści wyłącznie lokalny emulator Storage przed własnym fixture’em; po ponownym przebiegu wszystkie 22 przypadki Rules/SDK przeszły. Nie pominięto kontroli osieroconych plików w narzędziu.

Poprawka obejmuje wyłącznie `scripts/lib/household-{migration-inventory,migration-plan,storage-status,file-sources}.mjs`, CLI `scripts/prepare-household-migration.mjs`, ich testy, izolację fixture’u `household-migration.integration.mjs` i dwie instrukcje w `docs/`. API, frontend, Functions, `firebase.json`, `.env.example`, Firestore/Storage Rules i indeksy pozostają bez zmian.

**Warunek końcowy:** pełne pokrycie Storage i brak blokad to warunki konieczne, ale nie wystarczające. Gotowość wymaga zweryfikowania gospodarstwa, backupu i odtworzenia, aktywnych reguł, zgodności całego manifestu oraz świadomego rozstrzygnięcia opisanych ograniczeń izolacji. Nawet poprawny dry-run pozostaje `canApply: false` i nie wykonuje zapisów.
