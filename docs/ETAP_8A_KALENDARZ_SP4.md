# Etap 8A — podgląd SP4 w istniejącym kalendarzu

Etap wdrożono wyłącznie do lokalnej gałęzi roboczej i zweryfikowano w Node.js 22.23.3. Nie wykonano push, deploymentu ani zapisu danych produkcyjnych.

## Zakres

- Istniejący `CalendarPage` pokazuje datowane `lesson` i `activity` z `schoolItems`
  o źródle `eduvulcan`, w widokach Dzień, Tydzień i Miesiąc oraz istniejących
  podglądach Dzisiaj/Nadchodzące.
- Wpis otrzymuje lokalne ID `school:sp4:<schoolItems document ID>`, badge SP4
  i szczegóły tylko do odczytu. Nie powstaje dokument `calendarEvents`.
- Rodzic korzysta z istniejącego dozwolonego odczytu `schoolItems`. Dziecko ma
  zapytanie `where('person', '==', ownPerson)` wyznaczone przez `schoolReadAccess`.
  Kalendarz nie subskrybuje `schoolParentMessages` ani `schoolStudentMessages`.
- Zmiana UID, roli lub powiązania ucznia natychmiast ukrywa poprzedni cache i
  szkolne szczegóły. Spóźnione callbacki i błędy starego zakresu są ignorowane.
  Błąd aktualnego odczytu usuwa szkolny podgląd i pokazuje krótki komunikat.
- Prywatne wydarzenia nadal pochodzą z dotychczasowego `subscribeCalendar`:
  `privateCalendarEvents` pozostaje ograniczone do własnego UID. Nie rozszerzono
  prywatności o widoczność dla rodzica ani o profile innych osób.
- Naprawiono odziedziczony wyciek otwartych szczegółów: usunięcie zapisanego
  wydarzenia z aktualnie dozwolonego odczytu natychmiast ukrywa jego modal,
  także po przeniesieniu wydarzenia rodzinnego do prywatnego kalendarza innego
  właściciela. Pojedyncze zapisane wydarzenia odświeżają otwarte szczegóły
  z aktualnego rekordu. Nie przebudowano mechanizmu prezentacji wybranego
  wystąpienia serii; nie deklarujemy pełnego live-update wyjątków powtarzania.
- Dokładna pierwsza niepusta linia statusu `Lekcja odwołana` oznacza ODWOŁANE.
  Wpis pozostaje w kalendarzu. Brak rekordu w nowym snapshotcie nie jest
  automatycznie oznaczany jako odwołanie.
- Projekcja jest pomijana, jeśli jej `calendarEventId` rzeczywiście występuje
  w aktualnie dozwolonych, zapisanych wydarzeniach. Nie deduplikuje się po
  tytule ani godzinie; nieaktualny link nie ukrywa zajęć.

## Granice tego etapu

- Data, początek i koniec muszą rzeczywiście istnieć. Wpisy bez pełnego terminu,
  z błędną datą lub nieistniejącą godziną podczas zmiany czasu są pomijane.
  UI podaje ich liczbę i link do Szkoły. Nie powstaje fikcyjne 45 minut ani seria
  oparta tylko na dniu tygodnia. Daty zajęć interpretuje się w Europe/Warsaw.
  Konwersja pól daty i godzin używa pól UTC oraz zegara Europe/Warsaw, bez
  pośredniej lokalnej daty urządzenia. Luka DST w strefie telefonu nie usuwa
  poprawnego terminu warszawskiego. Powtórzona godzina podczas jesiennej zmiany
  czasu zachowuje dotychczasowy wybór późniejszego momentu.
  Wspólny generator wystąpień otrzymał konieczną, minimalną poprawkę: dla
  `repeat: none` zachowuje dokładny czas trwania pomiędzy zapisanymi start/end,
  zamiast ponownie przepuszczać koniec przez lokalną strefę urządzenia. Chroni
  to koniec poprawnego terminu warszawskiego także przy lokalnej luce DST.
  Gałąź obliczania powtarzalnych serii pozostaje bez zmian.
