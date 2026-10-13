# Finanse — izolacja gospodarstw domowych

Data: 13.10.2026. Dokument opisuje przygotowany kod i plan wymagający osobnego zatwierdzenia. Nie jest poleceniem migracji ani wdrożenia.

## Problem i granica zmiany

Wcześniejszy fallback `familyId = '__legacy__'` grupował wszystkie nieprzypisane profile w jednej przestrzeni finansowej. Brak identyfikatora nie dowodzi wspólnego gospodarstwa. Wyłączenie zapisów nie naprawiało tego odczytu: `FAMILY_V2_WRITES_ENABLED=false` blokuje mutacje, ale nie operację `state` istniejącego API Finansów.

Poprawka usuwa taki fallback z Finansów. Nie przenosi danych, nie nadaje istniejącym użytkownikom identyfikatorów gospodarstw, nie tworzy kont i nie zmienia danych produkcyjnych. Nie przebudowuje Zadań, Zdrowia, Kalendarza ani integracji szkolnych.

## Gdzie aplikacja nadaje lub odczytuje `familyId`

| Miejsce | Zachowanie |
|---|---|
| `scripts/bootstrap-family.mjs` | Tworzy profile bez nadawania `familyId`. Zapis `merge:true` zachowuje istniejące pole, ale obecny skrypt nie kopiuje go z pliku definicji. Nie należy używać go jako narzędzia przypisania gospodarstw. |
| `server/account-auth.mjs` | Logowanie Google korzysta z istniejącego UID i profilu. Nie nadaje gospodarstwa. Odświeżenie awatara nie zmienia `familyId`. |
| Logowanie e-mail/hasło | Uwierzytelnia istniejące konto Firebase. Nie tworzy przypisania gospodarstwa. |
| `server/account-members.mjs` — tworzenie profilu | Nowy profil dziedziczy poprawny `familyId` wyłącznie ze świeżego profilu rodzica odczytanego w transakcji. Identyfikator z żądania klienta jest odrzucany. Rodzic bez przypisania nadal może tworzyć starszy profil bez identyfikatora; taki profil nie uzyskuje dostępu do Finansów. |
| `server/account-members.mjs` — zmiana roli/aktywności/archiwizacja | Nie pozwala zmieniać `familyId`. Kontroluje gospodarstwo przed operacjami Firebase Auth oraz ponownie w transakcji. Nie pozwala rodzicowi zmieniać roli dziecka obcej rodziny i przez to poszerzać jego dostępu do rachunków. |
| `server/account-profiles.mjs` | Edycja prezentacji profilu nie przyjmuje `familyId`. |
| `src/main.tsx`, `src/family-members.ts` | Odczyt i reprezentacja profili. UI nie jest źródłem uprawnień ani mechanizmem przypisania gospodarstwa. |
| `firestore.rules`, `members/{uid}` | Klient nie może tworzyć ani zmieniać profili członków. W szczególności nie może sam nadać sobie cudzego `familyId`. |

Ochrona istniejących `personKey` i globalne sprawdzanie duplikatów imion pozostają bez zmian. Aplikacja nadal zawiera wcześniejsze rozwiązania dla jednego katalogu rodziny; ta poprawka gwarantuje izolację rachunków, a nie pełną przebudowę wszystkich starszych modułów na wiele gospodarstw.

## Jedna definicja poprawnego gospodarstwa

`server/family-identity.mjs` przyjmuje wyłącznie jawny identyfikator pasujący dokładnie do:

```text
^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$
```

Brak pola, `null`, pusty tekst, same białe znaki, `__legacy__`, nieprawidłowy typ, niedozwolone znaki i zbyt długa wartość nie stanowią poprawnego przypisania. Identyfikatory nie są automatycznie przycinane ani normalizowane do innego gospodarstwa. Reguły Firestore stosują zgodną walidację i porównanie dokładnej wartości.

## Odmowa dostępu przy braku poprawnego przypisania

