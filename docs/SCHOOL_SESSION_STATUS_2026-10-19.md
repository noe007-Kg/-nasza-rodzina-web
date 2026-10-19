# SP4 i Fryderyk — 19.10.2026

## SP4: co jest potwierdzone

Aktywny frontend Vercel nadal wskazuje commit `1c9dee87d283628861f3b49488f61f313bc85f89`. Ten kod zawiera już poprawkę `4e934bc`: udane uwierzytelnione pobranie i import szkolny przesuwa lokalną retencję sesji na maksymalnie 24 godziny od potwierdzenia odczytu. Odnowione cookies są szyfrowane istniejącym kluczem. Sam odczyt statusu nie odnawia terminu. Nieudany import ani rzeczywiste wygaśnięcie u dostawcy nie mogą go przedłużyć.

Istnieją już dwa harmonogramy w `Europe/Warsaw`:

- `eduVulcanSchoolHours`: `*/10 8-14 * * *`;
- `eduVulcanOffHours`: `0 0-7,15-23 * * *`.

Nie ma potrzeby tworzyć trzeciej Function uruchamianej co 23 godziny. Obecne harmonogramy są częstsze. Cron `0 */23 * * *` nie oznacza równych odstępów 23 godzin i nie został dodany.

Nowy test uruchamia istniejący scheduler przez prawdziwą logikę `syncAction` z atrapą portalu i bazy. Udane odczyty po 23, 46 i 69 godzinach utrzymują tę samą wersję połączenia, odnawiają termin, zwalniają lease i nie duplikują importowanego wpisu. Test nie potwierdza rzeczywistej ważności cookies na portalu.

**Nie ustalono jeszcze przyczyny wygaśnięcia na produkcji.** Frontend Vercel nie jest dowodem wersji kodu wdrożonego w Firebase Functions. Możliwe przyczyny wymagające rozróżnienia: stara wersja dwóch Functions, niewykonywanie/wyłączenie zadań Scheduler, nieudane synchronizacje, problem sekretu/IAM albo rzeczywiste wygaśnięcie sesji eduVULCAN. Nie zmieniono TTL, szyfrowania, klucza ani samych harmonogramów.

## Jedna kontrola we własnym Cloud Shell

Poniższe polecenie pobiera przypiętą sumą SHA-256 wersję kontroli. Nie wymaga instalacji npm ani pobierania projektu. Potrzebuje istniejącej autoryzacji ADC, `gcloud`, `curl`, `sha256sum` i Node z wbudowanym `fetch` (18+).

```bash
(umask 077; NR_CHECK="$(mktemp /tmp/nr-school.XXXXXXXX.mjs)" && curl -fsSL https://raw.githubusercontent.com/noe007-Kg/-nasza-rodzina-web/feature/school-session-check-20261019/scripts/check-school-session.mjs -o "$NR_CHECK" && printf '%s  %s\n' 209c11c5cc80b8e23f51acc6b9f569ae96d679b74023f27e15f604cfd82061fa "$NR_CHECK" | sha256sum -c - && node "$NR_CHECK")
```

W istniejącym checkoutcie tej gałęzi można zamiast tego użyć `npm run school:check`.

Kontrola wykonuje pięć ograniczonych GET: metadane wspólnego połączenia w Firestore, konfiguracja dwóch Functions oraz ich dwa standardowo nazwane zadania Scheduler w `europe-west1`. Maska Firestore nie obejmuje zaszyfrowanej sesji, cookies, danych ucznia ani UID. Maska Functions nie obejmuje wartości zmiennych środowiskowych. Sprawdzane jest tylko powiązanie nazwy istniejącego sekretu — bez dostępu do jego wartości. Token ADC jest używany wyłącznie w nagłówku autoryzacji i nigdy nie jest wypisywany.

Raport zawiera tylko bezpieczne daty, stany, publiczne nazwy zadań i kody błędów. Można przekazać to podsumowanie do analizy; nie należy przekazywać plików poświadczeń ani tokenów.

