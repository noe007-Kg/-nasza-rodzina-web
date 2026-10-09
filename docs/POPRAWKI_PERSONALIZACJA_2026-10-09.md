# Nasza Rodzina — poprawki i personalizacja, 9 października 2026

Prace dotyczą istniejącej aplikacji na gałęzi `deploy/family-evolution-9be5721`, na podstawie commita `642982b5c35927208827a02df28c06f629e15c0d`. Gałąź została pobrana z repozytorium i nie zastąpiono jej inną gałęzią roboczą. Zachowano obecny design jako domyślny.

## A. Zrealizowane poprawki i pliki

Zakres obejmuje oceny, dwa opisy liczników zakupów, responsywność Rodzinnego czasu, dobrowolne kolory siedmiu kafelków Startu, kompaktowy wybór motywu oraz osobny, niepołączony widok przygotowawczy Fryderyka. Nie przebudowano Startu, pozostałych modułów ani istniejącej architektury danych.

### Zmienione istniejące pliki

| Plik | Zmiana |
|---|---|
| `src/SchoolModule.tsx` | Przełączanie pomiędzy istniejącym SP4 a osobnym przygotowaniem Fryderyka. Wybór źródła odnosi się do aktualnego ucznia; zmiana ucznia przywraca domyślny widok SP4. Istniejący panel SP4 pozostaje zamontowany. |
| `src/school/SchoolGrades.tsx` | Pięć ostatnich ocen, rozwijanie całej posiadanej listy oraz właściwy opis liczby rodzajów oznaczeń. |
| `src/school/SchoolExpandableList.tsx` | Opcjonalne podpisy liczników i przycisków, wykorzystane w ocenach bez zmiany zachowania pozostałych list. |
| `src/school/grade-projections.ts` | Odmiana opisu liczby rodzajów oznaczeń; zachowane obliczenia i oryginalne wartości ocen. |
| `src/features/StartTileDetails.tsx` | Jednoznaczne liczniki „Pozostało” i „Kupione”, również dla pustej lub całkowicie zrealizowanej listy. |
| `src/features/start-dashboard.css` | Karty członków w Rodzinnym czasie zawijają się do dostępnej szerokości; nazwy mogą przejść do kolejnego wiersza. |
| `src/features/StartPage.tsx` | Zastosowanie indywidualnych kolorów do kafelków oraz ich podglądu podczas przeciągania. |
| `src/features/SettingsPage.tsx` | Sekcja „Wygląd”, niewielkie przyciski Jasny/Ciemny, ustawienia kolorów oraz przygotowanie połączenia szkolnego widoczne rodzicowi. |
| `tests/grade-projections.test.ts` | Przypadki liczby rodzajów oznaczeń i zachowania danych ocen. |
| `tests/school-grades.spec.ts` | Rozwijanie ostatnich ocen, podpis statystyk oraz rzeczywiste szczegóły ocen. |
| `tests/start-tile-details.spec.ts` | Jednoznaczne liczniki zakupów oraz dostępność kart dynamicznej rodziny na różnych szerokościach. |

### Nowe pliki projektu

