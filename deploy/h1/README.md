# Poprawki H1 — Nasza Rodzina

## Zmiany

- H1-01: rodzic otwiera kalendarz całej rodziny. Prywatne wydarzenia pozostają w osobistym widoku właściciela. Pasek profili zawija się na iPadzie, więc wszystkie aktywne profile są widoczne. Błąd odczytu listy rodziny jest jawny zamiast cichego wyświetlenia tylko zalogowanej osoby.
- H1-02: harmonogram zajmuje pełną szerokość, ma skalę 60 px/godzinę, oś 06–22 oraz szczegóły w istniejącym oknie dialogowym. Usunięto przewijanie do bieżącej godziny. Wydarzenia poza osią pozostają dostępne w osobnej liście; wydarzenia przechodzące przez granicę osi zachowują swoje prawdziwe godziny w szczegółach.
- H1-03: rodzic może edytować opłatę również po oznaczeniu jako opłaconą. Status i data płatności zostają zachowane. Usunięcie wymaga potwierdzenia, przelicza podsumowania i wyklucza termin z kalendarza oraz przypomnień. Usunięty okres zachowuje znacznik archiwizacji, aby harmonogram cykliczny go nie odtworzył. Usunięcie korzenia serii zatrzymuje tworzenie nowych okresów; istniejące inne okresy pozostają bez zmian. Operacje są transakcyjne i audytowane.
- H1-04: opublikowano brakujące reguły osobistego stanu odczytu Firebase. Potwierdzenia odczytu synchronizują się przez istniejące subskrypcje. Wznowienie aplikacji i ponowienie po błędzie zapisu są obsługiwane. Ręczne gwiazdki pozostają niezależne od odczytu.
- H1-05: zwijany pasek rodziny, kompaktowy kalendarz i czytelniejsze etykiety na tablecie, przy zachowaniu dotychczasowych kolorów i komponentów.

## Firebase

Odczyt produkcyjny potwierdził pięć aktywnych profili, w tym dwoje rodziców. Reguły dopuszczały odczyt listy profili, ale nie zawierały ścieżek `chatReadStates` używanych przez klienta.

Plik `firestore.rules` w tym katalogu bazuje na dokładnie zweryfikowanej aktywnej wersji `deploy/school-ui/firestore.rules`. Dodaje wyłącznie pomocniczą kontrolę dostępu do wiadomości oraz reguły osobistych potwierdzeń odczytu i zgodności starszych stanów kanałów. Reguły pozostałych kolekcji pozostają identyczne. Nie publikować całego głównego `firestore.rules`, który zawiera również niezależne, niewdrożone funkcje.

Publikacja ograniczona do tego pliku:

```powershell
node node_modules/firebase-tools/lib/bin/firebase.js deploy --only firestore:rules --config deploy/h1/firebase.json --project nasza-rodzina
```

## Weryfikacja

- 327 testów jednostkowych aplikacji i 23 testy modeli/serwisu finansów przeszły.
- Trzy testy dokładnej wersji reguł H1 przeszły: własność potwierdzeń, odrzucanie obcych rozmów, scalanie między urządzeniami i zachowanie prywatnych znaczników szkolnych.
- 11 odrębnych testów Chromium przeszło: cztery rozmiary/orientacje harmonogramu i listy rodziny, dwa scenariusze czatu, trzy scenariusze finansów i dwie regresje rodzinnej osi/statusów Start. Poprawiono starsze selektory testu Start i odizolowano jego własny plan lekcji od wspólnych danych poniedziałkowych.
- 22 testy routingu, uprawnień zapisu i przypomnień finansowych przeszły.
- Kompilacja produkcyjna przeszła; istniejące ostrzeżenie o wielkości pakietu pozostaje.

Testy przeglądarkowe używają wyłącznie lokalnych emulatorów. Test finansów wykorzystuje prawdziwe transakcje serwisu przez lokalny transport testowy. Nie tworzą rachunków ani wiadomości w danych produkcyjnych.

## Potwierdzenie publikacji Firebase — 26.10.2026

- Poprzedni zestaw reguł: `de8bb1bc-5456-437c-b710-6b3219c7e541`.
- Nowy zestaw reguł: `51308b88-654a-44df-8508-74c62d0e8c88`.
- Firebase potwierdził poprawną kompilację i zakończoną publikację. Ponowny odczyt aktywnych reguł potwierdził zgodność z plikiem H1.
- Sprawdzono szerokości ekranów w Chromium; nie wykonano testu na fizycznym iPadzie ani w Safari.
