# Pakiet A — kontrola i minimalna poprawka, 25.10.2026

## Zakres i punkt odniesienia

Repozytorium: `noe007-Kg/-nasza-rodzina-web`. Punktem odniesienia jest commit
`7062e32c88c469786d05eeaa76c21404a9398bda` z gałęzi
`feature/calendar-chat-school-package-20261023`, wskazany przez najnowsze
wdrożenie Vercel oznaczone `production`, w stanie `READY` (odczyt 25.10.2026).
Nie jest to `main` (`1f75aa2`): PR celowo dotyczy wersji zawierającej obecny moduł,
bez ponownego wprowadzania całej aplikacji z nowszych gałęzi do main.

Nie zmieniono danych, reguł, indeksów, sekretów ani konfiguracji produkcyjnej.
Nie wykonano migracji 236 dokumentów, wdrożenia, promocji ani rozbudowy backupów.

## Co istnieje i zostało sprawdzone w kodzie/testach

- Tworzenie i przypisywanie zadań; sprawdzanie świeżego profilu; rodzic ustala
  punkty i weryfikację. Dziecko może zgłaszać swoje lub rodzinne zadania.
- Tryby zaufania, decyzji rodzica i zdjęcia; status oczekiwania bez punktów;
  odesłanie do poprawy z komentarzem; archiwizacja i zadania cykliczne.
- Transakcja kończąca zadanie zapisuje saldo, niezmienną historię operacji
  i wykonanie. Powtórne zatwierdzenie nie przyznaje punktów ponownie.
- Historyczne zadania stanowią saldo otwarcia bez przepisywania dokumentów.
- Katalog nagród, przypisanie do osób, prośba o wymianę, odmowa bez obciążenia,
  kontrola wystarczającego salda i jednokrotne odjęcie kosztu przy akceptacji.
- Zdjęcie dowodowe ma prywatny bilet wysyłki, limit 8 MB, sprawdzany typ,
  rozmiar, nagłówek pliku i metadane. Przy zgłoszeniu usuwany jest token publicznego
  pobierania. Interfejs korzysta z autoryzowanego pobrania blobu.
- Przy akceptacji: punkty, odebranie dostępu do biletu, usunięcie odnośnika z zadania
  i trwałe zlecenie usunięcia są zapisywane atomowo. Następnie wykonywane jest
  rzeczywiste `Storage.file(path).delete({ ignoreNotFound: true })`.
- Przy „do poprawy”: stary dowód jest unieważniany i usuwany tą samą kolejką,
  punktów nie ma, ponowne zgłoszenie wymaga nowego zdjęcia. Nowszy dowód nie jest
  usuwany przez ponowienie starego zlecenia.
- Porzucone wysyłki mają osobne sprzątanie; zdjęcie oczekujące na rodzica pozostaje.
  Ilustracja nagrody pozostaje po wymianie punktów — nie jest dowodem zadania.
- Wersjonowane reguły Firestore zabraniają klientowi zapisywania salda i księgi.
  Storage wymaga żywego biletu, właściwego konta/rodziny i parametrów pliku;
  unieważniony bilet blokuje odczyt nawet przed fizycznym usunięciem obiektu.

Powyższe opisuje kod i testy lokalne, nie potwierdza aktywnych reguł ani działania
zapisu na produkcji. Testowa baza pamięciowa serializuje transakcje; test powtórzeń
nie zastępuje testu konfliktów w rzeczywistym Firestore.

## Naprawa

`deleteQueuedTaskPhoto` obsługiwał błąd Storage, lecz mógł odrzucić odpowiedź po
zatwierdzeniu, jeżeli zawiódł także zapis informacji o ponowieniu w Firestore.
Dotyczyło to również usuniętego obiektu, gdy zapis potwierdzenia usunięcia zawiódł.