- **API:** `server/finance-service.mjs` odczytuje aktualny profil w transakcji przed zapytaniem o rachunki. Brak poprawnego ID powoduje bezpieczną odmowę `FINANCE_FAMILY_NOT_CONFIGURED`, również dla `state`. Klient nie może przekazać rodziny, właściciela ani statusu rachunku jako własnego źródła autoryzacji.
- **Model:** `server/finance-model.mjs` nigdy nie uznaje dwóch brakujących ID za tę samą rodzinę. `canReadFinanceBill` wymaga aktywnego profilu oraz identycznego poprawnego ID rachunku i użytkownika.
- **Firestore:** `financeBills` jest dostępne wyłącznie dla właściwego gospodarstwa; zapisy klienta pozostają zabronione. `financeBillAudit` pozostaje niedostępne klientowi. Rachunki z `__legacy__` albo bez poprawnego ID nie są odczytywane przez rodziców lub dzieci z żadnego gospodarstwa.
- **Przypomnienia i cykle:** rekordy bez poprawnego ID nie są podstawą tworzenia kolejnych okresów ani przypomnień. Dostarczenie powiadomienia ponownie sprawdza aktualny rachunek, profil, rodzinę, status płatności, termin oraz udostępnienie. Zachowana jest deduplikacja. Zmiana przypisania albo cofnięcie udostępnienia nie może odtworzyć dostępu z wcześniejszego snapshotu.
- **UI i Kalendarz:** dane i projekcje Finansów są związane z aktualnym UID i stanem profilu; brak poprawnego przypisania nie tworzy zdarzeń finansowych. Kalendarz nadal działa z pozostałych dotychczasowych źródeł. Zmiana profilu/gospodarstwa nie zachowuje listy rachunków z poprzedniego kontekstu. UI jest dodatkowym zabezpieczeniem; właściwa odmowa jest po stronie API i Rules.

Przypomnienia zawierają ogólną treść, bez kwoty, odbiorcy ani numeru konta. Nie wykonujemy migracji istniejącego `notificationInbox` ani przenoszenia powiadomień między UID.

## Wspólny dostęp rodziców i pojedyncze udostępnienie dziecku

Sebastian i Dominika zachowają wspólny dostęp rodzicielski wtedy, gdy ich **rzeczywiste dokumenty `members/{UID}`** mają ten sam zweryfikowany, poprawny `familyId`, zgodny z rachunkami. Nie należy tworzyć osobnego gospodarstwa dla każdego rodzica.

Dziecko musi mieć poprawne ID tego samego gospodarstwa i jego dokładny UID musi występować w `sharedWith` konkretnego rachunku. Nie daje to dostępu do pozostałych rachunków, zarządzania ani całych finansów. Kolejne okresy rachunku cyklicznego nie dziedziczą automatycznie udostępnienia. Rola `adult` sama w sobie nie daje dostępu rodzica do Finansów.

W zarządzaniu starszymi profilami bez przypisania zachowano kompatybilność tylko wtedy, gdy oba profile rzeczywiście mają brak pola, `null` lub pusty tekst. Granica poprawnie przypisany ↔ nieprzypisany oraz identyfikatory zarezerwowane/niepoprawne są odrzucane. Ta kompatybilność nie daje dostępu finansowego.

## Konieczna inwentaryzacja przed przypisaniem istniejących profili

**Nie wystarczy dopisać `familyId` wyłącznie do `members`.** Obecne Rules dla części plików porównują `ticket.familyId` z `profile.familyId`; brakujące wartości są odczytywane jako `null`. Po zmianie profilu porównanie `null == <nowe ID>` nie przejdzie. Takie niepełne przypisanie mogłoby odciąć istniejące zdjęcia zadań, nagród lub załączniki wizyt.

Przed jakąkolwiek zmianą operator musi przygotować manifest konkretnych rekordów, ich obecnych wartości i wiarygodnych powiązań:

