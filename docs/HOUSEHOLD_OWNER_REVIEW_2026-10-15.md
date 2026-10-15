# Jedno narzędzie do przeglądu migracji gospodarstwa

Baza: `04fe021`. Gałąź: `feature/household-owner-review-20261015`.

Narzędzie przygotowuje decyzje i sprawdza dowody. Nie ma trybu apply, migracji, deploymentu, usuwania plików, unieważniania tokenów, zmiany IAM ani tworzenia bucketa. Nie włącza zapisów aplikacji. Nie zmienia modułów użytkowych, reguł ani synchronizacji eduVULCAN.

## Krótka instrukcja dla właściciela

W istniejącym katalogu projektu w Cloud Shell przejdź na tę gałąź. Użyj Node.js 22, dotychczasowych zainstalowanych zależności i ADC z uprawnieniami do odczytu stosowanymi przez preflight. Java 21 jest potrzebna tylko do lokalnej próby odtworzenia, jeżeli istnieje odpowiednia pełna kopia.

Uruchom **jedno polecenie**, podstawiając istniejącą prywatną konfigurację pięciu UID i dokładny katalog wyników preflight. `--output` ma wskazywać nowy prywatny katalog poza repozytorium:

```bash
npm run household:review -- \
  --config ~/nr-prywatne/household.private.json \
  --preflight ~/nr-prywatne/preflight/evidence-KONKRETNY_WYNIK \
  --output ~/nr-prywatne/przeglad-01 \
  --interactive
```

Można też podać konkretny `plan.private.json` zamiast jego katalogu. Narzędzie nie wybiera automatycznie „najnowszego” spośród kilku raportów lub gospodarstw.

Przed odpowiedzią przeczytaj lokalny `owner-review.md`. Porównaj pięć rzeczywistych UID i role z prywatną konfiguracją. Przy każdej nierozpoznanej pozycji sprawdź dokładną ścieżkę w `decisions-template.private.json` w tym samym katalogu, ewentualnie we własnej konsoli Firestore. Narzędzie nie pobiera treści dokumentów medycznych, nazw kontaktów ani treści wiadomości po to, by zgadywać właściciela.

Wpisz `POTWIERDZAM` wyłącznie po sprawdzeniu UID i jednego rzeczywistego gospodarstwa. Następnie zatwierdź `TAK` tylko rozpoznane dokumenty. `NIE` i pusty Enter pozostawiają blokadę. Nie trzeba ręcznie przepisywać 236 zmian ani zatwierdzać każdej lekcji.

Na końcu przeczytaj lokalny `report.md`. Jeżeli przypisania są sprawdzone, znajdziesz w nim **jedno gotowe następne polecenie pełnego preflight**, korzystające z nowej `reviewed-config.private.json`. Nie nadpisano oryginalnej konfiguracji. Ten preflight tworzy pełną zaszyfrowaną kopię i wykonuje odtworzenie/rollback wyłącznie w lokalnym demo; nie wykonuje migracji.

Nie przesyłaj do rozmowy ani GitHub raportów prywatnych, UID, pliku klucza, archiwum, konfiguracji lub pliku decyzji. Do dalszego przeglądu wystarczą liczniki i kody blokad. Polecenia nie zawierają żadnych wartości sekretów. Nie trzeba dodawać nowych sekretów lub Environment Variables.

## Co jest automatyczne

- Odczyt istniejącego planu i jego bezpiecznego zakresu: projekt, bucket, jeden poprawny `familyId`, pięć konkretnych UID oraz sześć dozwolonych pól. Liczniki są liczone z rzeczywistych zmian, nie z deklarowanego podsumowania.
- Świeży odczyt metadanych Firestore według istniejącej allowlisty, istnienia/aktywności kont Auth, powiązań dokumentów i Storage. Nie są pobierane hasła, sesje lub zawartość skrzynek szkolnych.
- Ponowna budowa planu istniejącym `buildHouseholdIsolationPlan`. Twórca/właściciel musi mieć zweryfikowany UID, a profil osoby musi odpowiadać istniejącemu profilowi tego gospodarstwa. Imię samo nie wystarcza. Obcy UID, konflikt `familyId`, brak profilu, niepełny Storage i inne blokady pozostają blokadami.
- Przeliczenie nowego zestawienia, jeżeli źródło zmieniło się od preflight. Raport wyraźnie pokazuje różnicę, a wcześniejsze decyzje nie obowiązują.
- Indywidualne pytania dotyczą wyłącznie niejednoznacznych `familySettings`, `quickProducts` lub `medicalContacts`, dla których **wszystkie pozostałe** warunki przechodzą. Pozostałe konflikty wymagają rozwiązania przyczyny, nie kolejnej zgody.
- Bieżący odczyt wydanych reguł Firestore/Storage i lokalizacji usług w UE. Brak uprawnienia lub różnica reguł nie staje się PASS. Różnica względem nowych reguł lokalnych wymaga skoordynowanego planu przejścia; narzędzie niczego nie publikuje.
- Pełny bieżący skan metadanych tokenów wybranego bucketa, z limitami i kontrolą paginacji. Raport zawiera tylko liczbę obiektów z tokenem, nigdy jego wartość. 403/404 nie oznacza zera plików lub tokenów.