- Namespace jest stabilny dla tego samego dokumentu `schoolItems`. Obecny
  importer eduVULCAN może zmienić upstream ID przy przesunięciu lekcji; ten etap
  nie deklaruje ciągłości ID, której provider nie udostępnia.
- Szkolne dane nie trafiają do globalnego store, Startu ani Rodzinnego czasu.
  Te moduły zachowują dotychczasowe liczenie i wymagają osobnego etapu, jeśli
  mają używać wspólnego modelu źródeł.
- Ręczne mutacje, prywatność, powtarzanie, import i eksport ICS pracują nadal
  na zapisanych wydarzeniach. Lokalny podgląd SP4 nie jest eksportowany; modal
  importu/eksportu jawnie wyjaśnia to ograniczenie.
- Nie dodano Fryderyka, OAuth ani synchronizacji zewnętrznych kalendarzy.
  Użytkownik potwierdził, że portal Fryderyk nie udostępnia eksportu ICS/iCal.
  Integracja wymaga osobnej analizy rzeczywistego protokołu.
- Nie zmieniono Firestore Rules, Storage Rules, backendu, Functions,
  harmonogramów SP4, kluczy szyfrowania ani danych istniejących kolekcji.
- Nie są wymagane nowe zmienne środowiskowe ani migracja.

## Pliki

Zmienione:

- `src/app-shared.tsx` — opcjonalne metadane lokalnych projekcji.
- `src/calendar-utils.ts` — dokładny koniec pojedynczego wystąpienia bez
  ponownej konwersji przez lokalną strefę urządzenia.
- `src/features/CalendarPage.tsx` — scalenie widoku, badge, read-only szczegóły,
  zabezpieczenie zakresu cache i znikających/prywatyzowanych szczegółów,
  live-update pojedynczego zapisanego wpisu i zachowanie ręcznych operacji.

Nowe:

- `src/calendar-source-projections.ts` — czysta projekcja datowanych zajęć.
- `src/useCalendarSchoolSources.ts` — autoryzowany, ograniczony listener.
- `src/features/calendar-sources.css` — style lokalne badge i komunikatów.
- `tests/calendar-source-projections.test.ts` — jednostkowe testy rzeczywistych
  dat, DST, ID, deduplikacji, anulowania, zakresów i brakujących danych.
- `tests/calendar-school-sources.spec.ts` — scenariusze emulatorowe E2E dla
  Chromium i WebKit, bez kontaktowania providera ani produkcyjnego Firebase.
- `docs/ETAP_8A_KALENDARZ_SP4.md` — zakres i ograniczenia etapu.

## Walidacja po zastosowaniu zmian

- Build/TypeScript: **PASS**.
- Pełne unit na tej wersji: **149/149 PASS**, w tym 17 przypadków projekcji SP4, czasu, DST i deduplikacji.
- Chromium i WebKit: **32/32 PASS** w jednym uruchomieniu lokalnych emulatorów Auth/Firestore/Storage, kod wyjścia 0. Zestaw zawiera 24 nowe scenariusze SP4 oraz 8 istniejących testów ręcznego kalendarza, powtarzania, prywatności i ICS.
- Pięć rozmiarów: 390×844, 844×390, 900×1440, 1024×768 i 1440×900 — brak poziomego przewijania w nowych widokach.
- Przejście rodzic → dziecko, zmiana UID/personKey, aktualizacja i utrata dostępu do otwartych szczegółów: PASS.
- Backend i Rules nie zostały zmienione w tym etapie. Ich wcześniejsze wyniki nie są przedstawiane jako nowe uruchomienie; pełna regresja całego projektu pozostaje osobnym etapem.

Testy używają rzeczywistych lokalnych dokumentów `schoolItems`, kontrolują brak odczytu szkolnych inboxów i brak zapisu podczas podglądu. Zewnętrzne żądania są blokowane; stub eduVULCAN zwraca tylko niepołączony status dla globalnego hooka aktywacji. Nie kontaktowano rzeczywistego portalu ani produkcyjnego Firebase.