Teraz awaria zapisu metadanych sprzątania nie zmienia powodzenia akceptacji.
Trwałe zlecenie oczekujące, zapisane wcześniej z punktami, zachowuje ścieżkę i
może być wykonane ponownie. Brak pliku jest traktowany jako poprawne usunięcie.
Dodano dwa testy awarii zapisu oraz pełną ścieżkę poprawy i nowego dowodu.

## Wyniki walidacji

- `npm run test:server:v2`: 54/54, w tym trzy nowe scenariusze.
- `node --test tests/tasks-reward-images.test.mjs`: 9/9.
- `npm run test:unit`: 327/327.
- `npm run build`: poprawny; istniejące ostrzeżenie Vite o wielkości paczek.
- `npm run functions:prepare` i `npm --prefix functions run check`: poprawne;
  49 modułów serwera przygotowanych i zweryfikowanych, bez wdrażania.
- Dodatkowe testy pakowania: 7/8; test tworzenia dowiązania blokuje Windows
  (`EPERM`), także poza ograniczonym procesem. Nie zmieniano testu, aby go ominąć.
- `node --test tests/functions-runtime.test.mjs`: 7/7 po zainstalowaniu osobnych
  zależności Functions. Lokalny Node 24, docelowy runtime Functions to Node 22;
  weryfikacja docelowego runtime pozostaje wymagana przed wydaniem.
- Reguły Firestore/Storage i E2E: wymagają lokalnych emulatorów oraz Javy.
  Java nie jest dostępna w PATH; nie potwierdzono tych testów ani działania
  produkcyjnych reguł. Nie wykonywano testów zapisu na produkcji.

## Pozostałe blokady do uruchomienia

1. Odczyt metadanych zmiennych Vercel bez odszyfrowywania sekretów nie wykazał
   `FAMILY_V2_WRITES_ENABLED` w produkcji. Kod domyślnie wyłącza zapis; wyjaśnia
   to nieaktywne przyciski i baner widoczny na dostarczonym zrzucie.
   Preview niezależnie od flagi zawsze blokuje zapis.
2. Ta flaga obejmuje także zdrowie i finanse. Nie należy jej włączać w ramach
   samej poprawki kodu ani traktować jako przełącznika wyłącznie zadań.
3. Przed osobno zatwierdzonym uruchomieniem trzeba potwierdzić aktywne reguły,
   indeksy kolejki, właściwy bucket i uprawnienia konta serwerowego do usuwania.
   `FIREBASE_STORAGE_BUCKET` nie występuje w odczytanej liście zmiennych Vercel;
   nie sprawdzano sekretnego konta usługi, więc konfiguracja bucketa pozostaje
   niepotwierdzona (kod dopuszcza też `app.options.storageBucket`).
4. Należy potwierdzić, że godzinowa funkcja `taskPhotoCleanup` jest wdrożona,
   ma ustawione `FAMILY_V2_WRITES_ENABLED` i bucket oraz rzeczywiście wykonuje
   ponowienia. Samo wdrożenie Vercel nie uruchamia harmonogramu Firebase.
5. Reguły i E2E wymagają udanego uruchomienia na odizolowanej bazie demo.
   Dane historyczne bez `familyId` są w obecnym serwerze obsługiwane jako legacy;
   to nie daje dowodu ścisłej izolacji wielu gospodarstw. Wcześniejsze gałęzie
   izolacji różnią się od obecnej produkcji; nie scalano ich zbiorczo ani nie
   obchodzono tej kwestii migracją. Przed uruchomieniem trzeba rozstrzygnąć
   zgodność obecnych profili i danych z wybranymi regułami.

Fizyczne usunięcie jest podejmowane od razu po transakcji. Podczas awarii Storage
plik może pozostać do skutecznego ponowienia; dostęp jest już odebrany, a punkty
pozostają przyznane. Bez aktywnego harmonogramu automatyczne retry nie jest
zagwarantowane. Ten PR nie stanowi zgody ani gotowości do publikacji produkcyjnej.