| Plik | Przeznaczenie |
|---|---|
| `src/features/start-tile-colors.ts` | Paleta, walidacja preferencji, bezpieczny lokalny zapis oddzielny dla UID oraz zmienne kolorów. |
| `src/features/useStartTileColors.ts` | Wspólny stan preferencji użytkownika, natychmiastowe aktualizacje i obsługa zmian w innych kartach przeglądarki. |
| `src/features/StartTileColorsSettings.tsx` | Wybór kolorów siedmiu kafelków i przywracanie domyślnych ustawień. |
| `src/features/start-tile-colors.css` | Małe kółeczka, obszary dotykowe i kolory kafelków w obu motywach. |
| `src/features/settings-appearance.css` | Kompaktowy, ograniczony do sekcji wyglądu styl przełącznika motywu. |
| `src/school/SchoolSources.tsx` | Selektor źródeł, pusty widok Fryderyka i przygotowanie w Ustawieniach. |
| `src/school/school-sources.css` | Pastelowe style nowych elementów źródeł szkolnych. |
| `tests/start-tile-colors.test.ts` | Walidacja, zapis per UID, oryginalne kolory, reset i błędy pamięci przeglądarki. |
| `tests/tile-colors.spec.ts` | Personalizacja, rozdzielenie użytkowników, motywy, trwałość, responsywność i kolor przeciąganego kafelka. |
| `tests/fryderyk-preparation.spec.ts` | Osobny niepołączony widok, brak zapytań do portalu, prywatność i responsywność. |
| `docs/FRYDERYK_INTEGRACJA_AUDYT_2026-10-09.md` | Oficjalne źródła, ograniczenia, pytania do dostawcy i plan dalszej integracji. |
| `docs/POPRAWKI_PERSONALIZACJA_2026-10-09.md` | Niniejszy raport. |

Podglądy projektu (fikcyjne dane emulatorów, Chromium) są dostępne w galerii `preview/current-fixes/index.html`. Nowe pliki podglądów:

- `preview/current-fixes/index.html`
- `preview/current-fixes/appearance-phone.png`
- `preview/current-fixes/appearance-tablet.png`
- `preview/current-fixes/grades-phone-portrait.png`
- `preview/current-fixes/grades-tablet-landscape.png`
- `preview/current-fixes/fryderyk-phone.png`
- `preview/current-fixes/fryderyk-tablet.png`

Są podglądami projektu, a nie danymi produkcyjnymi. Raporty wykonania testów, cache, pliki emulatorów, `dist` i `node_modules` nie należą do zestawu zmian źródłowych.

## B. Personalizacja wyglądu

W **Ustawienia → Wygląd → Kolory kafelków** można niezależnie zmieniać Rodzinny czas, Kalendarz, Zadania, Zakupy, Czat, Zdrowie i Szkołę. Pierwszą opcją każdego kafelka jest **Oryginalny**. Pozostałe to pastelowy róż, lawendowy, fioletowy, błękitny, miętowy, jasnozielony, żółty, brzoskwiniowy oraz neutralny jasny.

Widoczna kropka ma 18 px, a jej obszar dotykowy 44 px. Wybrany kolor ma subtelne wyróżnienie. Użyto istniejących ikon modułów. Zmiana działa od razu; jeden kafelek nie zmienia pozostałych. Indywidualny kolor obowiązuje także dla podglądu przeciągania, bez zmiany istniejącego mechanizmu long press, kolejności ani zapisu układu Startu.

**Preferencje kolorów są lokalne i przypisane do Firebase UID.** Zapis wykorzystuje wyłącznie klucz `nr-start-tile-colors:v1:<zakodowany UID>` w `localStorage`. Nie zapisuje profilu użytkownika, hasła, sesji ani danych szkoły. Przechowywane są tylko dozwolone identyfikatory kafelków i palety, nigdy dowolny CSS. Uszkodzony lub nieobsługiwany zapis nie jest stosowany.

Obecne Firestore Rules dopuszczają ściśle określone pola istniejących preferencji. Dodanie zapisu kolorów do Firestore wymagałoby osobnej zmiany kontraktu i reguł. W tym etapie wybrano dopuszczony lokalny wariant, bez zmian backendu i Rules. Ustawienia wprost informują, że kolory nie synchronizują się między urządzeniami. Zmiana zalogowanego UID wybiera oddzielne preferencje; zmiany z innej karty tej samej przeglądarki są odświeżane również po ponownym wejściu do Startu lub Ustawień.

Jeżeli przeglądarka odmówi zapisu, wybór działa w pamięci bieżącej strony, a użytkownik widzi komunikat, że nie przetrwa jej zamknięcia. Nie przedstawiamy takiej zmiany jako zapisanej na stałe.

