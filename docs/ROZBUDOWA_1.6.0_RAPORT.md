# Nasza Rodzina — raport lokalnej rozbudowy v1.6.0

Stan 8 października 2026. Baza: `1f75aa225f54d61cd0a3a09f167f3adb411f07aa`. Gałąź: `work/family-evolution-1f75aa2`. Zmiany wykonano etapami jako lokalne commity. Nie wykonano push, deploymentu, migracji, konfiguracji chmury, zmiany sekretów ani zapisu danych produkcyjnych. Oryginalna paczka audytowana pozostaje odrębna od tej rozbudowy.

**Etap Google Calendar wraz z odświeżaniem przy zamkniętej aplikacji jest przygotowany i przetestowany lokalnie. Cały wieloetapowy plan nie jest jeszcze zakończony: Fryderyk wymaga potwierdzenia protokołu, Outlook OAuth oraz automatyczna synchronizacja ICS/iCloud pozostają kolejnymi etapami.**

## Wyniki końcowe

Wszystkie poniższe sprawdzenia wykonano na Node.js **22.23.3**. Emulatory używały projektu `demo-nasza-rodzina` i syntetycznych danych; E2E nie korzystały z produkcyjnej bazy ani rzeczywistego OAuth Google.

| Sprawdzenie | Wynik |
| --- | --- |
| Instalacja według obu lockfile | PASS; root i `functions/`, zależności i lockfile niezmienione względem bazy |
| `npm run build` / TypeScript | PASS |
| `npm run test:unit` | 189/189 PASS |
| `npm run test:server` | 421/421 PASS |
| `npm run test:functions` | 76/76 PASS |
| `npm run test:rules` | 47/47 PASS |
| `npm run test:integrations` | 28/28 PASS |
| `npm run test:e2e` — Chromium | 152/152 PASS |
| `npm run test:e2e` — WebKit | 152/152 PASS |
| Pełne E2E, jeden przebieg | 304/304 PASS, brak retries |
| Zgodność kopii `functions/server/` | PASS; 32 moduły zgodne z kanonicznym `server/` |

Po pełnej regresji do istniejącego testu responsywności Google dodano wyłącznie opcjonalne wykonanie podglądów. Ten test uruchomiono ponownie w obu przeglądarkach: 2/2 PASS. Nie dodano nowej ścieżki zachowania aplikacji. Brak osobnego skryptu lint; sprawdzenie TypeScript jest częścią builda. Pozostaje istniejące ostrzeżenie Vite o rozmiarze głównego bundla. Użyte zależności deweloperskie wymagają aktualnego wydania Node 22; zweryfikowano 22.23.3, nie każde wcześniejsze 22.x.

Testy responsywności obejmują 390×844, 844×390, 900×1440, 1024×768 i 1440×900. W badanych widokach nie wykryto poziomego przewijania całej strony. WebKit jest testem silnika przeglądarki, nie fizycznego iPhone'a ani systemowej klawiatury iOS.

## Co zmieniono

