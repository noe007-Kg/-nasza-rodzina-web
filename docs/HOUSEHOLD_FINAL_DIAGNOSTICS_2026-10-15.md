# Końcowa diagnostyka przygotowania migracji — 15.10.2026

Narzędzie `household:diagnose` kontynuuje przygotowanie z `c05ba63` i poprawką izolacji `04fe021`. Nie ma trybu migracji, publikowania reguł, deploymentu, usuwania plików ani zmiany sekretów. Odczyty produkcyjne służą wyłącznie zebraniu dowodów. Zapisy próby odtworzenia i rollbacku dotyczą wyłącznie osobnego, lokalnego projektu emulatorów `demo-household-restore-*`.

**Produkcja nie została zweryfikowana przez wykonanie tego zadania w Codexie.** Zgłoszono 236 zmian pól, jedną niejednoznaczną pozycję i 12 blokad. Nie otrzymaliśmy prywatnego raportu ani jego listy kodów. Katalog narzędzia obejmuje 14 możliwych blokad gotowości; rzeczywiste 12 odczytuje ono dopiero lokalnie w Cloud Shell. Nieznane kody pozostają blokadami, bez kopiowania surowej treści do podsumowania.

## Jedna czynność właściciela

W katalogu właściwej gałęzi repozytorium, z już dostępnymi zależnościami projektu, uruchom:

```bash
npm run household:diagnose -- \
  --config /PRYWATNY_KATALOG/household.private.json \
  --review /PRYWATNY_KATALOG/POPRZEDNI_OWNER_REVIEW \
  --output /PRYWATNY_KATALOG/NOWA_DIAGNOSTYKA \
  --interactive
```

`--review` wskazuje poprzedni katalog `household:review` zawierający `review-summary.json` i `candidate-plan.private.json`. Można wskazać bezpośrednio plik podsumowania, a oryginalny plan osobno przez `--preflight`. Katalog wyjściowy powinien być nowy, prywatny i poza repozytorium. Narzędzie nie nadpisuje poprzednich dowodów. Konfiguracja i prywatne pliki wymagają uprawnień ograniczonych do właściciela.

Wymagania: Node.js **22, co najmniej 22.12**, Java **21+** oraz lokalny Firebase CLI z istniejących zależności instalowanych według `package-lock.json` przez `npm ci`. Musi istnieć dotychczasowy autoryzowany dostęp tylko do odczytu projektu. Narzędzie sprawdza dostępność środowiska; nie instaluje usług, nie włącza API i nie zmienia konfiguracji chmurowej. Pobranie wymaganych emulatorów przez lokalny Firebase CLI może wymagać dostępu do sieci.

## Co wykona jedno wywołanie

1. Odczyta lokalny raport i pięć konkretnych UID z prywatnej konfiguracji. Poprzednie liczniki i flagi `verified` nie są dowodem aktualnego stanu.
2. Ponownie sprawdzi dostępne metadane Firestore, profile/Auth, powiązania, produkcyjne reguły, lokalizacje i skan obecności tokenów. Częściowa awaria nie zamienia nieodczytanej usługi w pusty zbiór i nie odbiera wartości niezależnym, udanym kontrolom.
3. Przygotuje prywatne zestawienie właściciela. Potwierdzenie pięciu UID i faktycznego gospodarstwa pozostaje decyzją człowieka; same imiona, role i zgodność nazw nie dowodzą przynależności.
4. Poprosi o decyzję wyłącznie dla niejednoznacznych pozycji. Lokalny odnośnik, np. `R001`, prowadzi do wersji i ścieżki dokumentu w prywatnym pliku. Nie pokazuje treści medycznych ani wiadomości w końcowym podsumowaniu.
5. Po potwierdzeniu gospodarstwa i usunięciu blokad planu automatycznie wywoła istniejący pełny preflight w ramach tego samego polecenia: nową zaszyfrowaną kopię, kontrolę kompletności i ponowne odczyty oraz lokalne odtworzenie i próbę rollbacku. Jeżeli warunki nie są spełnione, nie rozpocznie tego etapu.
6. Zapisze `diagnostic-summary.json` i `report.md` w prywatnym katalogu oraz wyświetli końcowe podsumowanie bez nazwisk, UID, ścieżek dokumentów, URL, treści i wartości sekretów.

