# Szkoła i eduVULCAN

Stan tej paczki: 30 września 2026 r. Rodzina korzysta z **eduVULCAN**. Moduł „Szkoła” działa jako rodzinny organizer szkolny: przechowuje plan lekcji, zadania domowe, sprawdziany, oceny, wiadomości i zajęcia dodatkowe. W tej wersji dane dodaje się ręcznie lub importuje z pliku przygotowanego według szablonu aplikacji.

## Co działa teraz

- Przycisk „Otwórz eduVULCAN” prowadzi do <https://eduvulcan.pl/logowanie> w osobnej karcie. Logowanie do dziennika odbywa się w dzienniku.
- Rodzic może dodawać i edytować wpisy dla wszystkich dzieci oraz importować JSON/CSV. Dziecko widzi własne dane; uzupełnia własne lekcje, zadania, sprawdziany i zajęcia. Oceny i wiadomości uzupełnia rodzic.
- Lekcje i zajęcia można zapisać na konkretny dzień lub jako plan powtarzający się w wybranym dniu tygodnia.
- Zajęcia dodatkowe dodawane lub edytowane przez formularz można połączyć z rodzinnym kalendarzem. Sam import zapisuje wpisy szkolne i nie tworzy wydarzeń kalendarza.
- Dane zapisuje Firebase/Firestore projektu rodziny. Dostęp wymaga konfiguracji opisanej w [FIREBASE.md](FIREBASE.md), zalogowanego konta i przypisanej roli.

**Automatyczna synchronizacja z eduVULCAN nie została zaimplementowana.** Aplikacja nie pobiera danych po wpisaniu hasła, nie przechowuje hasła do dziennika i nie przyjmuje kodu QR parowania. Wiadomości są kopiami/notatkami w organizerze; aplikacja nie wysyła wiadomości do nauczycieli.

## Import CSV albo JSON

Szablony dostępne są w oknie „Importuj plik” i w katalogu `public`:

- [szkola-szablon.csv](../public/szkola-szablon.csv)
- [szkola-szablon.json](../public/szkola-szablon.json)

To **format Naszej Rodziny**, przygotowywany samodzielnie. Nie jest potwierdzonym formatem eksportu eduVULCAN. Przepisz do niego potrzebne informacje z własnego dziennika albo przygotuj plik w arkuszu kalkulacyjnym. Zapisz CSV jako UTF-8; separator może być przecinkiem albo średnikiem.

1. Pobierz szablon i uzupełnij jego wiersze. Przykładowe daty zastąp aktualnymi.
2. Zaloguj się jako rodzic, otwórz „Szkoła”, a następnie „Importuj plik”.
3. Wybierz plik `.csv` lub `.json`. Aplikacja sprawdzi cały plik i pokaże podgląd.
4. Sprawdź osoby, terminy i treść. Dopiero przycisk zatwierdzenia zapisuje dane w Firestore.

CSV wymaga dokładnie takiego nagłówka i kolejności kolumn:

```csv
person,type,title,subject,date,time,endTime,weekday,note
Nikodem,lesson,Matematyka,Matematyka,,08:00,08:45,1,Sala 12
Paweł,grade,5,Matematyka,2026-10-02,,,0,Kartkówka
Layla,message,Zebranie rodziców,,2026-10-05,,,0,Zebranie o 17:00
```

W JSON użyj tablicy obiektów z tymi samymi nazwami pól:

```json
[
  {
    "person": "Nikodem",
    "type": "lesson",
    "title": "Matematyka",
    "subject": "Matematyka",
    "date": "",
    "time": "08:00",
    "endTime": "08:45",
    "weekday": 1,
    "note": "Sala 12"
  }
]
```

| Pole | Zasada |
| --- | --- |
| `person` | `Paweł`, `Nikodem` albo `Layla`; dokładna pisownia |
| `type` | `lesson`, `homework`, `test`, `grade`, `message` albo `activity` |
| `title` | Wymagany tekst, do 160 znaków; dla oceny np. `5` lub `4+` |
| `subject` | Nazwa przedmiotu, do 100 znaków; może być pusta |
| `date` | Data `RRRR-MM-DD`; wymagana dla zadania i sprawdzianu |
| `time`, `endTime` | Godziny `GG:MM`; wymagane dla lekcji i zajęć; zakończenie po rozpoczęciu |
| `weekday` | `0` oznacza brak powtarzania; `1` poniedziałek, …, `7` niedziela; tylko lekcje i zajęcia |
| `note` | Treść/notatka, do 2000 znaków; może być pusta |

Dla lekcji i zajęć podaj **albo** datę i `weekday: 0`, **albo** pustą datę i dzień tygodnia `1–7`. Godziny oznaczają lokalny czas pokazywany przez przeglądarkę; dla planu szkoły ustaw urządzenie na polską strefę czasową. CSV przechowuje teksty z przecinkami, średnikami, cudzysłowami lub nowymi liniami w cudzysłowie zgodnie z zasadami CSV; cudzysłów w wartości zapisuje się podwójnie.