| Etap | Zmiana | Szczegółowy raport |
| --- | --- | --- |
| 1 — Rodzina | Wąskie zapytania szkolne, czyszczenie starych danych po zmianie zakresu, bezpieczna diagnostyka konkretnego listenera | [ETAP_1_RODZINA.md](ETAP_1_RODZINA.md) |
| 2 — Start | Tylko Rodzinny czas, Zakupy, Czat i kompaktowy nagłówek telefonu | [ETAP_2_START.md](ETAP_2_START.md) |
| 3 — Profile | Dynamiczni członkowie, profile bez loginu, rola dorosłego bez uprawnień rodzica, archiwizacja, chronione zdjęcia, Google avatar i agregator „Cała rodzina” | [ETAP_3_PROFILE.md](ETAP_3_PROFILE.md) |
| 4A — Szkoła | Oceny według przedmiotów, prawdziwe szczegóły/statystyki, 5 wpisów i rozwiń/zwiń | [ETAP_4A_OCENY.md](ETAP_4A_OCENY.md) |
| 4B — Szkoła/backend | Aktywni uczniowie z dynamicznego rejestru i `schoolEnabled`; zgodność starej tożsamości | [ETAP_4B_DYNAMICZNE_PROFILE_SZKOLNE.md](ETAP_4B_DYNAMICZNE_PROFILE_SZKOLNE.md) |
| 5 — eduVULCAN | Odnowienie aktualnego cookie jar po zweryfikowanym odczycie i udanym zabezpieczonym imporcie | [ETAP_5_SESJA_EDUVULCAN.md](ETAP_5_SESJA_EDUVULCAN.md) |
| 8A — Kalendarz | Datujące się lekcje SP4 w głównym kalendarzu, źródło i zachowanie odwołań | [ETAP_8A_KALENDARZ_SP4.md](ETAP_8A_KALENDARZ_SP4.md) |
| 9H — Hobby | Grupowany handler konta, zachowane URL i zabezpieczenia; końcowo 11 plików API | [ETAP_9_ROUTING_HOBBY.md](ETAP_9_ROUTING_HOBBY.md) |
| 9A — Google | OAuth readonly, import/sync, właściciel i prywatność, idempotencja, serie/DST, rozłączanie | [ETAP_9_GOOGLE_CALENDAR.md](ETAP_9_GOOGLE_CALENDAR.md) |
| 9B — Google w tle | Jeden godzinowy Firebase scheduler, wspólny lease i deduplikacja zaufanych slotów | [ETAP_9B_GOOGLE_SCHEDULER.md](ETAP_9B_GOOGLE_SCHEDULER.md) |

Pozostałe kafelki Startu, menu i pastelowy system wizualny zachowano. DnD nadal aktywuje się przez long press około 550 ms, używa overlay, nie sortuje podczas przesuwania i zapisuje kolejność dopiero po drop per UID. Nie dodano fikcyjnych danych szkolnych, twarzy ani zdjęć rodziny.

### Profile i prywatność

`members/{id}` pozostaje rejestrem profili. Dotychczasowe UID nie są zmieniane. Profil bez loginu używa `canLogin=false`; późniejsze aktywowanie konta zachowuje jego identyfikator i odrzuca konflikt istniejącego e-maila. Role to `parent`, `adult` i `child`, a brak loginu jest osobną cechą. Dorosły nie otrzymuje automatycznie administracji ani skrzynki rodziców. Archiwizacja zachowuje konto i historię, wyłącza dostęp i unieważnia refresh tokens.

„Cała rodzina” jest agregatorem kalendarza, bez konta Auth. Zdjęcie/emoji zapisuje backend w `familySettings/profile`. Zdjęcia członków trafiają do chronionego Storage; Firestore nie przechowuje publicznego URL z tokenem pobierania. Własny awatar nie jest nadpisywany przez Google. Dodawanie i zarządzanie członkami pozostaje w Ustawieniach.

**Nie potwierdzono dokładnej przyczyny produkcyjnego `permission-denied` Sebastiana.** Lokalnie znaleziono i poprawiono defekty zakresu/subskrypcji, a testy obu rodziców przeszły. Produkcyjny przypadek wymaga kodu konkretnego listenera i porównania faktycznie opublikowanych reguł oraz profilu. Nie rozszerzano dostępu na próbę.

Projekt nadal obsługuje jedną rodzinę w jednym projekcie Firebase, z kolekcjami globalnymi. Nie deklaruje izolacji wielu tenantów. Nie było migracji dotychczasowych dokumentów; nowe metadane profili i prywatne kolekcje połączeń powstają przy użyciu nowych funkcji.

### Szkoła i sesja SP4

Rodzice nadal korzystają z jednego wspólnego połączenia eduVULCAN. Dziecko nie odczytuje rodzicielskiej skrzynki. Aktywny uczeń jest wyznaczany z profilu i istniejącego powiązania dostawcy; nie zakłada się, że provider jednocześnie zwraca dane wszystkich dzieci.

Limit 24 h jest maksymalną retencją bezczynnej sesji. Nie zwiększono go bezwarunkowo. Tylko potwierdzony odczyt rzeczywistej sekcji i udany guarded import odnawiają lokalną kopertę z aktualnymi cookies; błąd, sam status, rate-limit lub nieudany import jej nie przedłużają. Wcześniejsze rzeczywiste wygaśnięcie u dostawcy wymaga ponownego połączenia. Hasło nie jest przechowywane ani używane do automatycznego logowania.