**Przywróć domyślne kolory** usuwa wyłącznie ustawienia kolorów bieżącego UID. Nie zmienia motywu, kolejności kafelków, ważnych informacji ani innych preferencji. Oryginalny kolor nie dodaje nadpisania stylu, dzięki czemu osoby bez własnego wyboru zachowują dotychczasowy wygląd. Własna paleta ma osobne, czytelne odpowiedniki w jasnym i ciemnym motywie.

Wybór **Jasny / Ciemny** zajmuje szerokość dopasowaną do podpisów. Przyciski mają zaokrąglone rogi, niewielki odstęp, delikatną obwódkę aktywnego wyboru i poprawny stan `aria-pressed`. Zachowano istniejący mechanizm zmiany oraz zapisu motywu na urządzeniu.

## C. Szkoła, Oceny i Start

### Oceny

- „Ostatnie oceny” pokazują domyślnie pięć najnowszych wpisów. **Pokaż wszystkie (X)** rozwija dane już dostępne w aplikacji; **Zwiń listę** przywraca pięć wpisów. Przycisk nie pobiera ponownie dziennika.
- W „Rozkładzie oznaczeń” licznik odnosi się do liczby różnych oznaczeń, dlatego otrzymał opis **„X rodzajów oznaczeń”** z odmianą dla 1 i 2–4. Nie zastępuje liczby wszystkich ocen i wyników.
- Wartości `5+`, `+` i pozostałe oznaczenia zachowują znaczenie dostarczone przez eduVULCAN. Nie dodano sztucznej średniej ani porównania z klasą.
- Audyt `server/edu-normalize.mjs` wykazał, że waga pochodzi bezpośrednio z pola `waga` dostawcy. **Rzeczywiście przekazane zero zostaje widoczne**; brakująca lub pusta waga nie jest zastępowana zerem i nie tworzy wiersza. Nie zmieniano normalizacji backendu.
- Widok szczegółów pokazuje dane udostępnione w istniejących wpisach: przedmiot, oznaczenie, datę, nauczyciela, rodzaj oraz opis/komentarz. Nie uzupełnia braków fikcyjnymi informacjami.

Zachowano pastelowe przedmioty, wygląd oznaczeń, układ, przechodzenie do przedmiotu, sortowanie od najnowszych i możliwość przeglądania wszystkich jego ocen.

### Zakupy

Kafelek rozróżnia **„Pozostało: 0 produktów”** i **„Kupione: 1 z 1”**. Pierwsza wartość oznacza produkty jeszcze do kupienia, druga zrealizowaną część istniejącej listy. Zachowano układ kafelka oraz dane listy, bez usuwania produktów i bez zmiany statusów zakupów.

### Rodzinny czas

Małe karty członków tworzą responsywną siatkę i zawijają się do kolejnych wierszy. Dzięki temu ostatnia karta pozostaje dostępna także na tablecie i dla większej rodziny. Nazwy nie są obcinane wielokropkiem, a kolejność członków i pastelowy wygląd pozostają zachowane. Większa liczba osób zwiększa wysokość kafelka zamiast ukrywać profile przy prawej krawędzi. Nie zmieniono obliczania czasu ani danych członków.

## D. Fryderyk

Szczegółowy audyt ze źródłami i 14 konkretnymi pytaniami znajduje się w [FRYDERYK_INTEGRACJA_AUDYT_2026-10-09.md](FRYDERYK_INTEGRACJA_AUDYT_2026-10-09.md).

