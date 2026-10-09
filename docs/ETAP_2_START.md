# Etap 2 — trzy kafelki Startu i nagłówek telefonu

Baza: etap 1 na gałęzi `work/family-evolution-1f75aa2`; działający commit `1f75aa2` pozostaje dostępny.

## Zakres

Zmiany wizualne dotyczą tylko kafelków Rodzinny czas, Zakupy i Czat oraz nagłówka telefonu. Kalendarz, Zadania, Zdrowie i Szkoła korzystają z poprzedniej zawartości i stylów. Siedem identyfikatorów kafelków, nawigacja, sensory long press 550 ms / 8 px, DragOverlay i zapis kolejności dopiero po drop pozostają bez zmian.

Na telefonie pionowo oraz poziomo nagłówek ma 44 px: istniejące logo, powitanie, temperatura, ikona pogody i wiatr. Desktop i tablet zachowują dotychczasowy większy baner oraz dotychczasowe źródło Open-Meteo.

## Rzeczywiste dane

### Rodzinny czas

Kafelek pobiera aktywne profile z istniejącego rejestru, bez limitu pięciu osób. Nie tworzy kont ani profili. Pokazuje istniejące zdjęcia/emoji, znane godziny zakończenia i odliczanie. Profile bez logowania także występują w kafelku; archiwalne i wyłączone są pomijane.

Obliczenia wykorzystują wyłącznie kalendarz i szkołę dostępne aktualnemu użytkownikowi. Nie pobierają prywatnych kalendarzy innych osób. Nieznana godzina lub brak planu pozostają nieznane. Etykieta „Wolni według widocznego planu” nie obiecuje znajomości wszystkich prywatnych obowiązków rodziny.

Dokładna data lekcji ma pierwszeństwo przed dniem tygodnia. Istniejący znacznik eduVULCAN „Lekcja odwołana” w pierwszej niepustej linii notatki nie blokuje dostępności. Nie dopisuje się fikcyjnych 45 minut ani brakujących godzin. Połączone wystąpienie kalendarza jest liczone raz.

### Zakupy

Licznik pokazuje dokumenty do kupienia, a postęp faktycznie zaznaczone produkty kupione. Trzy podglądy zawierają zapisane ilości i jednostki. Zdjęcie/emoji pochodzi z istniejącego katalogu szybkich produktów przy jednoznacznym dopasowaniu nazwy; w przeciwnym razie używana jest ikona kategorii. Respektowane są ukryte produkty i dostęp do wizualizacji `adultOnly`.

Projekt nie ma danych magazynowych. „Do kupienia” jest faktycznym statusem listy, natomiast „Brak” i „Prawie brak” nie są wyliczane z ilości zamawianej. Nie wprowadzono magazynu produktów.

### Czat

Wyświetlane są trzy ostatnie rozmowy z istniejących, uprawnionych zapytań rodzinnych i prywatnych. Prywatna rozmowa ma nazwę drugiego uczestnika także wtedy, gdy ostatnia wiadomość została wysłana przez zalogowaną osobę. Podgląd zawiera awatar, treść i faktyczną godzinę wiadomości.

Projekt nie ma potwierdzeń przeczytania wiadomości. Badge jest jednoznacznie opisany jako liczba **nieprzeczytanych powiadomień z czatu**, z dotychczasowego centrum powiadomień. Odczyt powiadomienia nie jest przedstawiany jako potwierdzenie przeczytania rozmowy. Obowiązuje istniejący limit providera: ostatnie 300 powiadomień.

## Bezpieczeństwo i kompatybilność

Brak nowych kolekcji, zapisów danych, Rules, endpointów, sekretów i Environment Variables. Dodano odczyt już istniejącego `quickProducts` w celu ponownego użycia zapisanych zdjęć. Firebase Auth, UID, uprawnienia, backend, eduVULCAN, harmonogramy oraz szyfrowanie pozostają niezmienione względem etapu 1. Nie zmieniono modułów Czat i Zakupy.

## Weryfikacja i podglądy

Weryfikacja odbyła się na Node.js 22.23.3 i lokalnych emulatorach `demo-nasza-rodzina`. Nie odczytywano ani nie zmieniano danych produkcyjnych.

| Kontrola | Wynik |
| --- | --- |
| Build i TypeScript | PASS; dotychczasowe ostrzeżenie o rozmiarze głównego bundla |
| Unit | 99/99 PASS, w tym 20 nowych testów projekcji |
| Server | 250/250 PASS |
| Functions | 49/49 PASS |
| Rules | 26/26 PASS z etapu 1; reguły i testy nie zmieniły się w etapie 2 |
| Integracje emulatorowe eduVULCAN/powiadomień/harmonogramów | 18/18 PASS z etapu 1; backend pozostaje identyczny |
| E2E Chromium i WebKit | Wszystkie 188 unikalnych scenariuszy zweryfikowane po poprawce selektora; szczegóły poniżej |

Pierwsze pełne uruchomienie E2E: 170 PASS, 18 FAIL. Wszystkie 18 niepowodzeń dotyczyło starego helpera logowania, który wyszukiwał równocześnie widoczny i ukryty nagłówek. Naprawiono wyłącznie selektor w `tests/browser.spec.ts`, bez zmiany kodu aplikacji. Następnie cały ten plik uruchomiono ponownie w obu przeglądarkach: **22/22 PASS**. Łącznie pokrywa to 188 różnych scenariuszy: 94 w Chromium i 94 w WebKit; nie jest to opis jednego pełnego uruchomienia z wynikiem 188/188.

Nowe testy sprawdzają 390×844, 844×390, 900×1440, 1024×768 i 1440×900, brak poziomego przewijania strony, wysokość mobilnego nagłówka, zachowanie czterech pozostałych kafelków, dynamiczne profile, prawdziwe ilości zakupów oraz podgląd uprawnionych rozmów. Istniejące testy nadal sprawdzają long press, DragOverlay, brak live sorting i zapis kolejności po drop.

WebKit uruchomiono z istniejącymi bibliotekami systemowymi z `/workspace/browser-deps/root/usr/lib/x86_64-linux-gnu`. Wyłączono jedynie kontrolę instalacji bibliotek Playwright, ponieważ błędnie pomijała bibliotekę dostępną przez `LD_LIBRARY_PATH`; testy przeglądarkowe nie zostały pominięte.

Podglądy z rzeczywistego interfejsu i tych samych danych testowych:

- [Telefon — przed](../preview/stage-2/start-phone-portrait-before.png)
- [Telefon — po](../preview/stage-2/start-phone-portrait-after.png)
- [Tablet poziomo — przed](../preview/stage-2/start-tablet-landscape-before.png)
- [Tablet poziomo — po](../preview/stage-2/start-tablet-landscape-after.png)

Karty zawierające więcej danych zwiększają wysokość swojego rzędu w istniejącym Grid. Na telefonie profile wewnątrz kafelka przewijają się poziomo; strona pozostaje bez poziomego przepełnienia. Nie zmieniano układu innych modułów.

## Rollback

Każdy etap jest osobnym lokalnym commitem. W razie regresji można cofnąć wyłącznie commit etapu 2, zachowując poprawkę uprawnień etapu 1. Żadna migracja danych nie jest potrzebna. Powrót do `1f75aa2` pozostaje możliwy.