Nie zmieniono algorytmu/envelope szyfrowania, `EDUVULCAN_ENCRYPTION_KEY_BASE64`, `EDUVULCAN_ENCRYPTION_KEY_ID`, współdzielonego lease ani poprawionej deduplikacji `scheduleTime`. `server/edu-school-slots.mjs` pozostaje identyczny z bazą. Harmonogramy SP4 zachowują:

- `*/10 8-14 * * *`, `Europe/Warsaw`;
- `0 0-7,15-23 * * *`, `Europe/Warsaw`.

Powiadomienia zachowują baseline i deduplikację. `notifyChat` nadal jest `onDocumentCreated('familyMessages/{id}')`; `medicineReminders` działa co 5 minut. Dzwonek/★ pozostają IN-APP; nie włączono Web Push, FCM ani prośby o systemowe uprawnienie. Nie zmieniono service workera, manifestu ani VAPID.

## Google Calendar — przygotowany model

Synchronizacja jest jednostronna: Google → Nasza Rodzina. OAuth jest osobny od logowania Google. Użytkownik jawnie wybiera kalendarz, profil, tryb import/sync oraz `Prywatny` lub `Rodzinny`. Prywatny właściciel to inicjujący Firebase UID, także gdy wpis przypisano do profilu dziecka. Zmiana widoczności pojedynczego wydarzenia przetrwa następny sync.

Zaszyfrowane tokeny pozostają na backendzie. Jednorazowy import po sukcesie nie zachowuje tokenów. Stabilne ID, transakcyjny lease/version, pełne stronicowanie, ograniczenia czasu/rekordów i prawidłowe source DATE/timezone chronią import przed duplikatami i częściowym awansem kursora. Serie Google są rozwijane w oknie 180 dni wstecz / 366 naprzód, a edycja serii pozostaje w Google. Odwołane wpisy pozostają oznaczone; nie opóźniają „Rodzinnego czasu”.

Nowa `googleCalendarHourly` wywołuje tę samą logikę co Vercel. Cron `0 * * * *`, `Europe/Warsaw`, także przy zamkniętej aplikacji. Slot identyfikuje zaufany `scheduleTime` w UTC; opóźnienie uruchomienia i zmiana czasu nie pomijają następnego prawidłowego terminu. Ręczna synchronizacja i frontend aktywacji korzystają ze wspólnego lease oraz backendowego cooldownu.

## Konfiguracja wymagająca przygotowania przed przyszłym deploymentem

Nie wykonano poniższych operacji. Brak konfiguracji nie blokuje normalnego działania istniejących modułów, ale Google Calendar pozostaje nieaktywne.

### Nowe Environment Variables — dokładnie pięć

Wszystkie są server-only, bez prefiksu `VITE_`:

| Nazwa | Vercel Production | Firebase Functions |
| --- | --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | Web OAuth client ID | `defineString`; ta sama wartość |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Sekret tego klienta | Secret Manager; ta sama wartość |
| `CALENDAR_SITE_ORIGIN` | `https://nasza-rodzina-web.vercel.app` | `defineString`; ta sama wartość |
| `CALENDAR_ENCRYPTION_KEY_BASE64` | Osobny klucz AES-256, 32 bajty/base64 | Secret Manager; dokładnie ten sam osobny klucz |
| `CALENDAR_ENCRYPTION_KEY_ID` | Identyfikator osobnego klucza, domyślnie `v1` | `defineString`; ta sama wartość |

Nie generowano klucza. Klucz kalendarzy musi być inny niż eduVULCAN; nie wolno rotować klucza EDU dla tej integracji.

W Google Cloud potrzebne są Google Calendar API, ekran zgody OAuth i webowy klient OAuth ze scope wyłącznie `calendar.readonly`. Callback musi być dokładnie:

`https://nasza-rodzina-web.vercel.app/api/calendars/callback`

