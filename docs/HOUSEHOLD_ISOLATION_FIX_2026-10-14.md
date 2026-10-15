# Kalendarz, Zadania i Storage — poprawka izolacji gospodarstwa

Baza: `f6ee717`. Gałąź przeglądowa: `feature/calendar-tasks-storage-isolation-20261014`.

Zmiana jest przygotowaniem kodu i kontroli. Nie wykonano migracji, odczytu prywatnej produkcyjnej bazy, zmian sekretów, publikacji reguł ani deploymentu. Nie można na podstawie lokalnych testów potwierdzić aktualnej konfiguracji produkcji.

## Co zabezpieczono

- API i reguły odrzucają brakujący, nieprawidłowy oraz `__legacy__` jako identyfikator gospodarstwa. Profil musi mieć ważny, jawnie przypisany `familyId`; klient nie może sam go zmieniać.
- Kalendarz rodzinny ma zapytania ograniczone do gospodarstwa i rodzinnej widoczności. Prywatny kalendarz należy do UID właściciela; drugi rodzic ani dziecko nie otrzymują automatycznie dostępu. Zapisy zachowują autora, rzeczywisty profil osoby, źródło, serię, strefę czasową i inne istniejące metadane. Źródła Google pozostają tylko do odczytu zgodnie z wcześniejszym etapem.
- Zadania są odczytywane przez rodzica w jego gospodarstwie, a przez dziecko/dorosłego w jego własnym lub rodzinnym zakresie. Serwer ponownie sprawdza aktora i każdy dokument w transakcji. Punkty, historia i nagrody pozostają serwerowe; istniejące salda i identyfikatory zachowano, nowe identyfikatory sald i oczekujących nagród są odseparowane według gospodarstwa.
- Storage sprawdza gospodarstwo właściciela/uploader UID albo prywatnego serwerowego biletu. Dokumenty chronione nadal wymagają indywidualnego UID ACL, zgody lub sprawdzonego umocowania — rola rodzica nie daje automatycznie dostępu do dokumentów dorosłej osoby. Granty medyczne i przypomnienia również są związane z gospodarstwem.
- Nowe zdjęcia profili/produktów i starsze typy załączników Zdrowia są finalizowane przez istniejące API `/api/family/storage` lub profili. Serwer sprawdza rzeczywiste bajty, typ, rozmiar, świeże uprawnienia i wersję pliku, usuwa token pobierania oraz sprawdza rezultat. Nie publikuje ścieżki, gdy token pozostał lub plik został zastąpiony. Zdjęcia zadań/nagród i chronione dokumenty też wymagają potwierdzenia usunięcia tokenu przed finalizacją.
- Odczyt zdjęć produktów korzysta z autoryzowanego Storage SDK. Nie powstają nowe publiczne `getDownloadURL`; istniejące obrazy aplikacji i dozwolone źródła zewnętrzne pozostają osobno rozpoznawane. Ograniczony rozmiarem Blob odzyskuje zweryfikowany typ MIME z autoryzowanych metadanych bez zmiany bajtów, aby podgląd obrazów/PDF działał również w WebKit.
- Sprzątanie plików zadań/nagród wymaga zgodności trwałej kolejki, biletu, powiązanego zadania/nagrody, UID i metadanych obiektu. Interaktywne zapytania oraz liczniki dotyczą tylko gospodarstwa rodzica. Operacje harmonogramu nadal sprawdzają każdy obiekt osobno.
- Szkolne i zdrowotne źródła wyświetlane w Kalendarzu mają ten sam zakres gospodarstwa. eduVULCAN dostał kontrole właściciela wspólnego połączenia i rodzica zatwierdzającego powiązanie ucznia. Nie zmieniono szyfrowania, kluczy, TTL, odnawiania sesji, lease, deduplikacji slotów ani cronów SP4. Nie pobierano danych z portalu.
- Producent i odbiorca powiadomień Kalendarza/Zadań/Zdrowia/Szkoły sprawdzają gospodarstwo; baseline i deduplikacja zmian pozostają zachowane. Same zmiany metadanych nie stają się nowymi ocenami lub wiadomościami.

Nie zmieniono CSS, terminów wydarzeń, zawartości kalendarzy, wartości punktów ani UID. Zmiany w Shopping/Start/Settings i źródłach Szkoły/Zdrowia służą obsłudze nowych granic uprawnień i chronionych plików; nie przebudowują wyglądu.

## Zgodność z migracją i preflight

Dotychczasowy manifest 11 zmian nie wystarcza do włączenia tej wersji. Ograniczenie się do pięciu `members.familyId` mogłoby odciąć istniejące powiązane dane. Trzeba przygotować świeży, kompletny plan na podstawie aktualnego stanu.