Limit jednego importu to **200 wierszy i 1 MiB**. Nieznane pola, nieznane osoby, błędne daty i godziny powodują odrzucenie całego pliku przed zapisem. Nie dodawaj loginów, haseł, tokenów ani kodów parowania jako dodatkowych kolumn. Oceny i wiadomości są zwykłymi wpisami tekstowymi, bez obliczania oficjalnej średniej lub statusu odczytu w dzienniku.

Import rozpoznaje identyczne importowane wpisy po całej treści i pomija powtórzenia. Nie zastępuje istniejących wpisów. Zmieniony wiersz jest nowym wpisem, a identyczny wpis wcześniej dodany ręcznie może zostać dodany ponownie — po imporcie sprawdź listę.

## Co udało się potwierdzić o integracji

Przejrzano publiczne README i metadane poniższych repozytoriów przez GitHub. Te źródła są informacjami autorów nieoficjalnych projektów, nie dokumentacją producenta eduVULCAN.

| Źródło | Potwierdzony fakt | Znaczenie dla tej aplikacji |
| --- | --- | --- |
| [kapi2289/vulcan-api — README](https://github.com/kapi2289/vulcan-api/blob/master/README.md) | Opisuje nieoficjalny interfejs **UONET+** korzystający z mobilnego API i rejestracji jako urządzenie mobilne. | Samo istnienie tej biblioteki nie potwierdza obsługi konta eduVULCAN rodziny. |
| [kapi2289/vulcan-api — metadane](https://api.github.com/repos/kapi2289/vulcan-api) | Repozytorium nie jest oznaczone jako zarchiwizowane; metadane ostatniego push wskazują 14.01.2025. | Nie daje to dowodu bieżącej zgodności z eduVULCAN ani konkretnej szkoły. |
| [wulkanowy/wulkanowy — README](https://github.com/wulkanowy/wulkanowy/blob/develop/README.md) | Opisuje nieoficjalnego klienta **VULCAN UONET+** z ocenami, planem i wiadomościami. | Funkcji starszego klienta nie można obiecać jako funkcji nowej integracji eduVULCAN. |
| [wulkanowy/sdk — metadane](https://api.github.com/repos/wulkanowy/sdk), [wulkanowy/wulkanowy — metadane](https://api.github.com/repos/wulkanowy/wulkanowy) | Oba sprawdzone repozytoria mają `archived: true`; ostatnie push wskazują czerwiec 2024. | Nie przyjmujemy tych repozytoriów jako dowodu utrzymywanego wsparcia eduVULCAN. |

Potwierdzono stronę eduVULCAN oraz adres logowania. Nie udało się pozyskać i zweryfikować oficjalnej dokumentacji interfejsu **eduVULCAN** dla prywatnej aplikacji rodzinnej. **Nie stwierdzamy na tej podstawie, że takie API nie istnieje.** Nie potwierdzono też oficjalnego eksportu CSV/JSON z konta rodzica, aktualnej obsługi kodu QR przez konkretną bibliotekę ani dostępu do ocen, planu i wiadomości przez ten sam interfejs.

Adresy producenta do sprawdzenia przy dalszych pracach: [eduVULCAN](https://eduvulcan.pl/) oraz [VULCAN](https://www.vulcan.edu.pl/). W tej paczce nie ma fikcyjnych endpointów ani przycisku udającego udaną synchronizację.

## Jak przygotować rzeczywistą synchronizację w przyszłości

Najpierw należy uzyskać od producenta dokumentację lub potwierdzoną metodę dostępu dla **eduVULCAN**, wraz z zakresem danych i warunkami integracji. Kolejny krok to sprawdzenie połączenia tylko do odczytu na rzeczywistym koncie rodzica, z autoryzacją w oficjalnym mechanizmie dostawcy. Nie należy przekazywać danych logowania w rozmowie.

Jeżeli dostęp jest wspierany, integracja powinna działać przez osobny backend. Musi przechowywać niezbędne tokeny poza kodem przeglądarki, pozwalać odłączyć konto, przypisywać dane do właściwego dziecka i pokazywać czas ostatniego udanego pobrania oraz błędy. Połączenia muszą uwzględniać ważność tokenów, ograniczenia zapytań i ewentualne różnice uprawnień kont. Sam serwer z plikami statycznymi lub dopisanie hasła do `.env` frontendu nie tworzy takiej integracji.

Przed włączeniem automatyzacji trzeba potwierdzić osobno oceny, plan lekcji i wiadomości. Jeżeli producent nie udostępnia odpowiedniego sposobu dostępu, ręczny import i odnośnik do dziennika pozostają działającym rozwiązaniem.