W trybie OAuth Testing refresh token może wygasnąć po 7 dniach; dalsze wymagania zależą od trybu publikacji i zasad Google dla scope Calendar. Nie sprawdzono rzeczywistej zgody konta Google, więc nie deklarujemy zakończonego testu integracji produkcyjnej.

Nowe dwa sekrety kalendarzy wymagają `roles/secretmanager.secretAccessor` runtime Functions na każdym z nich. Dostęp do starego sekretu eduVULCAN nie wystarcza. Runtime potrzebuje dotychczasowego Firestore oraz `firebaseauth.users.get`, np. przez `roles/firebaseauth.viewer`, aby odrzucać wyłączone/usunięte konto. Nie nadano żadnych ról ani nie sprawdzono obecnego IAM/chmury w tym etapie.

Blaze: **TAK, dla istniejącej architektury Firebase Functions/Scheduler**. Płatny plan Vercel: **nie jest wymagany przez przygotowany harmonogram**. Nie dodano Vercel Cron. Nowy job może zwiększyć koszty Cloud Scheduler po wykorzystaniu darmowego limitu; dochodzą odczyty/zapisy Firestore, czas wykonywania i ewentualny transfer. Nie gwarantujemy zerowego kosztu.

### Reguły, Functions i routing

- `firestore.rules`: **zmienione lokalnie** — profile/archiwizacja i backend-only pochodzenie Google. Prywatne wydarzenia nadal chroni `ownerUid`; klient nie tworzy ani modyfikuje dowolnie wpisów Google.
- `storage.rules`: **zmienione lokalnie w etapie profili** — chronione awatary. Google nie wymaga nowej zmiany Storage; ograniczenia Zdrowia pozostają.
- Reguły nie są opublikowane. Aktualizacja nowej wersji wymaga osobnego zatwierdzenia również reguł; sam deployment Functions ich nie publikuje.
- `firebase.json`: **bez zmian** — `source: functions`, `codebase: nasza-rodzina`, `runtime: nodejs22`, obecne emulatory i predeploy pozostają.
- Kanoniczny kod Functions nadal pochodzi z `server/`, kopie przygotowuje `scripts/prepare-functions.mjs`.
- Root i Functions lockfile oraz zależności: **bez zmian**.
- Końcowo **14 Cloud Functions**, Gen2, `europe-west1`. Dodana tylko `googleCalendarHourly`. Pozostałe eksporty: `notifyCalendar`, `notifyPrivateCalendar`, `notifyTasks`, `notifyShopping`, `notifyHealth`, `notifySchool`, `notifySchoolParents`, `notifySchoolStudent`, `notifyChat`, `notifySchoolSync`, `eduVulcanSchoolHours`, `eduVulcanOffHours`, `medicineReminders`.
- Końcowo **11 plików API Vercel**. Konto używa `api/account/[action].mjs`, Google `api/calendars/[action].mjs`. Publiczne adresy dawnych operacji konta zachowane; surowa ścieżka i sprzeczne `action` są walidowane przed wyborem handlera.

Przy ręcznym zastąpieniu plików repo należy usunąć stare `api/account/members.mjs` i `api/account/google-login.mjs`, a także `api/account/profile.mjs`, jeżeli został dodany w etapie pośrednim. Samo nadpisanie plików ZIP bez usunięcia starych handlerów nie odwzoruje projektu. Manifest zmian względem `1f75aa2` wskazuje dwa usunięcia; trzeci plik nie istniał jeszcze w tej bazie.

## Fryderyk oraz kolejne źródła

[Audyt Fryderyka](FRYDERYK_AUDYT_DOSTEPU.md) potwierdza portal `https://psmkolobrzeg.fryderyk.edu.pl`, brak widocznego ICS i obecność dostępu mobilnego. Publiczny anonimowy GET zwrócił 403 Cloudflare; blokady nie obchodzono. Oficjalna instrukcja opisuje 30-minutowe parowanie aplikacji, ale nie dokumentuje API planu, statusów odwołań ani TTL odnowionej sesji.

