# Zadania i Finanse — stan przygotowania wydania, 18.10.2026

## Wynik

**Produkcja nie została zmieniona. Włączenie zapisów pozostaje zablokowane do potwierdzenia warunków bezpieczeństwa.**

Zweryfikowany aktywny deployment Vercel: `1c9dee87d283628861f3b49488f61f313bc85f89`, gałąź `feature/finance-and-safe-fixes-20261012`. Poprawka bazuje na przygotowanym wydaniu Zadań `f46f197b344f6d7a951d2f38fef3ff4d34b35631`. Nie jest to gałąź diagnostyczna ani migracja 236 zmian.

## Poprawka

- Ponownie wykorzystano część wcześniejszej poprawki izolacji Finansów `da1c828`, bez przenoszenia zmian administracji kontami i bez modyfikowania danych.
- API, reguły Firestore, projekcja kalendarza i przypomnienia wymagają jawnego, prawidłowego `familyId`. Brak identyfikatora nie tworzy wspólnego gospodarstwa `__legacy__`.
- Rodzice tego samego gospodarstwa zachowują dostęp do rachunków; dziecko otrzymuje tylko konkretnie udostępnione mu opłaty. Zablokowane konta i obce gospodarstwa nie otrzymują dostępu ani przypomnień.
- Finanse mają osobny, domyślnie wyłączony parametr `FAMILY_FINANCE_WRITES_ENABLED`. Steruje API oraz istniejącym `financeReminders`. Nie odblokowuje Zadań ani Zdrowia. Preview nadal blokuje zapisy niezależnie od flagi.
- Zadania zachowują odrębny `FAMILY_TASKS_WRITES_ENABLED`, transakcje, deduplikację przyznawania/wydawania punktów i usuwanie dowodów zdjęciowych.
- Bez przypisania gospodarstwa Finanse pokazują komunikat konfiguracji; ich opcjonalna projekcja nie blokuje dotychczasowego Kalendarza.
- Nie dodano ścieżek plików Finansów w Storage. Reguły Storage są identyczne z bazą `f46f197`; testy potwierdzają odmowę nieistniejących przestrzeni plików Finansów i ochronę zdjęć Zadań.
- Nie zmieniono integracji ani harmonogramów SP4, Fryderyka i Google Calendar. Nie zmieniono logiki Zdrowia.

## Wykonane sprawdzenia

Wszystkie poniższe testy używały Node.js 22. Testy zapisów i przeglądarki korzystały wyłącznie ze świeżych lokalnych emulatorów projektu `demo-nasza-rodzina` i danych syntetycznych.

| Zakres | Wynik |
|---|---|
| `npm run build` — TypeScript i Vite | PASS |
| Model/API/przypomnienia Finansów i polityka/router zapisu | 47/47 PASS |
| Bezpieczeństwo Zadań, zdjęć, powiadomień i kontrakty Functions | 48/48 PASS |
| Modele interfejsu Finansów i Zadań | 14/14 PASS |
| Firestore/Storage: Finanse, ACL dokumentów, zdjęcia nagród | 16/16 PASS |
| Firestore/Storage: izolacja Zadań i dowodów zdjęciowych | 10/10 PASS |
| Rzeczywiste transakcje Zadań i operacje Storage w emulatorach | 6/6 PASS |
| Chromium: 4 ścieżki Finansów i formularz nagrody | 5/5 PASS |
| Zgodność wygenerowanych `functions/server/` ze źródłem | 47 modułów PASS |

Rzeczywiste transakcje obejmowały tworzenie zadania, zgłoszenie, odrzucenie do poprawy, akceptację przez dwoje rodziców, jednokrotne naliczenie punktów, odrzucenie i akceptację nagrody, ochronę salda przed równoległym wydaniem oraz fizyczne usunięcie zdjęcia po akceptacji.