| Pytanie | Wynik |
|---|---|
| Czy znaleziono oficjalne API? | Nie znaleziono publicznego kontraktu API w zbadanych oficjalnych materiałach. Nie przesądza to o istnieniu prywatnego lub partnerskiego API. |
| Czy możliwy jest eksport ICS? | Nie potwierdzono. Opisane przez producenta XML/PDF służą archiwizacji i nie dowodzą dostępności ICS. |
| Czy udostępniono integrację zewnętrzną? | Nie potwierdzono wspieranego mechanizmu ani warunków jego użycia. |
| Czy połączenie może działać automatycznie? | Dopiero po potwierdzeniu autoryzowanego dostępu, dokumentacji, odnawiania autoryzacji i limitów. Obecny kod nie pobiera danych Fryderyka. |
| Co wdrożono lokalnie teraz? | Osobny, pusty widok Fryderyka ze statusem **„Fryderyk — niepołączono”**, selektor SP4/Fryderyk oraz przygotowanie w Ustawieniach rodzica. |
| Co wymaga dodatkowych informacji? | Autoryzacja, API/ICS, stabilne ID lekcji, dokładne znaczenie oznaczeń, uprawnienia wiadomości, limity, TTL i odnowienie sesji. |
| Czy skontaktować się z producentem? | Tak — z Netro42, ewentualnie za pośrednictwem administratora PSM w Kołobrzegu. W tym etapie nie wysłano wiadomości. |
| Jakie są następne kroki? | Uzyskać dokumentację i zgodę; przetestować osobny adapter tylko do odczytu na danych testowych; następnie potwierdzić dane i zaprojektować kalendarz oraz harmonogram. |

Publiczna instrukcja potwierdza mobilne parowanie QR lub identyfikatorem i hasłem oraz 30-minutowe okno aktywacji. To mechanizm oficjalnej aplikacji, **nie potwierdzony klucz API**. Nie użyto danych aktywacyjnych, nie badano protokołu aplikacji mobilnej i nie proszono o hasła, tokeny ani QR. Nie zgadywano znaczenia kolorów lub ikon zastępstw i odwołań.

Widoki szkół są oddzielne. Fryderyk nie wyświetla ocen, wiadomości ani sesji SP4. Pusty plan, ogłoszenia i nieobecności nie zawierają fikcyjnych wpisów lub liczników. Dziecko nie otrzymuje zakładki wiadomości w przygotowaniu Fryderyka; istniejący zakres szkolny ogranicza je do własnego profilu. Udostępniony selektor źródła jest przygotowaniem interfejsu, a nie potwierdzeniem, że każdy uczeń uczęszcza do szkoły muzycznej. Nie zapisuje nowego przypisania szkoły w Firestore.

Nie powstały formularz sekretów, udawane „Połącz”, działające „Synchronizuj teraz”, endpoint, provider ani scheduler Fryderyka. Widok nie wykonuje automatycznych zapytań do portalu. Zwykły link otwiera portal dopiero po wyborze przez użytkownika.

Po potwierdzeniu dostępu proponowany harmonogram serwerowy to **`0 8-18 * * *`**, **`Europe/Warsaw`**, czyli 11 terminów dziennie. Częstotliwość wymaga akceptacji limitów producenta. Wspólny lease dla synchronizacji ręcznej i harmonogramu, stabilne identyfikatory, baseline, ograniczone ponowienia i odróżnienie błędu od odwołania zajęć mają zapobiegać duplikatom. Przełożenie powinno aktualizować ten sam rekord, a potwierdzone odwołanie zachować oznaczone wydarzenie. **Ten harmonogram i integracja ze wspólnym kalendarzem nie zostały uruchomione.**

## E. Wyniki testów

Testy techniczne wykonywane są z **Node.js 22.23.3**. Zapisy testowe i scenariusze użytkowników korzystają z emulatorów oraz fikcyjnych danych, bez zapisów w produkcyjnym projekcie Firebase.

| Sprawdzenie | Wynik bieżącego etapu |
|---|---|
| TypeScript / `npm run build` | **PASS** — kompilacja TypeScript i build Vite. |
| `npm run test:unit` | **PASS — 205/205** |
| `npm run test:server` | **PASS — 421/421** |
| `npm run test:functions` | **PASS — 76/76** |
| `npm run test:rules` | **PASS — 47/47** |
| Integracje emulatorowe eduVULCAN i kalendarzy / `npm run test:integrations` | **PASS — 28/28** |
| E2E Chromium | **PASS — 173/173** |
| E2E WebKit | **PASS — 173/173** |

