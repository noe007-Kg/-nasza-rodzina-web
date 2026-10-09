# Etap 1 — uprawnienia i diagnostyka modułu Rodzina

Baza: `1f75aa2`, gałąź `work/family-evolution-1f75aa2`.

## Zakres poprawki

- Zapytanie szkolne odpowiada aktualnemu UID i zakresowi profilu. Zmiana roli lub `personKey` odłącza poprzedni listener.
- Dane szkolne są oznaczone zakresem odczytu. Po zmianie profilu poprzedni zestaw nie jest wyświetlany, nawet przed uruchomieniem nowego efektu React.
- Puste, nieprawidłowe lub brakujące powiązanie dziecka nie powoduje zapytania o szkolne dane `family`. Wyświetlana jest informacja o konieczności uzupełnienia profilu.
- Historyczny profil dziecka bez pola `personKey` nadal może korzystać z poprawnego `name`. Gdy pole `personKey` istnieje, jego pusta wartość nie jest zastępowana nazwą. To odpowiada semantyce obecnych Firestore Rules.
- Ten sam wąski warunek odczytu jest stosowany na Starcie i w Szkole. Wygląd tych modułów nie został przebudowany.
- Moduł Szkoła jest montowany ponownie po zmianie zakresu, aby zamknąć także szczegóły wiadomości dostępnej w poprzedniej roli.
- Błąd listenera usuwa jego nieaktualne dane z pamięci widoku; nie usuwa dokumentów z Firestore.
- Komunikat błędu odczytu ma przypisane źródło. Po odzyskaniu odczytu lub opuszczeniu modułu usuwany jest wyłącznie komunikat tego źródła; błędy innych operacji pozostają.

## Bezpieczna diagnostyka

Błąd konkretnego odczytu w Rodzinie zawiera jeden z identyfikatorów:

- `family.calendar.shared` — kalendarz rodzinny;
- `family.calendar.private` — własny kalendarz prywatny;
- `family.tasks` — zadania;
- `family.school` — szkolny plan.

Kod widoczny w komunikacie, np. `family.school/permission-denied`, można przekazać do dalszej diagnostyki. Console warning zawiera wyłącznie identyfikator, dozwolony kod błędu, rolę i flagi aktywności/powiązania. Nie zawiera UID, imienia, treści dokumentu, loginu, hasła, cookies, tokenów, komunikatu źródłowego błędu ani stack trace.

## Czego ta poprawka nie potwierdza

Dla prawidłowego aktywnego rodzica wszystkie cztery zapytania są dozwolone przez lokalne Rules. Potwierdzone defekty dotyczą niepełnej tożsamości dziecka i zmian profilu podczas korzystania z modułu. Nie stanowią dowodu konkretnej przyczyny produkcyjnego błędu Sebastiana.

Jeśli po późniejszym, osobno zatwierdzonym wdrożeniu błąd rodzica pozostanie, należy najpierw uzyskać wskazany kod diagnostyczny i porównać opublikowane Rules, projekt oraz własny profil członkostwa. Nie uruchamiać bootstrapu/migracji ani nie rozszerzać uprawnień na próbę.

## Zachowane granice

Firestore Rules, Storage Rules, UID, kolekcje, dane produkcyjne, backend, szyfrowanie i sesja eduVULCAN oraz oba harmonogramy pozostają bez zmian. Nie są potrzebne nowe zmienne środowiskowe, sekrety ani migracja danych.

## Weryfikacja

Dodano testy jednostkowe zakresu odczytu i redakcji diagnostyki, testy Rules czterech zapytań oraz testy Chromium/WebKit obejmujące obu rodziców, niekompletny profil dziecka, uzupełnienie i zmianę tożsamości oraz zamknięcie prywatnej wiadomości po zmianie roli.

Weryfikacja w Node.js 22.23.3:

| Sprawdzenie | Wynik |
|---|---|
| Instalacja według obu lockfile | PASS |
| Build, w tym TypeScript | PASS |
| Unit | 79/79 PASS |
| Server | 250/250 PASS |
| Functions | 49/49 PASS |
| Firestore/Storage Rules | 26/26 PASS |
| Integracje emulatorowe | 18/18 PASS |
| E2E Chromium | 85/85 PASS |
| E2E WebKit | 85/85 PASS |

Łącznie E2E: 170/170 PASS. Projekt nie ma osobnego polecenia lint; kontrolę TypeScript wykonuje build. Zachowano istniejące ostrzeżenie Vite o wielkości głównego bundle.

Pełne E2E wykonano na zamrożonej kopii kodu etapu 1; zgodność 12 plików kodu i testów z przygotowanym indeksem Git potwierdzono bajt po bajcie. Trzynasty plik, ten raport, uzupełniono następnie o końcowe wyniki. Pozwoliło to niezależnie przygotować UI etapu 2 bez zmiany testowanego kodu. Testy korzystają wyłącznie z lokalnego projektu `demo-nasza-rodzina` i fikcyjnych danych.

Do lokalnego uruchomienia WebKit wskazano istniejące biblioteki spoza repo przez `LD_LIBRARY_PATH`. Walidator Playwright sprawdza bibliotekę GLES wyłącznie w systemowym `ldconfig`, dlatego po potwierdzeniu działania rzeczywistej przeglądarki pominięto ten test środowiska przez `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`. Nie pominięto żadnego testu aplikacji. Sandbox wymagał dostępu do lokalnych gniazd komunikacyjnych emulatorów i procesów przeglądarki. Te ustawienia nie są nowymi zmiennymi produkcyjnymi ani częścią kodu.