| Kolekcja | Pola identyfikujące powiązanie | Co sprawdzić |
|---|---|---|
| `members` | ID dokumentu, `familyId`, `role`, `active`, `canLogin`, `archived`, `personKey` | Zweryfikowane UID i tożsamości członków gospodarstwa; zachowanie kont i ról. |
| `_taskPhotoUploads` | `taskId`, `uid`, `person`, `path`, `familyId`, `state` | Powiązanie z `tasks/{taskId}`, wykonawcą i konkretnym plikiem `taskProof/...`. Szczególnie działające tickety `open`/`submitted`. |
| `_taskRewardImageUploads` | `rewardId`, `uid`, `path`, `familyId`, `state`, `people`, `active` | Powiązanie z `taskRewards/{rewardId}`, `imageUploadId`/`imagePath` nagrody i konkretnym `taskRewardImages/...`. Szczególnie trwałe tickety `attached`; nie zmieniać listy odbiorców. |
| `healthDocuments` z `attachmentKind = 'health-record'` | `familyId`, `ownerProfileId`, `ownerUid`, `createdBy`, `readers`, `editors`, `attachmentRecordId`, `storagePath`, `state` | To jest również metadokument autoryzujący upload załącznika wizyty. Nie istnieje osobna kolekcja `healthVisitAttachments`. Sprawdzić gospodarstwo właściciela i wszystkich osób uprawnionych oraz rzeczywisty plik `healthDocuments/...`. |
| `healthRecords` | `attachmentDocumentId`, `createdBy`, `person`, `familyId` | Dwustronne powiązanie z `healthDocuments/{attachmentDocumentId}` i zgodność `attachmentRecordId` z ID wizyty. Nie zmieniać prywatności, opisu, dokumentu ani `calendarEventId`. |
| `tasks`, `taskRewards`, `taskCompletions`, `taskRewardRequests` | ID, `createdBy`/`uid`, przypisania, dotychczasowe `familyId`, odwołania do ticketów | Kontrola spójności istniejących powiązań. Nie przeliczać punktów, nie tworzyć nowych wykonań ani kopii nagród. |
| `taskPointBalances`, `taskPointLedger` | Dotychczasowe ID, `person`, istniejące powiązania i `familyId` | Zachować salda i historię; nie rekonstruować księgi z UI. |
| `financeBills`, `financeBillAudit` | `ownerUid`, `sharedWith`, `familyId`, `seriesId`, `periodIndex`, `billId`/`actorUid` audytu | Klasyfikacja każdego starego rachunku i jego historii na podstawie zweryfikowanych UID, a nie nazwy gospodarstwa albo fallbacku. |

Samodzielne starsze dokumenty `healthDocuments` bez `attachmentKind = 'health-record'` nadal mają dotychczasowe jawne ACL; nie należy dopisywać im pól ani zmieniać zgód bez odrębnego uzasadnienia. Uzupełnienie `familyId` nie zastępuje zgody właściciela dorosłej kartoteki ani rzeczywistego umocowania opiekuna.

Manifest musi wskazywać tylko jednoznacznie powiązane rekordy. Jeśli właściciel, uploader, edytor, wykonawca lub odbiorca wskazują różne gospodarstwa albo brak wiarygodnej identyfikacji: **STOP dla tych danych; wymagana ręczna weryfikacja**. Nie przypisywać wszystkich rekordów bez ID do jednej rodziny.

## Plan wdrożenia — dopiero po osobnym zatwierdzeniu