Nowe testy obejmują pięć widocznych ostatnich ocen i rozwijanie bez pobrania dziennika, liczby rodzajów oznaczeń, rzeczywistą wagę zero, zakupy zakończone i pustą listę, większą dynamiczną rodzinę, lokalne kolory niezależne dla UID, powrót po ponownym logowaniu, dziewięć palet w obu motywach, reset bez zmiany innych preferencji, odmowę zapisu w pamięci przeglądarki oraz aktualizacje pomiędzy kartami.

Testy przygotowania Fryderyka sprawdzają niepołączony stan, oddzielenie od SP4, własny profil dziecka, brak wiadomości rodzicielskich, przełączanie ucznia i brak automatycznych zapytań do portalu. Wykonane scenariusze przeglądarkowe obejmują rozmiary **390×844, 844×390, 900×1440, 1024×768 i 1440×900**. Pełny przebieg `npm run test:e2e`: **346/346 PASS, 28,7 min, bez ponowień i pominięć**. To testy silników Chromium/WebKit i różnych szerokości widoku; nie wykonywano testów na fizycznym iPhonie ani produkcyjnych danych szkoły.

Build nadal zgłasza istniejące ostrzeżenie Vite o głównym pakiecie JavaScript większym niż 500 kB; nie jest to błąd kompilacji. Projekt nie ma osobnych skryptów lint ani typecheck: kontrolę źródeł TypeScript wykonuje `tsc -b` w `npm run build`.

## F. Bezpieczeństwo produkcji

- `main` nie zostało zmienione; prace pozostają na `deploy/family-evolution-9be5721`.
- Nie wykonano wdrożenia produkcyjnego, migracji ani zmian danych produkcyjnych.
- Nie zmieniono `server/`, `functions/`, reguł Firestore/Storage, konfiguracji Firebase/Vercel, zależności ani plików blokad zależności.
- Nie zmieniono sesji, kluczy szyfrowania, połączenia ani harmonogramów eduVULCAN/SP4. Istniejący panel SP4 zachowuje swoją logikę i stan podczas przełączania źródła w UI.
- Nie zmieniono konfiguracji ani backendu Google Calendar.
- Nie opublikowano nowych Functions ani Rules. Nie są wymagane nowe Environment Variables lub nowe sekrety dla tego etapu.
- Nie otwarto nowych uprawnień do bazy lub Storage. Lokalna personalizacja nie dopisuje pola do Firestore i nie korzysta z dostępu administracyjnego.
- Nie zapisano haseł, tokenów, cookies ani danych aktywacyjnych w kodzie lub logach.

Pozostałe ograniczenia są jawne: kolory nie synchronizują się między urządzeniami, liczniejsza rodzina zwiększa wysokość kafelka Rodzinnego czasu, a Fryderyk pozostaje niepołączony do czasu potwierdzenia sposobu integracji. Ta zmiana nie rozszerza obecnego modelu bezpieczeństwa na nowe rodziny lub nowe kolekcje.

## G. GitHub i Preview

Po pełnym pozytywnym przebiegu testów zmiany są przygotowane do zapisania jako trzy logiczne commity: Oceny, poprawki Startu, personalizacja i przygotowanie Fryderyka. Jedyną gałęzią przeznaczoną do aktualizacji jest `deploy/family-evolution-9be5721`. Stan publikacji, identyfikatory commitów i ewentualny adres Preview podano w końcowej odpowiedzi. Nie wykonano merge do `main` ani samodzielnego uruchomienia wdrożenia produkcyjnego. Automatyczny Vercel Preview zależy od istniejącej konfiguracji repozytorium; raport nie deklaruje wdrożenia produkcyjnego.

Preview może korzystać z produkcyjnego Firebase. Testy zapisujące i usuwające dane należy nadal wykonywać wyłącznie w emulatorach lub na wyraźnie wydzielonych danych testowych. Publikacja produkcyjna wymaga osobnego zatwierdzenia użytkownika.
