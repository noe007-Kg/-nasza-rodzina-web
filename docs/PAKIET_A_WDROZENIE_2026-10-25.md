# Pakiet A — wdrożenie zatwierdzone 25.10.2026

Użytkownik po otrzymaniu PR i raportu zlecił: „popraw to wszystko i wdrożyć to”.
Ten dokument uzupełnia wcześniejszą kontrolę, która dotyczyła jeszcze etapu bez
zgody na produkcję. Zgoda obejmuje Pakiet A. Nie uruchomiono migracji 236 dokumentów,
nie rozbudowano backupów i nie zmieniano rodzinnych zadań w ramach testowania.

## Uzupełnione poprawki

- `TASKS_WRITES_ENABLED` włącza wyłącznie zadania/nagrody. Zdrowie i finanse nie
  są włączane przez tę flagę. Preview nadal nie zapisuje do produkcji.
- Wszystkie pięć istniejących profili ma jeden wspólny `familyId`. Cztery stare
  zadania nie mają `familyId`. `TASKS_LEGACY_FAMILY_ID` wiąże je wyłącznie z tą
  rodziną, bez migracji. Serwer odrzuca legacy bez jawnego powiązania oraz dane
  innej rodziny; profile wyłączone i zarchiwizowane nie mogą wykonać operacji.
- Dowody trafiają do osobnego `nasza-rodzina-task-proofs`, bez soft delete,
  wersjonowania i okresu retencji. Domyślny magazyn zachowuje dotychczasowe
  odzyskiwanie plików przez 7 dni. Ilustracje nagród pozostają oddzielone od dowodów.
- Podgląd dowodów i wysyłka używają właściwego bucketa w przeglądarce i na serwerze.
  Skonfigurowano CORS GET/HEAD tylko dla domen aplikacji, z zachowaniem autoryzacji.
- Poprawiono format ścieżki Windows w istniejącym pluginie Vite. Lokalny test
  wcześniej pokazywał pusty ekran, ponieważ czysty moduł obliczeń kalendarza
  trafiał pod blokowaną ścieżkę `/server`. Pozostała część `/server` jest nadal zamknięta.

## Wdrożenie Firebase

- Prywatny bucket dowodów utworzony w `europe-west1` i połączony z Firebase.
- Osobno wdrożono reguły nowego bucketa, reguły zadań oraz prefiks ilustracji nagród.
  Reguły Firestore poza blokiem zadań są bajtowo identyczne z poprzednią aktywną
  wersją. W istniejącym Storage pozostałe prefiksy nadal mają deny-all.
- Wdrożono tylko `taskPhotoCleanup`, Node 22, region `europe-west1`, co godzinę
  w strefie Europe/Warsaw. Funkcja ma dwa ponowienia uruchomienia harmonogramu,
  a poszczególne pliki zachowują trwałą kolejkę i narastający odstęp prób.
- Dodano cztery indeksy kolejek wyłącznie przez operacje create. Potwierdzono
  READY dokładnych indeksów. Nie usunięto pozostałych indeksów.
- Pierwsze wywołania funkcji w czasie tworzenia indeksów zgłaszały brak indeksu.
  Po READY należy potwierdzić poprawne uruchomienie przed zakończeniem wydania.

Automatyczna kontrola odrzuciła pierwotną wspólną komendę reguł jako zbyt szeroką.
Nie wykonywano jej inną drogą. Rozdzielono zakres, udowodniono identyczność reguł
poza zadaniami i wykonano trzy osobno zatwierdzone, ograniczone wdrożenia.

Aktywne pliki wdrożeniowe i opis powtarzania operacji: `deploy/package-a/README.md`.

## Weryfikacja przed frontendem

- Dotychczasowe 327 testów jednostkowych przeszło przy poprzedniej kontroli.
- Testy server:v2 po rozszerzeniu obejmują 57 scenariuszy; dodatkowo 9 testów nagród.
- Testy krytyczne, polityk i routera uruchomione również na docelowym Node 22: 39/39.
- Pełne istniejące reguły v2 w emulatorach: 15/15.
- Dokładne, ograniczone reguły produkcyjne Pakietu A: 3/3, w tym obca rodzina,
  utrata dostępu po unieważnieniu oraz zakaz bezpośredniego dopisywania punktów.
- Formularz nagrody w Chromium i emulatorach: 1/1. Sprawdzono opis, obrazek,
  zachowanie formularza po błędzie zapisu i ponowienie bez powtórnego uploadu.
- Budowanie aplikacji oraz prepare/check Functions: poprawne. Pozostało istniejące
  ostrzeżenie o wielkości paczki aplikacji, bez błędu budowania.

Nie zatwierdzano ani nie odsyłano prawdziwych rodzinnych zadań tylko na potrzeby
testu. Testy zapisu wykorzystują wyłącznie odizolowany projekt demo.

Reguły są weryfikowaną testami propozycją dla obecnego modelu jednej rodziny;
nie stanowią audytu pozwalającego publicznie udostępnić aplikację wielu rodzinom.
I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for server-only task transitions and private upload tickets. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