- `LOCAL_SESSION_EXPIRED`: zapisany lokalny termin już minął.
- `NO_SUCCESSFUL_SYNC_WITHIN_23_HOURS`: od co najmniej 23 godzin brak udanej synchronizacji.
- `SYNC_OVERDUE_FOR_EXISTING_SCHEDULE`: od ostatniego sukcesu minęło ponad 75 minut.
- `AUTHORIZED_SESSION_RENEWAL_NOT_VERIFIED`: brak zapisanego potwierdzenia odnowienia.
- `SCHEDULE_NOT_VERIFIED`: zadanie nie jest aktywne albo cron/strefa nie odpowiadają źródłu.
- `READ_PERMISSION_DENIED` / `RESOURCE_NOT_FOUND`: brak weryfikacji, nie dowód wyłączonego lub nieistniejącego zasobu w całej chmurze.
- `DEPLOYED_RENEWAL_SOURCE_NOT_VERIFIED`: metadane nie dowodzą, jaka implementacja znajduje się w uruchomionej paczce Functions. To jawne ograniczenie kontroli, nie błąd wymagający kolejnych automatycznych prób.

Kod zakończenia `2` oznacza wynik wymagający interpretacji, a nie polecenie ponownego logowania lub wdrażania wszystkiego. Narzędzie nie synchronizuje, nie loguje się do dziennika, nie ustawia IAM, nie włącza API i niczego nie publikuje. Nie modyfikuje zapisanej sesji ani danych produkcyjnych.

Po ustaleniu przyczyny można przygotować aktualizację wyłącznie dwóch istniejących harmonogramów/Functions, jeśli rzeczywiście są stare. Nie należy wdrażać całego codebase ani modułów Zadań/Finansów na podstawie tego raportu. Jeśli sesję faktycznie unieważnił dostawca, potrzebne będzie ponowne połączenie przez formularz w aplikacji. Nie ma gwarantowanego sposobu odnowienia dowolnej unieważnionej sesji samym wcześniejszym GET.

## Fryderyk: rzeczywisty wynik

19.10.2026 pojedynczy zwykły anonimowy GET `https://psmkolobrzeg.fryderyk.edu.pl/` zwrócił **HTTP 403**, tytuł `Attention Required! | Cloudflare`, bez formularza hasła. Nie wykonywano prób logowania, obchodzenia blokady, CAPTCHA/MFA ani mobilnego parowania. Nie ma rzeczywistego połączenia ani pobranego planu.

Ponownie przejrzano [funkcje producenta](https://www.fryderyk.edu.pl/funkcje-fryderyka.html) i [oficjalną instrukcję aplikacji mobilnej](https://www.gov.pl/attachment/5032c977-9ade-4656-a339-1e95508c6c8a). Dokumentują plan ucznia i aktywację oficjalnej aplikacji. Nie znaleziono w sprawdzonych materiałach kontraktu zewnętrznego API ani subskrypcji ICS. Nie oznacza to, że producent nie udostępnia ich partnerom. Dostęp mobilny nie został uznany za klucz zewnętrznej integracji.

Do odblokowania integracji potrzebny jest wspierany przez dostawcę odczyt planu: prywatny ICS albo dokumentacja autoryzacji i danych zajęć, z limitem odczytu oraz jawnym znaczeniem odwołania/przełożenia. Można zapytać Netro42/szkołę: „Czy udostępniają Państwo rodzicowi prywatną subskrypcję planu ucznia albo dozwolony interfejs tylko do odczytu planu, odwołań i przeniesień dla własnej aplikacji rodzinnej?”. Wiadomości nie wysłano.

Ręczne wpisanie planu do obecnego Kalendarza pozostaje możliwe. Bez aktualnego źródła danych nie można automatycznie i wiarygodnie oznaczać odwołań. Brak pobrania lub brak wpisu nie jest odwołaniem. Nie wpisano fikcyjnych zajęć, nie zmieniono SP4 i nie utworzono schedulera Fryderyka.

## Testy i zakres

Node.js 22: **97/97 PASS** — provider eduVULCAN, przechowywanie/odnawianie sesji, scheduler oraz nowa kontrola metadanych. Użyto wyłącznie syntetycznych danych i atrap portalu/bazy; produkcyjnego stanu Firebase nie odczytano. `npm run build`: **PASS**, z istniejącym ostrzeżeniem o dużym bundlu.

Zmiany tej gałęzi obejmują wyłącznie kontrolę metadanych, test ciągłości sesji oraz tę instrukcję. Kod produkcyjnych providerów, szyfrowanie, harmonogramy, Functions, reguły i pozostałe moduły pozostają bez zmian. Nie wykonano deploymentu ani zapisów produkcyjnych.