Chromium obejmował tworzenie/edycję/opłacenie rachunku, okresy cykliczne, pięć szerokości ekranu, udostępnienie pojedynczej opłaty dziecku, odmowę dostępu do innych opłat, brak odczytu `__legacy__` i zachowanie Kalendarza. API w tych testach było lokalnym transportem rzeczywistego serwisu do emulatorów; testy nie potwierdzają konfiguracji produkcyjnego endpointu.

Pierwsze uruchomienie dwóch plików reguł bez izolacji procesów spowodowało konflikt ich globalnych fixture'ów: 8 niepowodzeń. Każdy plik uruchomiony następnie osobno przeszedł w całości; nie zmieniano reguł w celu obejścia testów. Pełnego zestawu aplikacji ani WebKit nie uruchamiano. Vite ostrzega o dużym istniejącym bundlu.

Odczytowe sprawdzenie produkcji: strona HTTP 200, oba endpointy API zwracają 405 dla GET i 401 dla operacji `state` bez uwierzytelnienia. To potwierdza dostępność i ochronę wejścia, **nie** działanie zapisu po zalogowaniu. Nie wykonano zapisów produkcyjnych.

## Pozostałe warunki produkcji

1. Brak rzeczywistego dowodu kompletnej aktualnej kopii i udanego odtworzenia. Właściciel potwierdził, że kopii nie ma lub nie zna jej lokalizacji.
2. Brak odczytu produkcyjnych przypisań UID/gospodarstwa i własności istniejących zadań, rachunków, sald i plików. Nie wolno przypisać ich po samym imieniu ani przez `__legacy__`.
3. Brak potwierdzenia wdrożonych reguł, zgodności różnic tego wydania oraz uprawnień wykonawczych do operacji Storage.
4. Brak potwierdzenia próby wycofania konkretnego wydania oraz drugiej kopii i oddzielnego przechowywania klucza.

Autoryzacja w Cloud Shell właściciela nie jest autoryzacją środowiska Codexa. Nie należy przekazywać tokenów ani kluczy do rozmowy. Nie włączono żadnej flagi Vercel/Functions.

## Jedna czynność właściciela na teraz

Uruchom jedno polecenie z [instrukcji kontroli w Cloud Shell](https://github.com/noe007-Kg/-nasza-rodzina-web/blob/4d74e23c4f001daa47de780ba70146f9f2e951bd/docs/TASKS_RELEASE_CLOUD_SHELL.md). Komenda sprawdza środowisko, pobiera przypięte narzędzie, tworzy prywatną zaszyfrowaną kopię i podejmuje rzeczywistą próbę odtworzenia w emulatorach. Testy samego narzędzia i launchera: 21/21 PASS.

Przekaż tylko końcowe podsumowanie z terminala. Archiwum i klucz zachowaj oddzielnie, poza tymczasowym `/tmp`, oraz przygotuj drugą kopię. Narzędzie porównuje reguły wydania Zadań `f46f197`; dla wspólnego wydania Finansów trzeba następnie ocenić dodatkową, ograniczoną zmianę sekcji `financeBills`. Raport nie stanowi automatycznej zgody na publikację ani obejścia pozostałych warunków.

## Plan publikacji i wycofania po spełnieniu warunków

Zachować aktualny deployment Vercel i rzeczywiste wersje wdrożonych reguł. Obie flagi utrzymać wyłączone podczas przygotowania zgodnej publikacji. Osobno zatwierdzić dokładny zakres ewentualnego uzupełnienia brakujących przypisań; nie uruchamiać masowej migracji. Opublikować przetestowane reguły/indeksy i tylko potrzebne funkcje tego wydania, następnie przygotowaną wersję aplikacji. Dopiero po weryfikacji dostępu właściwych kont włączyć niezależnie wymagane flagi.

W razie problemu natychmiast wyłączyć odpowiednią flagę API i odpowiadającą jej konserwację Functions. Wycofanie aplikacji nie wyłącza samodzielnie harmonogramu Functions. Nie przywracać reguł `__legacy__` ani starych nieizolowanych zapisów. Odtworzenie danych wymaga osobnej, przetestowanej procedury i zgody; nie uruchamiać automatycznie restore na produkcji.