W testach syntetyczne dane odtwarzają podany wynik: 236 zmian pól, w tym `familyId: 222`, `ownerProfileId: 4`, `ownerUid: 3`, `visibility: 4`, `private: 3`; kolekcje 179/28/18/5/4/2. To test formatu i logiki, nie odczyt ani potwierdzenie rzeczywistych danych rodziny.

Zatwierdzenie dodatkowego niejednoznacznego dokumentu może zwiększyć liczbę zmian, np. o jego `familyId`. Narzędzie pokazuje faktyczny wynik; nie wymusza stałej liczby 236.

## Potwierdzenia wiążą się z wersjami

Plik decyzji zawiera odciski konfiguracji, raportu wejściowego i całego odczytanego zestawu metadanych, a każda pozycja ma odcisk konkretnego dokumentu i jego `updateTime`. Nie można dopisać dowolnej ścieżki, obcego UID lub zatwierdzić innej wersji.

Nowa konfiguracja przenosi również `reviewedRecordVersions`: dokładne sekundy jako tekst i nanosekundy zatwierdzonych dokumentów. Pełny preflight odrzuci zmianę jako `REVIEWED_RECORD_VERSION_CHANGED`. Nie wystarczy zachować tej samej ścieżki po podmianie dokumentu. Starsze zatwierdzenia prezentacyjne bez pokwitowania wersji muszą zostać potwierdzone ponownie; nie są automatycznie uznawane za aktualne.

Dotychczasowe konfiguracje innych narzędzi bez nowego opcjonalnego pola zachowują wcześniejszy format i działanie. Nowe narzędzie zawsze dodaje pokwitowania do nowych indywidualnych zatwierdzeń.

Wariant bez interakcji zapisuje niezaznaczony szablon i instrukcję ponownego uruchomienia z `--decisions`. Nie ma automatycznej zgody, opcji `--yes`, `--skip-backup` ani `--skip-rules`.

## Kopia i dowód odtworzenia

Preflight z blokadą `ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED` zatrzymuje się **przed** pełną kopią. Sam plik `control-proof.private.json` ani licznik 236 nie dowodzą jej istnienia. Brak archiwum zostanie wskazany jako `REVIEW_BACKUP_ARCHIVE_MISSING` i `FULL_BACKUP_NOT_VERIFIED`.

Jeżeli w katalogu preflight istnieją `household-backup.nrb` i `backup.key`, narzędzie:

1. Rzeczywiście odczyta archiwum i sprawdzi AES-GCM, integralność binariów, hashe natywnych dokumentów, manifest, kompletność oraz dokładny plan, projekt, bucket, gospodarstwo i pięć profili/Auth.
2. Ponownie wykryje referencje zdjęć i plików z danych kopii, także zdjęcia Auth/Google. Każda musi mieć odpowiadające sprawdzone bajty. Nie pobierze ponownie nieznanych URL ani nie wyśle ich do zewnętrznej usługi.
3. Sprawdzi powiązanie dokumentów z manifestem przy dokładnych nanosekundach i rozróżnieniu braku pola/null/false. Kopia innego planu lub starego wariantu nie będzie uznana za kopię tego planu.
4. Wykona istniejącą próbę odtworzenia w nowym `demo-household-restore-*`, z emulatorami na loopback. Odtworzenie, próba wielopolowego planu i rollback nie dotykają produkcji. PASS wymaga również kodu zakończenia 0, właściwego archiwum i bezpiecznego zakresu demo.

Klucz do kopii jest osobnym, surowym plikiem 32-bajtowym; **nie jest kluczem eduVULCAN**. Jeżeli przeniesiono go w bezpieczne miejsce, użyj `--key-file PRIVATE_PATH`. Kopię z innego katalogu można wskazać `--backup-directory PRIVATE_DIRECTORY`, ale nadal musi odpowiadać dokładnie temu planowi i konfiguracji.