`household:preflight` używa teraz rozszerzenia `household-isolation-v1`. Nadal nie ma produkcyjnego trybu apply. Narzędzie proponuje wyłącznie kontrolowane pola: `familyId`, `private`, `visibility`, `ownerUid`, `ownerProfileId`, `imagePath`. Weryfikuje UID autora/właściciela i rzeczywisty profil, powiązania dokumentów, bilety zdjęć, salda i oczekujące nagrody. Nie przyjmuje dopasowania osoby wyłącznie na podstawie imienia obcego profilu. Konflikty i brak dowodu właściciela blokują plan.

Stare narzędzie `household:migration:dry-run` zachowuje domyślny manifest familyId. Opcja `--prepare-isolation` przygotowuje rozszerzony plan również bez pełnej kopii; nie zastępuje preflight.

Rekordy prezentacyjne bez wiarygodnego autora/uploadera wymagają indywidualnego przeglądu w prywatnym `reviewedRecordPaths` dla `quickProducts`, `familySettings`, `medicalContacts`. Nie dopisano tych zatwierdzeń za właściciela. Medyczne zewnętrzne URL lub linki bez bezpiecznej ścieżki nadal blokują automatyczny plan — nie są samoczynnie udostępniane lub zamieniane na publiczne pliki.

Kopia zawiera natywne dokumenty Firestore, binarne pliki wybranego bucketa, metadane Auth i sprawdzone źródła zewnętrzne. Treści i tokeny kopii są wyłącznie w szyfrowanym archiwum prywatnym. Nowy `downloadTokenReview` zawiera jedynie wersje obiektów i hash bajtów, bez wartości tokenów; jest planem przeglądu, nie wykonawcą unieważnienia. Tokeny prywatnych plików i produktów blokują gotowość. Nie odwołano żadnego istniejącego tokenu w produkcji.

Wielopolowy manifest wiąże się z pełną kopią i dokładnym `updateTime`. Próbne zastosowanie i rollback grupują pola w jeden zapis na dokument, zachowują brak pola/null/false i odrzucają nieaktualne wersje. Te zapisy są dostępne wyłącznie w osobnym projekcie demo/emulatorach. Produkcyjny apply nie został dodany.

## Warunki przyszłego wdrożenia

1. Właściciel przygotowuje świeży prywatny preflight i zatwierdza konkretny manifest, dowody kopii/odtworzenia oraz ewentualne rekordy wymagające przeglądu. Nie zatwierdza się niekompletnego Storage, 403/404 lub nieznanej własności.
2. Sprawdza się zgodność aktualnych produkcyjnych reguł z udokumentowaną wersją bazową i zapisuje ich kopię. Nowe lokalne reguły mogą celowo różnić się od jeszcze niewdrożonych produkcyjnych; preflight ma wtedy zgłosić różnicę, a nie twierdzić, że nowe zabezpieczenia już działają. Potrzebny jest zatwierdzony plan skoordynowanego przejścia.
3. Przed aktywacją przygotowuje się dodane indeksy `firestore.indexes.json`. Emulator nie dowodzi gotowości produkcyjnych indeksów.
4. Wyłącznie w osobno zatwierdzonym oknie utrzymaniowym, po zatrzymaniu zapisów i schedulerów, stosuje się kompletny manifest z preconditions, uzyskuje pokwitowania wersji oraz wykonuje zatwierdzony plan tokenów. Nie uruchamia się zmiany wyłącznie na profilach, nie korzysta się ze starego bootstrap zamiast kompletnego planu.
5. Publikacja spójnego backendu/API, klienta i reguł odbywa się jako osobno zatwierdzony etap. Wspólne moduły Functions wymagają ponownego `functions:prepare` i skoordynowanego opublikowania przed wznowieniem schedulerów, aby starszy importer Admin nie zapisywał ponownie rekordów bez `familyId`; `firebase.json` i eksporty Functions nie zostały zmienione. Istniejąca blokada zapisów Preview pozostaje aktywna. Nie dodano nowych zmiennych środowiskowych ani nowego endpointu Vercel.
6. Dopiero sprawdzenie dwóch rodziców, dzieci, kalendarzy, punktów, dokumentów, plików oraz obcej rodziny na wdrożonej wersji pozwala wznowić zapisy i harmonogramy. Nie wdraża się surowszych reguł przed ukończeniem powiązanego planu.

Rollback: w zamkniętym oknie przywrócić poprzedni komplet kodu/reguł i wyłącznie pola zatwierdzonego manifestu przy dokładnych pokwitowaniach post-apply. Równoczesna zmiana dokumentu wymaga ponownego przeglądu; nie wolno nadpisywać jej starym snapshotem. Unieważnionych tokenów nie przywraca się automatycznie, bo ponownie otworzyłoby to stare linki. Oryginalne binaria pozostają w szyfrowanej kopii.

