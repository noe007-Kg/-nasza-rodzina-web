# Etap 4B — dynamiczne profile szkolne

## Zakres

Uprawnienia do wyboru ucznia we wspólnym połączeniu eduVULCAN wynikają z
rzeczywistych dokumentów `members`, a nie ze stałej listy trzech imion.
Profil docelowy musi mieć rolę `child`, `active: true`, nie być zarchiwizowany
ani wyłączony i mieć `schoolEnabled: true`. Profil bez konta
(`canLogin: false`) jest poprawnym celem rodzinnej synchronizacji.

`personKey` pozostaje niezmiennym identyfikatorem danych. Nowe profile używają
`member-` + 24 małe znaki szesnastkowe; identyfikator dokumentu profilu jest
osobnym polem kontekstu serwerowego. Nazwy Paweł/Nikodem/Layla są zachowane
wyłącznie jako format starych danych. Przy braku flagi stare profile
Paweł/Nikodem zachowują `schoolEnabled: true`, a Layla `false`. Domyślna
wartość obowiązuje wyłącznie, gdy pola rzeczywiście nie ma. Jawna flaga
musi być dokładnie `true`; `false` i niepoprawne typy odmawiają dostępu.
Imię wyświetlane nowego profilu nie nadaje uprawnień.

Zapytanie o role dzieci ma bezpieczny limit 64 dokumentów, sprawdzany poprzez
odczyt maksymalnie 65. Przekroczenie limitu, nieprawidłowy klucz lub dwa aktywne
szkolne profile o tym samym kluczu powodują odmowę zamiast uciętej listy
autoryzacji. To istniejąca granica ochronna jednorodzinnej architektury,
nie założenie o pięciu osobach. Liczą się także dokumenty nieaktywnych dzieci;
ewentualne zwiększenie tej granicy wymaga osobnego przeglądu.

## Ochrona importu

Każdy zapis wymaga jawnego zaufanego kontekstu połączenia: UID aktora,
scope, rola, dozwolone `personKey` i ich rzeczywiste identyfikatory dokumentów.
Nie ma zastępczego uprawnienia przy braku tego kontekstu. API i Scheduler
wyliczają go przez wspólny `resolveConnectionAccess`.

Aktywna sesja konta rodzica wymaga `active: true`, `canLogin: true`, roli
`parent` oraz braku archiwizacji/wyłączenia. Świeży dokument aktora i profil
wybranego ucznia są ponownie odczytywane w transakcji obsługującej lease,
aktualizację sesji i import. Archiwizacja, odebranie loginu aktorowi lub
wyłączenie szkolnego celu podczas odczytu dostawcy blokują import.

Przy utracie celu zachowana zostaje zaszyfrowana sesja, historia i baseline.
Świeże sprawdzenie stanu pokazuje `needs_profile`, umożliwiając rodzicowi
wybór innego uprawnionego ucznia. Pusty roster jest poprawną pustą listą;
status połączenia i rozłączenie pozostają dostępne.

Połączenie `student` nadal wymaga dokładnego UID dziecka, własnego profilu
szkolnego i istniejącego powiązania tożsamości szkoły potwierdzonego przez
rodzica. Skrzynka rodzica nie jest importowana do zakresu ucznia.

## Zgodność z istniejącą instalacją

- Nie ma nowych kolekcji, migracji ani zmian danych produkcyjnych.
- Nie ma nowych zmiennych środowiskowych ani zmian sekretów.
- Firestore Rules i Storage Rules pozostają bez zmian.
- Identyfikatory starych rekordów SP4 i ich `personKey` pozostają bez zmian.
- Istniejące lease, scheduleTime, crony, baseline, deduplikacja i prywatność
  wiadomości pozostają w tym samym mechanizmie.
- Szyfrowanie i odnowienie sesji z Etapu 5 pozostają niezmienione. Dodany
  odczyt celu odbywa się przed istniejącą ponowną kontrolą deadline sesji/lease.
- Jedno wspólne połączenie nadal synchronizuje wybrany profil dostawcy;
  ten etap nie wprowadza automatycznego pobierania wszystkich dzieci.
- Nie dodano endpointów Vercel ani nowych Functions.

Po przeniesieniu kanonicznych plików należy uruchomić istniejące
`npm run functions:prepare`, aby wygenerować identyczne `functions/server/`.
Nie należy kopiować wygenerowanych plików ręcznie.

## Przygotowane sprawdzenia

Testy obejmują dynamiczny profil z loginem i bez loginu, powiązanie osobistego
ucznia, odrzucenie błędnych/podstawionych kluczy i duplikatów, zmianę uprawnień
podczas odczytu dostawcy, pusty roster, stabilny stary identyfikator SP4,
cichy baseline i idempotencję. Integracje korzystają wyłącznie z lokalnych
emulatorów demo i syntetycznych tożsamości/sesji; sprawdzają także Rules
skrzynek rodzica i zakresu własnego dziecka.

Walidacja po przeniesieniu i niezależnym przeglądzie, Node.js 22.23.3:

- Server: **321/321 PASS** — w tym wszystkie 16 testów odnowienia sesji z Etapu 5 oraz nowe przypadki dynamicznego rosteru i zmiany uprawnień.
- Functions: **54/54 PASS** — harmonogramy, scheduleTime, lease i zgodność paczki z kanonicznym `server/`.
- Integracje w lokalnych emulatorach Auth/Firestore/Storage: **22/22 PASS**, z zachowaniem obu testów odnowienia i nowymi scenariuszami dynamicznego profilu.
- Build/TypeScript: **PASS**.
- Rules pozostały bez zmian; frontend nie zmienił się w tym etapie. Pełna regresja przeglądarkowa i Rules zostanie ponownie uruchomiona po scaleniu kolejnej integracji.
- Niezależny review ujawnił i poprawił przypadek malformed `schoolEnabled`: fallback legacy jest możliwy tylko przy rzeczywistym braku pola. Testy `null`, string, liczba i obecne `undefined` wymagają odmowy.

Dane testowe są syntetyczne. Nie kontaktowano portalu ani produkcyjnego Firebase. Etap zapisany jest wyłącznie w lokalnym commicie; nie wykonano push ani deploymentu.