1. **Przygotować i zatwierdzić plan.** Sprawdzić aktualne wersje API, Rules i Functions. Wykonać zabezpieczony snapshot/manifest wyłącznie danych objętych przyszłym przypisaniem. Zatwierdzenie kodu nie jest zgodą na zmianę profili lub plików.
2. **Utrzymać wyłączone zapisy nowych funkcji.** Nie zmieniać automatycznie `FAMILY_V2_WRITES_ENABLED`. Pamiętać, że samo `false` nie blokuje wcześniejszego odczytu Finansów przez Admin API. Jeśli stara wersja jest już dostępna produkcyjnie, zapewnić kontrolowane okno niedostępności endpointu Finansów do czasu opublikowania poprawionego API i Rules; ukrycie menu nie jest takim zabezpieczeniem.
3. **Najpierw opublikować ochronę, potem rozważać provisioning.** Po zatwierdzeniu wdrożyć poprawiony Vercel API/klient oraz zmienione Firestore Rules. Zaktualizować backend używany przez funkcję `financeReminders`, tak aby scheduler i API miały tę samą walidację. Nie włączać nowego schedulera ani zapisów podczas tej czynności. Korzystać z ograniczonych poleceń wdrożenia właściwych usług; nie wykonywać zbiorczego `firebase deploy` obejmującego Hosting lub niepowiązane zasoby. Generowane `functions/server/` należy przygotować z kanonicznego `server/` istniejącym `scripts/prepare-functions.mjs`.
4. **Zweryfikować odmowę odczytu.** Nieprzypisane profile, `__legacy__`, błędne ID oraz rodzic obcego gospodarstwa nie mogą otrzymać rachunków przez API ani SDK; odmawiane muszą być też nowe okresy i przypomnienia. Starsze nieprzypisane dane pozostają zapisane, lecz finansowo niedostępne.
5. **Zatwierdzić osobne, rzeczywiste mapowanie UID.** Zaufany operator wybiera jeden losowy, poprawny identyfikator gospodarstwa i jawnie przypisuje do niego zweryfikowane UID Sebastiana, Dominiki i odpowiednich dzieci/profili. Nie rozpoznawać rodziny wyłącznie po imionach, e-mailu, roli `parent` ani globalnej liście wszystkich rodziców. Dla innego gospodarstwa użyć innego identyfikatora.
6. **Osobno zatwierdzić celowane uzupełnienie powiązanych danych.** Przed dopisaniem ID do istniejących `members` przygotować spójny plan dla zatwierdzonych ticketów/załączników i niezbędnych powiązanych metadanych. Zmienić wyłącznie pola przypisania gospodarstwa, bez zmiany UID, ACL, ról, sald, identyfikatorów dokumentów, kalendarza, plików, stanów uploadu i terminów. W granicach limitów Firestore zastosować atomowy zapis członków i powiązań; jeśli cały plan nie mieści się w jednej transakcji/batchu, utrzymać okno blokady wszystkich dotkniętych operacji, także uploadu/edycji przez bezpośrednie Firebase SDK; sama flaga backendu lub ukrycie UI nie wystarczają. Podzielić plan na zweryfikowane kroki i uruchomić dostęp dopiero po sprawdzeniu pełnej spójności. Nie pozostawiać działającej aplikacji w połowie przypisania.
7. **Stare rachunki kwalifikować indywidualnie.** Dla każdego `__legacy__`/nieprzypisanego rachunku potwierdzić `ownerUid` oraz każde UID w `sharedWith`. Zachować ID rachunku, okresy, historię i deduplikację. Nie wystarczy, że właściciel jest dowolnym rodzicem. Niejednoznaczne lub międzyrodzinne powiązanie wymaga zatrzymania i decyzji operatora; nie usuwać danych ani nie poszerzać uprawnień automatycznie.
8. **Sprawdzić kompatybilność.** Odczyt rachunków obu rodziców, jednego udostępnionego rachunku dziecka, odmowa dla drugiego gospodarstwa, otwarcie dotychczasowych zdjęć zadań/nagród i załączników wizyt, niezmienione salda oraz kalendarz. Testy zapisujące wykonywać na danych testowych/emulatorach, bez tworzenia fikcyjnych finansów rodziny.
9. **Włączenie operacji jest osobną decyzją.** Dopiero po sprawdzeniu planu, uprawnień i konfiguracji użytkownik może zatwierdzić włączenie istniejącej flagi zapisów i przygotowanej funkcji przypomnień. Ten etap nie włącza ich samodzielnie.

Na tym etapie nie przygotowano ani nie uruchomiono skryptu `apply`/migracji. Konkretna liczba i zawartość rekordów produkcyjnych nie zostały zweryfikowane; inwentaryzacja jest warunkiem przyszłego przypisania.