## Granice dowodów i pozostałe ograniczenia

- Lokalne testy nie potwierdzają konfiguracji produkcyjnych Rules, IAM, indeksów, bucket location, kopii ani stanu rzeczywistych pięciu UID. Ten etap nie korzystał z ich danych.
- Nie wolno przenosić UID między gospodarstwami przed osobnym przeglądem wszystkich jego starszych, nieoznaczonych plików. Nowe pliki z `metadata.familyId` pozostają związane z pierwotnym gospodarstwem; nieoznaczone stare prefiksy wymagają zatwierdzonego backfillu albo zachowania tego ograniczenia. Endpointy aplikacji nie umożliwiają samodzielnej zmiany familyId.
- Legacy Czat rodzinny i zwykłe `shoppingItems` nadal nie stanowią pełnej izolacji wielu gospodarstw i nie były przebudowywane w tym zakresie. Preflight celowo nie ustawia `fullMultiHouseholdVerified=true`. Nie można uruchamiać wielu niezależnych gospodarstw w tym projekcie na podstawie samej tej poprawki.
- Storage emulator firebase-tools zachowuje oddzielną addytywną listę tokenów i ignoruje preconditions GCS PATCH. Testy potwierdzają odmowę finalizacji, gdy token został, oraz przekazanie preconditions do SDK. Test egzekwowania metageneration jest jawnie TODO; nie potwierdzono go w chmurze. Nie osłabiono kodu ani emulatora dla uzyskania PASS. Wymagany późniejszy test na osobnym zatwierdzonym testowym buckecie GCS.
- Budżet: brak nowych schedulerów/usług/sekretów. Dochodzą indeksy, ograniczone odczyty członkostwa i metadanych finalizacji; pełny backup, jego druga kopia i sieciowy odczyt binariów mają dotychczasowe koszty. Nie wprowadzono nowych źródeł przechowywania poza Firebase.

## Jedna czynność właściciela teraz

Na tej gałęzi, w przygotowanym środowisku Node.js 22 z ADC tylko do odczytu, Java 21 i zainstalowanymi zależnościami, uruchomić istniejący preflight z dotychczasową prywatną mapą pięciu UID:

```bash
npm run household:preflight -- --config /PRYWATNY_KATALOG/household.private.json --output /PRYWATNY_KATALOG/kontrola-izolacji
```

Zachować wygenerowany klucz kopii osobno od archiwum; nie przesyłać go, UID ani raportów prywatnych do GitHub/rozmowy. Udostępnić do przeglądu wyłącznie zanonimizowane kody blokad i liczniki. Kolejnym etapem jest zatwierdzenie kompletnego planu przejścia; to polecenie nie wykonuje migracji ani deploymentu.

## Weryfikacja lokalna

Kontrola w Node.js 22.23.3, wyłącznie na syntetycznych danych i projektach demo. Nie uruchamiano pełnej galerii ani całego dużego zestawu E2E.

| Zestaw | Wynik |
| --- | --- |
| TypeScript i `npm run build` | PASS; istniejące ostrzeżenie bundla >500 kB |
| Zestaw API, bezpieczeństwa i preflight obejmujący zmienione moduły | 621/621 PASS |
| Ponowna kontrola finalizacji plików/API po końcowym przeglądzie | 37/37 PASS (częściowo pokrywa powyższy zestaw) |
| `npm run test:functions` | 79/79 PASS |
| Istniejące Rules + nowe testy izolacji + kompatybilność migracji | 67 + 18 + 5 = 90/90 PASS |
| Integracje Calendar i eduVULCAN | 6 + 6 = 12/12 PASS |
| Integracje finalizacji Storage | 2 PASS, 1 jawne TODO ograniczenia emulatora |
| Pełna szyfrowana kopia → odtworzenie demo → wielopolowy manifest → rollback + konflikt wersji | 1/1 PASS |
| Typy MIME chronionych Blobów (obrazy/PDF, obcięte i niedozwolone pliki) | 3/3 PASS |
| Chromium i WebKit: Kalendarz, Zadania, Zdrowie, chronione obrazy i kopia danych | 8/8 PASS |
| Wygenerowany pakiet Functions vs kanoniczny `server/` | 49 modułów zgodnych |

Zestawy obejmują obce gospodarstwo, identyczne imiona, brak familyId/sentinel, role i disabled, CRUD, prywatność drugiego rodzica, ACL dorosłego, bilety i sprzątanie plików, punkty bez podwójnego przyznania, baseline, lease/sloty oraz odtworzenie/rollback. Dodatkowo sprawdzono odrzucenie ponownej finalizacji pliku oznaczonego inną rodziną po przeniesieniu UID i cofnięcie dostępu wspólnego połączenia po zmianie roli rodzica w trakcie żądania.