`approve` dla `R001` oznacza **potwierdzenie przynależności konkretnej wersji dokumentu do gospodarstwa**. Nie przypisuje automatycznie indywidualnego `ownerUid`. Nierozpoznany dokument pozostaw `pending` albo wybierz `reject`. Zmiana wersji dokumentu unieważnia odpowiadające potwierdzenie; nie należy dopasowywać go ponownie po samym imieniu. Potwierdzenie gospodarstwa i rekordu nie jest akceptacją nowego pełnego planu ani zgodą na migrację.

## Jak czytać blokady

Raport odróżnia **potwierdzony problem**, **brak dowodu** i **niezbędne potwierdzenie właściciela**. Poniższa tabela jest katalogiem, a nie stwierdzeniem, że wszystkie te kody wystąpiły produkcyjnie.

| Kod | Dowód lub działanie konieczne do rozstrzygnięcia |
| --- | --- |
| `PLAN_NOT_VERIFIED` | Aktualny plan bez konfliktów UID, gospodarstwa, prywatności i wersji; oczekująca decyzja nie jest błędem technicznym, ale nadal blokuje dalszy etap. |
| `FULL_BACKUP_NOT_VERIFIED` | Rzeczywiste archiwum: poprawne uwierzytelnione odszyfrowanie, manifesty i hashe, kompletność oraz zgodność z dokładnym planem, wersjami i pięcioma UID. |
| `RESTORE_NOT_VERIFIED` | Świeżo wykonane odtworzenie właściwej kopii w bezpiecznym, pustym lokalnym demo; zgodne dane i liczniki oraz kod procesu 0. |
| `ROLLBACK_REHEARSAL_NOT_VERIFIED` | Próba zastosowania i cofnięcia wszystkich pól w demo, zgodność odtworzonych wartości oraz atomowa odmowa użycia nieaktualnej wersji. |
| `PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED` | Rzeczywisty odczyt release/ruleset i porównanie źródła. Brak dostępu jest brakiem dowodu; odczytany mismatch jest potwierdzoną różnicą wymagającą planu przejścia. |
| `PRODUCTION_STORAGE_RULES_NOT_VERIFIED` | Jak wyżej, dla właściwego magazynu Storage. Diagnostyka nie publikuje reguł. |
| `CAPTURE_CHANGED_OR_NOT_RECHECKED` | Pełne ponowne odczyty Firestore, wersji/metadanych Storage i metadanych Auth. Tylko wykonane porównanie może potwierdzić wykrytą zmianę; błąd odczytu oznacza brak dowodu. |
| `PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED` | Odczyt lokalizacji bazy i wybranego bucketu. Lokalizacja poza UE jest innym wynikiem niż brak uprawnienia do sprawdzenia; kontrola nie dowodzi rezydencji wszystkich usług i kopii. |
| `EXTERNAL_FILES_NOT_FULLY_CAPTURED` | Pełne pokrycie wykrytych referencji, także zewnętrznych zdjęć i dokumentów, rzeczywistymi bajtami i hashami; pobieranie respektuje allowlistę domen i ochronę SSRF. |
| `OWNER_HOUSEHOLD_REVIEW_REQUIRED` | Świadome potwierdzenie pięciu rzeczywistych UID i jednego gospodarstwa, powiązane z bieżącym przeglądem. Nie można go zastąpić automatycznym dopasowaniem nazw. |
| `LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED` | Starszy Czat i zwykłe `shoppingItems` nadal wymagają odrębnej izolacji. Testy Kalendarza, Zadań i Storage nie potwierdzają bezpieczeństwa wszystkich modułów. |
| `PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW` | Kompletny skan i brak tokenów objętych kontrolą. Narzędzie odróżnia wykryte tokeny od nieudanego skanu; samo potwierdzenie właściciela nie usuwa ryzyka, a odwołanie tokenów wymaga osobnej zgody. |
| `AUTH_AND_PROVIDER_KEY_RECOVERY_NOT_VERIFIED` | Osobno sprawdzona procedura odzyskania kont i zachowania kluczy dostawców. Metadane Auth nie zawierają kopii haseł ani działających sesji logowania. |
| `SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED` | Rzeczywiście sprawdzona druga kopia w niezależnej lokalizacji poza Cloud Shell oraz oddzielna piecza nad kluczem; wymaga potwierdzenia właściciela. |