Flaga `FAMILY_V2_WRITES_ENABLED` jest wspólna także dla Zadań i Zdrowia. Jeżeli jest już włączona dla działających funkcji, nie zmieniać jej tylko w celu izolacji Finansów bez osobnego zatwierdzenia skutków. Okno zabezpieczające dotyczy wtedy wyłącznie endpointu i joba Finansów; istniejące funkcje innych modułów pozostają aktywne.

Po zatwierdzeniu etapu ochrony, z właściwej gałęzi i pod Node.js 22, minimalne polecenia Firebase są następujące. **Nie zostały wykonane i nie stanowią zgody na wdrożenie:**

```sh
npm run functions:prepare
npm --prefix functions run check
./node_modules/.bin/firebase deploy --project nasza-rodzina --only firestore:rules
./node_modules/.bin/firebase deploy --project nasza-rodzina --only functions:nasza-rodzina:financeReminders
```

Pierwsze dwa polecenia wyłącznie przygotowują i sprawdzają lokalną paczkę. Trzecie publikuje cały bieżący plik `firestore.rules`: przed użyciem trzeba porównać go z aktywną wersją chmurową i zatwierdzić pełny diff, aby nie nadpisać nowszych reguł innych modułów. Czwarte ogranicza aktualizację Functions do `financeReminders`; nie aktualizuje harmonogramów eduVULCAN ani pozostałych funkcji. Nie publikuje Storage Rules, Hostingu ani indeksów. Jeżeli przypomnienia nie są jeszcze wdrożone, ich utworzenie jest dodatkowym krokiem wymagającym zatwierdzenia i utrzymania bramki zapisów w bezpiecznym stanie. API Vercel wdrażać wyłącznie zatwierdzoną procedurą projektu, najpierw na Preview; ten dokument nie uruchamia ani nie promuje deploymentu.

## Konfiguracja i Storage

Ta poprawka nie wymaga nowych Environment Variables, sekretów ani rotacji kluczy. Nie zmienia konfiguracji Google Calendar ani eduVULCAN.

`storage.rules` pozostaje bez zmian. Finanse nie zapisują plików w Storage. Porównania rodzin w istniejących regułach Zadań i Zdrowia zachowują dotychczasowe zachowanie; dlatego wymagana jest opisana inwentaryzacja i spójny plan przed przyszłym uzupełnieniem profili. Nie dodajemy fallbacku `__legacy__` do Storage i nie poszerzamy odczytu plików.

## Weryfikacja lokalna

Uruchomiono pod Node.js 22.23.3. Operacje Firebase wykorzystały wyłącznie lokalne emulatory projektu `demo-nasza-rodzina` i syntetyczne dane.

| Sprawdzenie | Wynik |
|---|---|
| `npm run build` — TypeScript i Vite | PASS; istniejące ostrzeżenie o dużym bundle pozostaje |
| Wybrane testy jednostkowe Finansów, projekcji Kalendarza oraz uploadów Zadań/Zdrowia | 77/77 PASS |
| Wybrane testy serwera: Finanse, członkowie/Auth/profile, Zdrowie, ilustracje nagród, polityka zapisu i powiadomienia | 252/252 PASS |
| HTTP API, ponowione po dodaniu scenariusza `state` przy wyłączonej fladze zapisów | 10/10 PASS; 9 z nich było też w poprzednim zestawie |
| Firestore i Storage: `v2-security.rules` + `four-packages.security.rules` | 31/31 PASS |
| Paczka Functions i kontrakty runtime | 14/14 PASS; 47 kanonicznych modułów serwera zweryfikowanych |
| E2E Finansów: Chromium + WebKit | 8/8 PASS |
| Rozszerzony scenariusz braku gospodarstwa + prywatny/rodzinny Kalendarz, ponowiony po rozszerzeniu | 2/2 PASS; jest częścią powyższych 8 przypadków |
| Dodatkowy istniejący `calendar-v2.spec.ts` | 0/6 PASS; ograniczenie opisane poniżej |

