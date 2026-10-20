# Plan szkoły muzycznej i publiczne komunikaty PSM

## Co przygotowano

To **nie jest połączenie z dziennikiem Fryderyk**. Nie pobieramy loginu, hasła,
sesji ani danych aplikacji mobilnej. SP4/eduVULCAN i ich harmonogramy pozostają bez zmian.

Rodzic potwierdza w Szkoła → właściwy profil ucznia → Fryderyk pięć godzin
przekazanych na zrzutach oraz okres obowiązywania. Domyślny zakres formularza
19.10.2026–30.06.2027 jest propozycją do zatwierdzenia, a nie terminem
potwierdzonym przez szkołę. Dni bez zajęć należy wpisać w formularzu.
Szablon nie jest automatycznie przypisywany po imieniu ani zapisywany na produkcji.
Wybrany rzeczywisty identyfikator profilu musi należeć do gospodarstwa rodzica.

Pięć zajęć: poniedziałek 16:40–17:25 i 17:30–18:15, wtorek 15:00–15:30,
środa 15:50–16:35, czwartek 13:15–13:45. Każde wystąpienie ma stabilny ID.
Ręczne zmiany i wyłączenia dni zachowują pierwszeństwo przed automatyką.

## Źródła i ograniczenia

- Plan przedmiotów teoretycznych: https://www.gov.pl/web/psmkolobrzeg/plan-lekcji
- Komunikaty: https://www.gov.pl/web/psmkolobrzeg/nieobecnosci-nauczycieli
- Zweryfikowany 20.10.2026 komunikat: https://www.gov.pl/web/psmkolobrzeg/pani-agnieszka-sokolnicka
  (jednoznaczne odwołanie zajęć 19–22.10.2026).

Parser uznaje wyłącznie dokładnie rozpoznane komunikaty o odwołaniu,
z pełnym rokiem, zakresem dat i zgodnym nauczycielem. Obsługiwane są komunikaty
Agnieszki Sokolnickiej i Anny Leszczyńskiej; nieznany format dotyczący tych osób
oznacza ręczną weryfikację. Nie wnioskujemy z samych ikon, nieobecności, pustej
odpowiedzi ani błędu sieci. Inne formaty dat wymagają rozszerzenia parsera i testów.
Publiczna strona może nie zawierać wszystkich informacji dziennika (np. zastępstw,
zmian sal i przełożeń). Nie zapewniamy wykrycia informacji opublikowanej wyłącznie
w Fryderyku. Przełożenie można zapisać ręcznie, zachowując identyfikator zajęć.

Usunięcie komunikatu ze strony nie przywraca automatycznie odwołanych lekcji.
Przywrócenie wymaga decyzji rodzica. Błąd zachowuje poprzednie dane i datę
ostatniej udanej kontroli. „Zaplanowane — brak informacji o odwołaniu” nie oznacza
potwierdzenia, że lekcja na pewno się odbędzie. Harmonogram nie zakłada ferii
ani dni wolnych, których rodzic nie potwierdził.

## Architektura i prywatność

Nowa kolekcja `musicSchoolPlans` jest dostępna tylko przez Firebase Admin.
Istniejący końcowy zakaz Firestore Rules odrzuca każdy bezpośredni odczyt/zapis klienta.
Nie trzeba publikować nowych Rules, indeksów ani Storage Rules. Nie zapisujemy plików.
API działa w istniejącym `/api/family/music-school` — bez dodatkowej funkcji Vercel.
Wymaga świeżej tożsamości Firebase, roli rodzica/dziecka i konkretnego `familyId`.
Brak `familyId` i `__legacy__` są odrzucane. Oboje rodzice tej samej rodziny widzą
plan; dziecko wyłącznie swój. Tylko rodzic może zmieniać plan lub uruchamiać kontrolę.
Archiwizacja, wyłączenie szkoły lub zmiana gospodarstwa blokują dalszy dostęp.
Nie należy obchodzić tego warunku ani wykonywać migracji 236 zmian w ramach wdrożenia.

Kalendarz osobisty, rodzinny i Start projektują wystąpienia z tego samego planu.
Nie tworzymy kopii `calendarEvents` ani zmian w `schoolItems` i nie dotykamy sesji.
Widoczny interfejs odświeża podgląd co 5 minut i po powrocie do aplikacji.
Bez otwartej aplikacji kontrole wykonuje nowa Gen2 Function `musicSchoolPublicHourly`
w `europe-west1`, Node.js 22, `0 8-18 * * *`, `Europe/Warsaw`.
Zadanie wywołuje się codziennie, ale **nie wysyła zapytań HTTP w dni bez zajęć**.
Uwzględnia wyłączenia i zajęcia przesunięte ręcznie na inny dzień.
Maksymalnie 11 kontroli/dzień zajęć; przy obecnym planie zwykle 44/tydzień.
Jedna kontrola to indeks i maksymalnie 20 artykułów, tylko GET do `www.gov.pl`.
Nie podążamy za przekierowaniami. Limit rozmiaru to 2 MB/stronę i 40 sekund łącznie.
Jedno pobranie komunikatów jest współdzielone przez plany podczas przebiegu zadania.
Atomowy lease chroni wspólnie kontrolę ręczną i automatyczną. Slot godzinowy
deduplikuje opóźnione wywołania; ręczna kontrola ma ograniczenie do jednej na 5 minut.
Job ma zerową liczbę ponowień; przejściowy błąd jest ponawiany przy kolejnym terminie
lub świadomie przyciskiem rodzica. Logujemy wyłącznie liczniki, bez UID i treści.