Starsza izolacja, odzyskanie kont/kluczy oraz niezależna kopia pozostają aktywnymi bramkami, dopóki nie powstaną odpowiednie dowody. Diagnostyka ich nie omija i nie ogłasza gotowości do migracji.

## Zakres dowodu kopii, odtworzenia i rollbacku

Pozytywne wyniki nowego pełnego etapu pochodzą z rzeczywistego wykonania w tym procesie i jego bezpiecznego callbacku. Wczytany JSON z `verified:true` nie zastępuje bajtów archiwum, poprawnego odszyfrowania ani zakończonej próby w emulatorach. Błąd Java lub uruchomienia emulatorów oznacza brak potwierdzenia odtworzenia, ale nie unieważnia niezależnie zweryfikowanej integralności utworzonej kopii.

Kopia obejmuje zakres istniejącego preflight: pełną domyślną bazę Firestore, bieżące obiekty wybranego magazynu, przechwycone odnośniki plików i metadane pięciu kont. Nie jest kopią haseł Firebase Auth, wartości Secret Manager, historycznych wersji wszystkich obiektów ani konfiguracji całej chmury. Zgodność dwóch skanów nie jest atomową migawką między usługami. Przed ewentualną późniejszą migracją potrzebne będą świeże dowody, zatwierdzony plan oraz uzgodnione okno bez zapisów.

Klucz **nowej kopii** jest obsługiwany wewnętrznie przez istniejący preflight, zapisywany wyłącznie do prywatnych artefaktów i nie trafia do raportu. Diagnostyka nie szuka starych kluczy po katalogach, nie odczytuje Secret Manager ani klucza szyfrowania eduVULCAN. Wartości tokenów, kluczy, sesji i dokumentów nie są publikowane w podsumowaniu. Prywatnych artefaktów, archiwów i plików kluczy nie przesyłaj do Codexa, GitHuba ani zwykłego zgłoszenia błędu.

Opcjonalne `--archive /PRYWATNA/KOPIA_A.nrb --second-copy /PRYWATNA/KOPIA_B.nrb` porównuje **wyłącznie rzeczywiste bajty dwóch wskazanych plików i rozpoznaje ten sam plik/hardlink**. Nie odszyfrowuje starych archiwów, nie potwierdza AEAD, kompletności, zgodności z aktualnym planem ani niezależnego miejsca przechowywania. Dwie identyczne kopie w Cloud Shell nie wystarczają do zaliczenia pieczy nad kopią i kluczem.

## Testy i następny etap

Weryfikacja obejmuje klasyfikację wszystkich kodów, brak zaufania do historycznych flag PASS, minimalizację danych w raportach, powiązanie decyzji z wersją, zachowanie faktów po częściowych awariach, brak produkcyjnych mutatorów i bezpieczny zakres callbacku. Na Node.js 22.23.3 wykonano **165/165 testów narzędzi i bezpieczeństwa** oraz **1/1 rzeczywistą lokalną integrację odtworzenia zaszyfrowanej kopii i rollbacku w emulatorach**, na danych syntetycznych. Kontrola składni nowych modułów i `git diff --check`: PASS. Nie uruchamiano budowania interfejsu, pełnego E2E ani kontroli produkcyjnych; kod aplikacji i reguły nie zostały zmienione.

Odczyty Firestore, listowanie/pobieranie Storage i zewnętrzne pliki mogą podlegać standardowym opłatom za operacje oraz transfer. Pełny etap kopiuje zawartość domyślnej bazy i wybranego magazynu, więc nie należy uruchamiać go wielokrotnie bez potrzeby. Nie tworzy zasobów chmurowych, harmonogramów ani magazynów. Pliki diagnostyki, kopia i klucz wymagają miejsca na prywatnym dysku Cloud Shell; samo przechowywanie tam nie stanowi niezależnej kopii.

Po uruchomieniu przeczytaj lokalne `report.md`. Właściciel wykonuje tylko wskazane potwierdzenia gospodarstwa/rekordu i niezależnej pieczy nad kopią oraz procedurą odzyskania. Do dalszej oceny przekazuj wyłącznie liczniki i kody blokad z końcowego podsumowania. **Nie wykonuj migracji, nie wdrażaj reguł i nie zmieniaj tokenów na podstawie samego zakończenia diagnostyki.**