Opcjonalne `--second-copy PRIVATE_ARCHIVE` porówna faktyczne bajty drugiego pliku i odrzuci tę samą ścieżkę/hardlink. Zgodność dwóch plików w Cloud Shell nie dowodzi niezależnego miejsca przechowywania ani oddzielnej pieczy nad kluczem — te warunki nadal wymagają rzeczywistych dowodów właściciela. Niczego nie przesyła się automatycznie do innego magazynu.

## Co naprawdę może nadal blokować

Każde ostrzeżenie jest powiązane z konkretnymi kontrolami. Raport odróżnia brak dowodu, zweryfikowany fakt i ograniczenie zakresu; nie traktuje liczby ostrzeżeń jako wyniku bezpieczeństwa.

- **Pełna kopia/odtworzenie:** tylko faktyczne archiwum tego planu oraz wykonana próba. Po nowych zatwierdzeniach zwykle potrzebny jest świeży pełny preflight.
- **Spójność:** nowy odczyt metadanych nie jest ponownym pełnym skanem zawartości całej bazy. Zgodność bieżących odczytów między usługami nie stanowi atomowej migawki. Potrzebny będzie świeży pełny preflight i osobno zatwierdzone okno bez zapisów.
- **Izolacja:** poprawka `04fe021` zabezpiecza Kalendarz/Zadania/Storage. Starszy Czat i zwykłe `shoppingItems` nadal uniemożliwiają uznanie całej aplikacji za bezpieczną dla wielu niezależnych gospodarstw. Narzędzie nie ustawia `fullMultiHouseholdVerified=true`.
- **Tokeny:** niezerowy lub niekompletny skan blokuje gotowość. Nie odwołano istniejących tokenów ani URL. Jakakolwiek późniejsza zmiana wymaga oddzielnie zatwierdzonego planu i kopii.
- **Konta i klucze:** kopia metadanych Auth nie zawiera haseł, aktywnych sesji ani sekretów Secret Manager. Właściciel musi zapewnić odrębny sposób odzyskania dostępu i kluczy dostawców, bez przesyłania ich do narzędzia lub repozytorium.
- **Reguły i lokalizacja:** potrzebny faktyczny odczyt usług; brak dostępu, różnica lub niepotwierdzona lokalizacja UE pozostają widoczne.
- **Gospodarstwo:** konfiguracja i zgoda operatora nie stanowią niezależnego urzędowego dowodu relacji. UID, role, aktualna aktywność i rzeczywiste wspólne gospodarstwo wymagają świadomego potwierdzenia właściciela.

Wynik zawsze podaje `GOTOWE DO MIGRACJI: NIE`, `canApply:false`, `migrationExecutable:false` i 0 zapisów produkcyjnych. To etap przygotowania dowodów, nie wykonawca migracji ani zgoda na wdrożenie.

## Pliki i weryfikacja

- `scripts/review-household-migration.mjs` — jedno polecenie, odczyty źródła i reguł, pytania, kontrola archiwum/odtworzenia i raport.
- `scripts/lib/household-owner-review.mjs` — plan, UID, dozwolone decyzje, wiązanie wersji, bezpieczne zestawienie.
- `scripts/lib/household-review-backup.mjs` — kontrola rzeczywistych bajtów kopii i jej zakresu.
- `scripts/lib/household-migration-plan.mjs` — opcjonalne pokwitowania wersji dla późniejszego preflight.
- `package.json` — skrypt `household:review`; bez nowych zależności.
- Trzy nowe pliki testowe: `household-owner-review.test.mjs`, `household-review-backup.test.mjs`, `household-reviewed-versions.test.mjs`.

Testy obejmują obcą rodzinę, jednakowe imiona, obcy UID, nieaktualne zgody, podmienione ścieżki/archiwum/manifest, brak kopii, 403/404, cykle paginacji, fałszywy JSON odtworzenia, prywatne uprawnienia plików i brak wrażliwych treści w raporcie.

W Node.js 22 wykonano 139 testów jednostkowych i regresyjnych narzędzi: 139 PASS, 0 FAIL. Osobna rzeczywista próba szyfrowanej kopii → odtworzenie → wielopolowy plan → rollback w świeżych emulatorach: 1/1 PASS. Nie uruchamiano pełnych zestawów E2E ani builda niezmienionego interfejsu.

Nie wykonano odczytu ani kontroli prawdziwej produkcyjnej kopii w środowisku Codexa. Jedynymi danymi użytymi w testach były dane syntetyczne. Nie zmieniono Firestore/Storage Rules, aplikacji, konfiguracji Firebase/Vercel, sekretów ani danych produkcyjnych.