## Uruchomienie przez uprawnionego administratora

1. Sprawdzić Preview i testy. Potwierdzić prawdziwe `familyId` oraz `schoolEnabled: true`
   profilu ucznia. Jeśli brakuje gospodarstwa, rozwiązać to odrębnie zatwierdzonym
   procesem — nie stosować `__legacy__`. Nie trzeba znać żadnego hasła Fryderyka.
2. W autoryzowanym środowisku wdrożyć **wyłącznie nową funkcję** z tej gałęzi:
   `./node_modules/.bin/firebase deploy --project nasza-rodzina --only functions:nasza-rodzina:musicSchoolPublicHourly`
   Konfiguracja parametru `MUSIC_SCHOOL_ENABLED` powinna wynosić `true` dla tej funkcji
   (domyślnie `false`; Firebase obsługuje lokalny, ignorowany plik
   `functions/.env.nasza-rodzina`). Nie zmieniać innych parametrów ani sekretów.
   Potrzebny jest istniejący Blaze, Scheduler i uprawnienia runtime do Firestore;
   nie są potrzebne nowe sekrety ani dostęp do Storage.
3. Ustawić **wyłącznie** `MUSIC_SCHOOL_ENABLED=true` w Vercel Production i wdrożyć
   zatwierdzony frontend/API. Nie włączać `FAMILY_V2_WRITES_ENABLED`, Zadań lub Finansów
   w ramach tej zmiany. Preview pozostaje tylko do odczytu również po ustawieniu flagi.
4. Rodzic wybiera właściwy rzeczywisty profil ucznia, zatwierdza okres/godziny/dni wolne
   i zapisuje plan. Następuje pierwsza kontrola publicznych komunikatów; później działa
   przycisk ręczny i harmonogram. Sprawdzić ten sam stabilny wpis w jego kalendarzu
   i kalendarzu rodzinnym oraz datę sukcesu po uruchomieniu zadania.

Bez dostępu administratora do Firebase nie można potwierdzić wdrożenia joba,
produkcyjnego `familyId`, zapisu planu ani rzeczywistego automatycznego uruchomienia.
Nie należy przedstawiać Preview jako aktywnej produkcyjnej synchronizacji.

## Koszty i rollback

Niewielkie koszty istniejącego Blaze: dodatkowy job Cloud Scheduler (ewentualnie
w ramach bezpłatnej puli), wywołania Functions, odczyty/zapisy Firestore i ruch sieciowy.
Brak plików i nowych płatnych usług zewnętrznych. Nie gwarantujemy kosztu zerowego.

Rollback: wyłączyć `MUSIC_SCHOOL_ENABLED` osobno dla nowej funkcji i Vercel,
następnie przywrócić poprzedni frontend/API. Nie usuwać planów ani kalendarzy.
Oryginalne dane SP4 i innych modułów nie są modyfikowane. Samo wyłączenie flagi
zatrzymuje zapisy/kontrole, ale zachowuje odczyt ostatniego planu; przywrócenie starego
frontendu ukrywa nową projekcję bez utraty zapisanych danych.

## Weryfikacja lokalna 20.10.2026 (Node.js 22.23.3)

- TypeScript (`tsc -b`): PASS.
- Build Vite: PASS; istniejące ostrzeżenie o dużym pakiecie JavaScript.
- Testy API/bezpieczeństwa i szkoły muzycznej: 32/32.
- Projekcje kalendarza i oś czasu: 33/33.
- Statusy rodzinne + projekcja muzyczna: 13/13 (3 testy wspólne z poprzednią grupą).
- Kontrakty Functions i regresja harmonogramu SP4: 35/35.
- Zgodność wygenerowanego `functions/server/`: PASS (49 modułów).
- E2E przeglądarkowe oraz wdrożone reguły/IAM: nie sprawdzono w tej sesji.
  Zaktualizowano istniejące scenariusze widoku muzycznego, bez deklarowania ich wykonania.
- Nie zapisano danych produkcyjnych, nie wdrożono Functions ani Rules.

### Skrócone wdrożenie wyłącznie nowego joba

Po potwierdzonym zapisie siedmiu pól profili:

```bash
node scripts/deploy-music-school-job.mjs "$HOME/.nr-school-profiles-NAZWA_Z_PODSUMOWANIA" --project nasza-rodzina
```

Polecenie **wykonuje wdrożenie produkcyjne nowej funkcji**, nie jest dry-run. Wymaga Node 22, lokalnych zależności i autoryzowanego Firebase CLI/ADC. Sprawdza powiązanie prywatnych dowodów kopii, emulatora i zastosowania planu, aktualne pola/role/Auth oraz niezmienione reguły. Ustawia tylko `MUSIC_SCHOOL_ENABLED=true` w lokalnym pliku parametrów na czas wdrożenia; pozostałe parametry zachowuje. Przywraca poprzedni plik po zakończeniu, o ile nie zmienił go równolegle inny proces. Przerwanie całej sesji może pozostawić lokalny plik: nie publikować `.env` ani jego treści.

Firebase CLI otrzymuje dokładnie `--only functions:nasza-rodzina:musicSchoolPublicHourly`. Nie wdraża reguł ani innych funkcji i nie zapisuje profili czy planu. Wynik sukcesu potwierdza wdrożenie przez CLI, a nie pierwsze uruchomienie harmonogramu. Bez zapisanego planu job nie ma lekcji do sprawdzania. Vercel/frontend i flagę Production trzeba uruchomić osobno na aktualnym, przejrzanym commicie produkcyjnym; nie promować starej gałęzi, jeśli produkcja ma nowsze zmiany.