Ograniczenie WebKit związane z `loading=lazy` jest uwzględnione w teście: kafelek jest przewijany do widoku przed oceną załadowania miniatury. Testy przeglądarkowe korzystają z prawdziwych listenerów i Rules emulatorów; odpowiedzi odczytowego API w Vite są atrapami. Nie stanowią potwierdzenia wdrożonego API ani konfiguracji chmurowej. Test GCS wymieniony wyżej nadal wymaga osobnej, zatwierdzonej weryfikacji.

## Pliki poprawki

- `docs/HOUSEHOLD_ISOLATION_FIX_2026-10-14.md`
- `firestore.indexes.json`
- `firestore.rules`
- `scripts/lib/household-evidence-capture.mjs`
- `scripts/lib/household-isolation-plan.mjs`
- `scripts/lib/household-migration-inventory.mjs`
- `scripts/lib/household-migration-plan.mjs`
- `scripts/lib/household-readiness-policy.mjs`
- `scripts/lib/household-rollback-rehearsal.mjs`
- `scripts/prepare-household-migration.mjs`
- `server/account-members.mjs`
- `server/account-profiles.mjs`
- `server/calendar-scheduler.mjs`
- `server/calendar-service.mjs`
- `server/calendar-storage.mjs`
- `server/edu-access.mjs`
- `server/edu-people.mjs`
- `server/edu-storage.mjs`
- `server/family-http.mjs`
- `server/health-access.mjs`
- `server/health-reminders.mjs`
- `server/health-service.mjs`
- `server/health-visit-attachments.mjs`
- `server/legacy-health-files.mjs`
- `server/notification-events.mjs`
- `server/notification-inbox.mjs`
- `server/notification-refresh.mjs`
- `server/presentation-images.mjs`
- `server/school-notifications.mjs`
- `server/tasks-photos.mjs`
- `server/tasks-reward-images.mjs`
- `server/tasks-service.mjs`
- `src/SchoolModule.tsx`
- `src/app-shared.tsx`
- `src/calendar-store.ts`
- `src/family-v2-client.ts`
- `src/features/CalendarPage.tsx`
- `src/features/FamilyPage.tsx`
- `src/features/HealthPage.tsx`
- `src/features/SettingsPage.tsx`
- `src/features/ShoppingPage.tsx`
- `src/features/StartPage.tsx`
- `src/features/TasksPageV2.tsx`
- `src/health/HealthDocumentViewer.tsx`
- `src/health/ProtectedHealthDocuments.tsx`
- `src/health/useCalendarHealthSources.ts`
- `src/household-scope.ts`
- `src/main.tsx`
- `src/notifications/refresh.ts`
- `src/private-storage-blob.ts`
- `src/school/OkruszekPlan.tsx`
- `src/useCalendarSchoolSources.ts`
- `src/usePrivateProductImages.ts`
- `src/useSchoolProfilePhotos.ts`
- `storage.rules`
- `tests/account-auth.test.mjs`
- `tests/account-members.test.mjs`
- `tests/account-profiles.test.mjs`
- `tests/calendar-household-isolation.test.mjs`
- `tests/calendar-scheduler.test.mjs`
- `tests/calendar-storage.integration.mjs`
- `tests/calendar-test-helpers.mjs`
- `tests/edu-access.test.mjs`
- `tests/edu-people.test.mjs`
- `tests/edu-scheduler.test.mjs`
- `tests/edu-storage.integration.mjs`
- `tests/family-v2-critical.test.mjs`
- `tests/health-visit-attachments.test.mjs`
- `tests/household-backup.integration.mjs`
- `tests/household-evidence-capture.test.mjs`
- `tests/household-evidence-controls.test.mjs`
- `tests/household-isolation-migration.test.mjs`
- `tests/household-isolation.rules.test.mjs`
- `tests/household-isolation.spec.ts`
- `tests/household-migration.rules.test.mjs`
- `tests/household-upload-finalization.integration.mjs`
- `tests/legacy-health-files.test.mjs`
- `tests/notification-events.test.mjs`
- `tests/notification-functions.test.mjs`
- `tests/notification-household-isolation.test.mjs`
- `tests/notification-refresh.test.mjs`
- `tests/notification-school-inapp.test.mjs`
- `tests/presentation-images.test.mjs`
- `tests/private-storage-blob.test.ts`
- `tests/security.rules.test.mjs`
- `tests/storage-household-api.test.mjs`
- `tests/storage-sdk-conditions.test.mjs`
- `tests/tasks-cleanup-isolation.test.mjs`
- `tests/tasks-household-isolation.test.mjs`
- `tests/v2-security.rules.test.mjs`
