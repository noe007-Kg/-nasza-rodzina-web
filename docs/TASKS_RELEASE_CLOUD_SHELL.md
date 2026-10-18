# Zadania — kontrola produkcji i kopia bez migracji

To narzędzie diagnostyczne nie wdraża aplikacji ani reguł i nie wykonuje migracji. Oddzielna poprawka Zadań pozostaje na gałęzi `feature/tasks-rewards-readiness-20261017`, commit `f46f197b344f6d7a951d2f38fef3ff4d34b35631`. Gałąź diagnostyczna nie jest wersją aplikacji do promowania na produkcję.

## Uruchomienie przez właściciela

Uruchom poniższy blok w swoim prywatnym Cloud Shell, w którym działa autoryzacja ADC dla projektu `nasza-rodzina`. Nie wysyłaj do rozmowy kodów logowania, poświadczeń ADC, archiwum ani klucza kopii. Nie trzeba autoryzować środowiska Codexa przez przekazywanie sekretów.

Zalecany runtime kontroli to Node.js 22 (co najmniej 22.12). Próba odtworzenia wymaga także Java 21 i emulatorów Firebase. Pierwsze uruchomienie pobierze zależności i emulatory. Odczyty Firestore/Storage i pobieranie plików mogą być płatne według planu projektu. Nie są wykonywane operacje zapisu w produkcji.

Na wcześniejszym zrzucie katalog domowy Cloud Shell był zajęty w 97%. Poniższe polecenie używa osobnego katalogu `/tmp`; narzędzie sprawdza dostępne miejsce. Nie usuwa żadnych istniejących plików. `/tmp` jest tymczasowy — nie wolno pozostawić tam jedynej kopii.

```bash
NR_CHECK_DIR="$(mktemp -d /tmp/nr-tasks-check.XXXXXX)" &&
git clone --depth 1 --branch feature/tasks-release-preflight-20261018 \
  https://github.com/noe007-Kg/-nasza-rodzina-web.git "$NR_CHECK_DIR/repo" &&
cd "$NR_CHECK_DIR/repo" &&
git fetch --depth 1 origin f46f197b344f6d7a951d2f38fef3ff4d34b35631 &&
npm --cache "$NR_CHECK_DIR/npm-cache" ci --ignore-scripts --no-audit --no-fund &&
FIREBASE_EMULATORS_PATH="$NR_CHECK_DIR/emulators" \
  npm run tasks:preflight -- --backup --output "$NR_CHECK_DIR/private"
```

Jeżeli repozytorium wymaga logowania GitHub, użyj istniejącej autoryzacji Cloud Shell; nie wklejaj tokenu do adresu `git clone` ani do rozmowy. Nie odczytuj ani nie udostępniaj zawartości poświadczeń.

Szybszą kontrolę bez kopii i bez emulatorów można wykonać przez `npm run tasks:preflight -- --check`. Wynik takiej kontroli nigdy nie jest dowodem posiadania kopii i udanego odtworzenia.

## Jak rozumieć wynik

- Do rozmowy wystarczą końcowe liczniki i kody z terminala. Narzędzie nie wypisuje UID, nazwisk, treści zadań, danych medycznych, adresów plików ani tokenów.
- Brak dostępu do usługi, brak bucketu, brak miejsca lub niekompletny odczyt są blokadą, a nie potwierdzeniem pustej bazy lub magazynu.
- Kopia nie wymaga zatwierdzania 236 proponowanych zmian. Nie jest uruchamiany ani zatwierdzany plan migracji.
- Zgodność produkcyjnych reguł porównuje się ze źródłem poprawki Zadań `f46f197`. Różnica oznacza konieczność zaplanowania zgodnej publikacji; nie należy samodzielnie zastępować reguł ani obchodzić wyniku.
- Metadane pięciu profili nie stanowią niezależnego dowodu jednego gospodarstwa. Brak `familyId` lub niejednoznaczna własność nie są naprawiane automatycznie ani przez dopasowanie imion.
- Test odtworzenia rzeczywiście używa świeżego lokalnego projektu `demo-*`. Pozytywny wynik porównania danych nie zastępuje dowodu rollbacku uzgodnionej zmiany, uprawnień aplikacji ani posiadania drugiej kopii.
- Kopia obejmuje wyłącznie zakres jawnie opisany w wyniku. Hasła Firebase Authentication, sekrety Secret Manager i pełne sesje logowania Auth nie są eksportowane. Nie wolno przedstawiać takiej kopii jako pełnego odtworzenia tożsamości i wszystkich usług Google Cloud.
- Niepobrane zewnętrzne zdjęcia lub dokumenty pozostają niezweryfikowane. Nie wolno uznać pełnej kopii za gotową tylko dlatego, że pliki w jednym buckecie zostały pobrane.

## Przed wydaniem

Archiwum i klucz zachowaj poza środowiskiem tymczasowym, w oddzielnych bezpiecznych miejscach. Potrzebna jest druga sprawdzona kopia oraz dostępny dowód odtworzenia związany z hashem właściwego archiwum. Nie przesyłaj ich do GitHub ani rozmowy.

Żaden wynik narzędzia sam nie publikuje reguł, nie zmienia przypisań profili i nie odblokowuje zapisów. Nie ustawiaj `FAMILY_V2_WRITES_ENABLED=true` na potrzeby Zadań. Niezależny przełącznik `FAMILY_TASKS_WRITES_ENABLED` można uruchomić dopiero po sprawdzeniu wszystkich warunków konkretnego wydania.
