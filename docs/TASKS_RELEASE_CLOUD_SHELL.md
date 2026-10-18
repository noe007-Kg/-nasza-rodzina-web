# Zadania — kontrola produkcji i kopia bez migracji

To narzędzie diagnostyczne nie wdraża aplikacji ani reguł i nie wykonuje migracji. Oddzielna poprawka Zadań pozostaje na gałęzi `feature/tasks-rewards-readiness-20261017`, commit `f46f197b344f6d7a951d2f38fef3ff4d34b35631`. Gałąź diagnostyczna nie jest wersją aplikacji do promowania na produkcję.

## Uruchomienie przez właściciela

Wklej **jedno polecenie** poniżej do terminala swojego prywatnego Cloud Shell. Skrypt sam sprawdzi autoryzację, wymagane narzędzia i miejsce, pobierze przypiętą wersję kontroli, zainstaluje lokalne zależności oraz uruchomi kopię i odtworzenie w emulatorach. Nie trzeba przechodzić do repozytorium ani wykonywać poleceń Git ręcznie.

Nie wysyłaj do rozmowy kodów logowania, poświadczeń ADC, archiwum ani klucza kopii. Nie trzeba autoryzować środowiska Codexa przez przekazywanie sekretów.

Zalecany runtime kontroli to Node.js 22 (co najmniej 22.12). Próba odtworzenia wymaga także Java 21 i emulatorów Firebase. Pierwsze uruchomienie pobierze zależności i emulatory. Odczyty Firestore/Storage i pobieranie plików mogą być płatne według planu projektu. Nie są wykonywane operacje zapisu w produkcji.

Na wcześniejszym zrzucie katalog domowy Cloud Shell był zajęty w 97%. Polecenie używa osobnego katalogu `/tmp`; wymaga co najmniej 4 GiB wolnego miejsca przed pobraniem zależności. Nie usuwa żadnych istniejących plików. `/tmp` jest tymczasowy — nie wolno pozostawić tam jedynej kopii. Nie zmienia istniejącego checkoutu, gałęzi, profilu ani konfiguracji Google Cloud.

```bash
(umask 077; NR_LAUNCHER="$(mktemp /tmp/nr-check.XXXXXXXX.sh)" && curl -fsSL https://raw.githubusercontent.com/noe007-Kg/-nasza-rodzina-web/feature/tasks-release-preflight-20261018/scripts/run-tasks-preflight.sh -o "$NR_LAUNCHER" && printf '%s  %s\n' 66172b129da524313ae0fbcb020b0669f1b62e5ddc64bced05a28e1d527e5c40 "$NR_LAUNCHER" | sha256sum -c - && bash "$NR_LAUNCHER")
```

Polecenie najpierw pobiera cały skrypt i weryfikuje jego SHA-256. Zmiana zawartości pod adresem zatrzyma uruchomienie. Sam skrypt pobiera dokładnie kontrolę `f6187f3` i źródło reguł `f46f197`, zamiast uruchamiać dowolną przyszłą wersję gałęzi. Repozytorium jest publiczne; GitHub nie wymaga logowania.

Jeżeli kontrola zatrzyma się na wymaganiach środowiska, pokaże konkretny brak przed pobraniem danych. Nie instaluje globalnie Java ani Node. Brak autoryzacji ADC wymaga zalogowania we własnym terminalu; skrypt nie wypisuje tokenu.

Zakończenie kodem `2` z raportem oznacza **kontrolę zakończoną, ale wdrożenie nadal zablokowane**, a nie zgodę na włączenie zapisów. Nie trzeba ponawiać kosztownego skanowania tylko z powodu tego kodu. Przekaż końcowe podsumowanie z terminala; prywatne pliki zachowaj u siebie.

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

Kontrola przygotowuje dowody wydania Zadań. Archiwum obejmuje również dokumenty innych kolekcji, ale nie zastępuje osobnego sprawdzenia izolacji Finansów ani akceptacji różnic reguł dla nowszego wydania obejmującego Finanse.