**Adapter, połączenie i scheduler Fryderyka nie są zaimplementowane.** Nie ma fikcyjnego statusu „Połączono” ani planu. Następny etap wymaga dokumentacji wspieranego protokołu lub bezpiecznej uprawnionej weryfikacji oficjalnego klienta. Po potwierdzeniu danych: niezależny adapter/lease/baseline, plan najpierw w Szkole, potem w kalendarzu, cron `0 8-18 * * *`, `Europe/Warsaw`. Nie potrzeba przesyłać hasła, QR lub surowego HAR do czatu.

Outlook OAuth/Microsoft Graph oraz automatyczne ICS/iCloud nie są jeszcze zaimplementowane. Istniejący jednorazowy import/eksport ICS pozostaje, bez udawania okresowej synchronizacji. Dalsza rozbudowa wymaga audytu modelu ICS/recurrence i OAuth przed dodaniem kolejnych providerów. Nie wykonano zapisów do zewnętrznych kalendarzy.

## Podglądy

Zrzuty przedstawiają wyłącznie dane testowe. Zachowano wcześniejsze podglądy projektu i prawdziwe porównania przed/po; nie kopiowano całego dashboardu z referencji.

- Start: [telefon przed](../preview/stage-2/start-phone-portrait-before.png), [telefon po](../preview/stage-2/start-phone-portrait-after.png), [tablet przed](../preview/stage-2/start-tablet-landscape-before.png), [tablet po](../preview/stage-2/start-tablet-landscape-after.png).
- Profile: [telefon przed](../preview/stage-3/family-settings-phone-portrait-before.png), [telefon po](../preview/stage-3/family-settings-phone-portrait-after.png), [tablet przed](../preview/stage-3/family-settings-tablet-landscape-before.png), [tablet po](../preview/stage-3/family-settings-tablet-landscape-after.png).
- Oceny: [telefon przed](../preview/stage-4/grades-phone-portrait-before.png), [telefon po](../preview/stage-4/grades-phone-portrait-after.png), [tablet przed](../preview/stage-4/grades-tablet-landscape-before.png), [tablet po](../preview/stage-4/grades-tablet-landscape-after.png).
- Szkoła: [telefon przed](../preview/stage-4/school-phone-portrait-before.png), [telefon po](../preview/stage-4/school-phone-portrait-after.png), [tablet przed](../preview/stage-4/school-tablet-landscape-before.png), [tablet po](../preview/stage-4/school-tablet-landscape-after.png).
- Google Calendar: [telefon](../preview/stage-9/google-calendar-settings-phone-portrait.png), [tablet poziomo](../preview/stage-9/google-calendar-settings-tablet-landscape.png). Nowa sekcja nie miała odpowiednika przed zmianą; nie pokazano fikcyjnego ekranu „przed”.

## Pliki i rollback

Pełna lista dodanych, zmienionych i usuniętych plików względem `1f75aa2` znajduje się w [ZMIENIONE_PLIKI_1.6.0.tsv](ZMIENIONE_PLIKI_1.6.0.tsv). Prefiksy: `A` nowy, `M` zmieniony, `D` usunięty. Generowane `functions/server/` są poza Git; pełna paczka zawiera ich zweryfikowane kopie i manifest pochodzenia. ZIP zawiera również `.env.example`, `preview/`, testy, dokumentację i konfigurację, ale nie zawiera prawdziwych `.env`, node_modules, dist, .git, kluczy ani raportów/cache testowych.

Baza i logiczne commity pozostają lokalnie. Bezpieczna możliwość otwarcia starego kodu bez usuwania bieżącej pracy:

```sh
git switch -c rollback/rodzina-1f75aa2 1f75aa2
```

Nie wykonano tego polecenia ani produkcyjnego rollbacku. Po przyszłym użyciu nowych profili, awatarów lub importu nie należy usuwać ich dokumentów, kont ani historii w ramach cofania UI. Cofnięcie publikowanych reguł wymaga osobnego audytu, aby nie otworzyć nowych danych i nie utracić ich ochrony. Nie uruchamiać bootstrapu/migracji ani nie resetować Firestore.

**Gotowość lokalnej regresji: PASS. Gotowość nowej integracji Google do deploymentu: wymaga opisanej konfiguracji chmurowej i osobnej zgody. Cały plan rozbudowy: w toku.**