Nie przedstawiamy całej przeglądarkowej regresji Kalendarza jako zaliczonej. Starszy zestaw oczekuje etykiety „Moje wydarzenia”, podczas gdy bieżący niezmieniony UI pokazuje „Sebastian”; jego selektor `/Dodaj wydarzenie/` pasuje jednocześnie do głównego przycisku i pól osi czasu. Trzeci scenariusz ma timeout kliknięcia szczegółów na Start po odłączeniu elementu DOM. Te trzy scenariusze nie przeszły w obu przeglądarkach. Kod `StartPage.tsx`, `CalendarPage.tsx` oraz sam starszy test pozostały identyczne z bazą tej poprawki; nie zmieniono tych ekranów w celu uzyskania zielonego wyniku. Przyczyna timeoutu Start nie została rozstrzygnięta w tym zakresie.

Niezależny scenariusz tej poprawki potwierdza odczyt własnego prywatnego wydarzenia, odmowę odczytu prywatnego wydarzenia drugiego rodzica, wykluczenie obu z widoku rodzinnego oraz brak zapytań Finansów przy nieprzypisanym profilu. Nie potwierdza to wszystkich pozostałych interakcji Kalendarza. Przed wdrożeniem produkcyjnym trzeba rozstrzygnąć opisane błędy starszego zestawu oraz przeprowadzić zatwierdzoną inwentaryzację danych.

## Pliki poprawki

- Serwer: `server/family-identity.mjs` (nowy), `server/account-members.mjs`, `server/finance-model.mjs`, `server/finance-service.mjs`, `server/finance-reminders.mjs`, `server/notification-inbox.mjs` (tylko ponowna walidacja rodziny rachunku).
- Reguły: `firestore.rules` — wyłącznie sekcja Finansów. `storage.rules` nie zmieniono.
- Klient: `src/app-shared.tsx` i `src/family-members.ts` (wyłącznie typy profilu), `src/features/FinancePage.tsx`, `src/finance/model.ts`, `src/finance/calendar-projection.ts`, `src/finance/useFinanceBills.ts`, `src/finance/useFinanceCalendarSources.ts`.
- Testy: `tests/account-members.test.mjs`, `tests/family-v2-http.test.mjs`, `tests/finance-model.test.mjs`, `tests/finance-service.test.mjs`, `tests/finance-reminders.test.mjs`, `tests/finance-ui-model.test.ts`, `tests/finance.spec.ts`, `tests/four-packages.security.rules.test.mjs`.
- Dokumentacja: niniejszy nowy dokument oraz korekta wcześniejszego opisu `__legacy__` w `docs/CZTERY_PAKIETY_2026-10-12.md`.

Lokalne `functions/server/` odtworzono istniejącym generatorem z kanonicznego `server/`; nie jest to deployment ani drugi niezależny zbiór źródeł. Nie zmieniono eksportów Functions, ich harmonogramów, konfiguracji Firebase ani zmiennych środowiskowych.

## Rollback

- Wyłączyć lub pozostawić wyłączone zapisy i nowe przypomnienia; w razie potrzeby utrzymać blokadę endpointu Finansów.
- Nie przywracać aktywnego fallbacku `__legacy__`, nawet jeśli przywracana jest wcześniejsza wersja interfejsu. Cofnięcie API lub Rules do dawnej polityki mogłoby ponownie ujawnić rachunki.
- Przyszłe przypisanie danych można cofnąć tylko według zatwierdzonego manifestu wartości przed zmianą, z taką samą kontrolą spójności profili i ticketów. Nie usuwać rachunków, punktów, dokumentów, plików ani historii.
- Nie wykonywać automatycznej naprawy przez otwarcie Rules, przeniesienie wszystkich nieprzypisanych profili do jednego ID albo masowe usunięcie starszych rekordów.

**Stan bieżącego etapu: przygotowano zabezpieczenia i instrukcję; produkcja, sekrety oraz dane pozostają bez zmian.**

Kolejny etap udostępnia [narzędzie przygotowania migracji w trybie wyłącznie dry-run](HOUSEHOLD_MIGRATION_DRY_RUN_2026-10-13.md). Nie zawiera wykonawcy migracji ani opcji zapisu do Firebase. Wyniki inwentaryzacji pozostają prywatne poza repozytorium.
