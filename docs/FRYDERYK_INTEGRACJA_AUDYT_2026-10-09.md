# Fryderyk — audyt możliwości integracji, 9 października 2026

## Wynik i granice audytu

**Autoryzowane pobieranie danych przez zewnętrzną aplikację nie zostało jeszcze potwierdzone.** Można przygotować wyłącznie interfejs z jednoznacznym stanem „Fryderyk — niepołączono”. Nie ma podstaw do uruchomienia połączenia, importu ani harmonogramu.

Przeanalizowano aktualny kod gałęzi `deploy/family-evolution-9be5721`, bazę `642982b`, wcześniejszy audyt projektu oraz dostępne publiczne materiały producenta i szkół. Nie logowano się do portalu rodzica. Nie pozyskiwano haseł, kodów QR, linków aktywacyjnych, cookies ani tokenów. Nie analizowano kodu, protokołu ani zabezpieczeń oficjalnej aplikacji mobilnej. Nie obchodzono Cloudflare, CAPTCHA ani MFA. Nie kontaktowano się z producentem w imieniu użytkownika.

Wnioski „nie znaleziono” dotyczą zbadanych materiałów publicznych; **nie oznaczają, że producent nie ma prywatnego lub partnerskiego API**. Nie potwierdzono również zakazu integracji: wymagane jest uzyskanie warunków i dokumentacji od dostawcy.

## A–E: odpowiedzi techniczne

| Obszar | Ustalenie | Co pozostaje nieznane |
|---|---|---|
| A. Oficjalne API dla aplikacji zewnętrznych | Nie znaleziono publicznej dokumentacji API Fryderyka w zbadanych oficjalnych materiałach. | Endpointy, autoryzacja, zakres danych, zgoda/licencja, limity, wersjonowanie, środowisko testowe. |
| B. ICS / iCalendar | Nie potwierdzono eksportu ani subskrypcji planu. Użytkownik nie widzi takiej opcji. Producent opisuje XML/PDF do archiwizacji; te formaty nie potwierdzają ICS. | Czy szkoła może włączyć prywatną subskrypcję ICS, czy obejmuje odwołania/przeniesienia, oraz jak chronić adres subskrypcji. |
| C. Sesja integracji | Nie znaleziono udokumentowanego sposobu utrzymywania lub odnawiania sesji zewnętrznej. | Rzeczywisty TTL, refresh/revocation, sposób rozłączenia i przyczyny ponownej autoryzacji. |
| D. Dostęp mobilny | Potwierdzono mechanizm aktywacji oficjalnej aplikacji. Nie potwierdzono dopuszczenia go dla zewnętrznych klientów. | Czy producent udostępnia osobną autoryzację integratorów i czy wolno używać mobilnego parowania. |
| E. Zgoda producenta | Potrzebne jest zapytanie do Netro42 i ewentualnie administratora szkoły. | Wspierany kontrakt techniczny i warunki dostępu do danych własnego dziecka. |

**Automatyczne połączenie: na tym etapie niepotwierdzone.** Nie należy go przedstawiać jako działającego ani żądać danych aktywacyjnych w czacie. Publiczna dokumentacja funkcji dostępnych rodzicowi nie jest kontraktem API ani zgodą na ich pobieranie przez inny system.

## Publiczne źródła i ich znaczenie

Materiały odczytano 9 października 2026 przez wyszukiwanie i otwarcie stron. Część wyników producenta pochodzi z kopii indeksowanej, a bezpośrednie otwarcie jego strony głównej, kontaktu i regulaminu zwróciło HTTP 403. Nie uzyskano w ten sposób aktualnego regulaminu ani odpowiedzi producenta.

1. [Funkcje Fryderyka — producent](https://www.fryderyk.edu.pl/funkcje-fryderyka.html): opisuje elastyczne godziny, cykliczne zajęcia, zastępstwa, nauczycieli, sale, plan ucznia, komunikację i eksport XML/PDF. Nie zawiera kontraktu API, ICS ani autoryzacji dla integratorów. Wykaz funkcji nie dowodzi, że każda jest dostępna do odczytu zewnętrznemu klientowi.
2. [Instrukcja logowania do aplikacji — oficjalny materiał szkolny](https://www.gov.pl/attachment/5032c977-9ade-4656-a339-1e95508c6c8a): po wygenerowaniu dostępu mobilnego można sparować oficjalną aplikację przez QR lub identyfikator i hasło. Ważność danych do aktywacji wynosi 30 minut; po wylogowaniu należy wygenerować nowe dane. Dokument nie określa TTL późniejszej sesji, mechanizmu refresh ani uprawnień zewnętrznych aplikacji.
3. [Instrukcja Fryderyka dla rodziców](https://www.gov.pl/attachment/3ae47266-b93f-4a6f-9fc5-df7d2655acf3): przedstawia plan wybranego dziecka, wiadomości i frekwencję w portalu rodzica. Nie opisuje API lub eksportu kalendarza. Jest instrukcją korzystania z interfejsu, a nie dokumentacją integracji.
4. [Aplikacja Dziennika Fryderyk — PSM w Opolu, 20 marca 2025](https://www.gov.pl/web/psmopole/aplikacja-dziennika-fryderyk): objaśnia część ikon mobilnych. To materiał innej szkoły i określonej wersji; nie należy przyjmować go jako pełnej legendy aktualnego portalu w Kołobrzegu.
5. [Strona producenta](https://www.fryderyk.edu.pl/), [kontakt producenta](https://www.fryderyk.edu.pl/kontakt.html): oficjalny serwis identyfikuje Netro42 jako dostawcę. Pytania można przekazać kanałem kontaktowym wskazanym w tym serwisie lub przez administratora szkoły. W audycie nie wysłano wiadomości.

Wyszukiwano w szczególności publiczne materiały dla kombinacji `Fryderyk`, `Netro42`, `API`, `integracja`, `ICS` i `iCalendar`, w tym w domenie producenta. Nie znaleziono wiarygodnego kontraktu integracyjnego. Ogólne wyniki dotyczące innych produktów o podobnej nazwie odrzucono.

Wcześniejszy, zapisany w [audytowanym projekcie](FRYDERYK_AUDYT_DOSTEPU.md) pojedynczy anonimowy GET `https://psmkolobrzeg.fryderyk.edu.pl` z 8 października 2026 zwrócił HTTP 403 i stronę Cloudflare. **Nie ponawiano w tym audycie zapytań do portalu rodzica.** Blokada tego wejścia nie rozstrzyga, czy istnieje wspierane partnerskie API.

## Dostęp mobilny: czego nie wolno z niego wywnioskować

Użytkownik potwierdził „Profil → Dostęp mobilny → Wygeneruj dane logowania”, link aktywacyjny, QR oraz identyfikator/hasło aktywacyjne. Według komunikatów portalu aktywacja jest jednorazowa, ma okno 30 minut i kolejne urządzenie wymaga nowego kompletu danych. Jednorazowość i link to informacja od użytkownika; publiczna instrukcja potwierdza QR, formularz i 30 minut.

- Te dane służą do parowania oficjalnej aplikacji; nie traktujemy ich jako klucza API.
- Okno aktywacji nie oznacza 30-minutowego TTL późniejszej sesji.
- Istnienie oficjalnego klienta nie potwierdza prawa ani wspieranego sposobu używania jego protokołu przez „Naszą Rodzinę”.
- Nie pobieramy APK/IPA, nie dekompilujemy aplikacji, nie przechwytujemy jej sesji i nie próbujemy zgadywać endpointów.
- Użytkownik nie powinien przesyłać do Codexa żadnych prawdziwych danych parowania, linku, QR, nagłówków autoryzacyjnych ani surowego HAR.

## Znaczenie oznaczeń zajęć

Dokument szkolny PSM w Opolu objaśnia: fortepian oznacza akompaniament, komputer zajęcia zdalne, a dwie osoby lekcję indywidualną. Dwie strzałki zależnie od koloru wskazują zastępstwo albo odwołanie. Dokument **nie określa, który konkretny kolor oznacza który stan**. Nie ustalono pełnej legendy przełożenia i zmiany sali dla portalu w Kołobrzegu. [Źródło](https://www.gov.pl/web/psmopole/aplikacja-dziennika-fryderyk).

Nie wolno więc uznać dowolnej strzałki, koloru, przekreślenia lub braku wpisu za odwołanie. W przyszłym adapterze stan powinien wynikać z udokumentowanego pola dostawcy; dla nieznanego oznaczenia trzeba zachować surowy sens dostępny użytkownikowi, bez wymyślania statusu. Także informacja z marca 2025 o planowanym panelu wiadomości w aplikacji mobilnej nie dowodzi jego aktualnej dostępności w API.

## Stan aktualnego projektu i możliwy zakres interfejsu

W bazie `642982b` istnieje wcześniejszy dokument analityczny, lecz **nie ma aktywnego provider/endpointu/backendu/schedulera Fryderyka ani połączenia pobierającego dane muzyczne**. Poniższe elementy projektu można wykorzystać bez zmiany SP4:

- `src/SchoolModule.tsx`: istniejący moduł szkolny i przełączanie uczniów;
- `src/school/read-access.ts`, `src/family-members.ts`: istniejący zakres rodzic/dziecko i dynamiczne profile;
- `src/ui/index.tsx`, `src/ui/design-system.css`: wspólne karty, nagłówki, przyciski, ikony i statusy;
- `src/EduVulcanConnection.tsx`: istniejący interfejs SP4; nie powinien obsługiwać sesji Fryderyka;
- `server/edu-*`, `server/calendar-*`: wzorce lease, idempotencji, szyfrowanych połączeń i synchronizacji do wykorzystania architektonicznego po potwierdzeniu protokołu, bez kopiowania sesji lub zmieniania ich konfiguracji;
- `functions/index.mjs`: obecne harmonogramy pozostają bez zmiany;
- `firestore.rules`: wiadomości rodzicielskie są w osobnej kolekcji, klient nie ma dostępu do `_eduConnections`.

Bezpieczny interfejs przygotowawczy może pokazać dwa oddzielne widoki źródeł: istniejący **SP4 — eduVULCAN** i **Fryderyk — Szkoła muzyczna**. Nowy widok powinien mieć stan „Fryderyk — niepołączono”, pusty plan z tekstem „Dane nie są jeszcze pobierane” oraz informację o oczekiwaniu na dokumentację i zgodę. Nie pokazujemy zera jako dowodu braku zajęć w szkole.

W „Ustawienia → Połączenia szkolne → Fryderyk” można pokazać tę samą informację. Akcje „Połącz” i „Synchronizuj teraz” nie mogą udawać działania; formularz sekretów nie powstaje, dopóki nie znamy autoryzowanego sposobu autoryzacji. Pusta sekcja nie wykonuje zapytań do Fryderyka, nie zapisuje danych w Firestore i nie tworzy żadnej Function.

Widoczność interfejsu musi zależeć od istniejącego zakresu szkolnego. Rodzic przełącza dozwolonych uczniów, dziecko wyłącznie własny profil. Przygotowana karta Fryderyka nie oznacza, że konkretny profil ma potwierdzone konto w szkole muzycznej. Przypisanie realnego połączenia do Nikodema powinno nastąpić dopiero na podstawie zweryfikowanego zewnętrznego ID ucznia, bez zgadywania po imieniu.

## Konkretne pytania do Netro42 / administratora szkoły

1. Czy dopuszczają Państwo aplikację rodzinną odczytującą dane własnego dziecka? Czy wymagana jest zgoda szkoły, umowa integracyjna lub rejestracja aplikacji? Prosimy o wskazanie aktualnych warunków.
2. Czy istnieje oficjalne REST/GraphQL API, eksport lub partnerski interfejs? Prosimy o aktualną dokumentację, wersję, bazowy adres oraz środowisko testowe z fikcyjnymi danymi.
3. Czy udostępniają Państwo prywatną subskrypcję ICS/iCalendar planu ucznia? Czy jest dostępna dla rodziców, jak się ją aktywuje i unieważnia, jaki ma zakres oraz częstotliwość odświeżania?
4. Jaki sposób autoryzacji jest wspierany dla klientów zewnętrznych: OAuth, osobny token czy inny mechanizm? Czy mobilne parowanie może być legalnie i technicznie użyte przez zewnętrzną aplikację, czy jest zastrzeżone dla klienta Fryderyka?
5. Jakie są uprawnienia i zakresy rodzic/dziecko? Czy można udzielić tylko odczytu planu, zmian, ogłoszeń, frekwencji i uprawnionych wiadomości, bez możliwości zmiany danych szkoły?
6. Jak rozpoznać i zweryfikować szkolny tenant oraz ucznia dostępnym dla użytkownika? Czy oba konta rodzicielskie mogą korzystać ze wspólnego, autoryzowanego połączenia i na jakich warunkach?
7. Jakie są TTL tokenów/sesji, mechanizm odnawiania, sygnały unieważnienia i bezpieczne rozłączenie? Czy odnowienie nie wymaga przechowywania głównego hasła? Jakie zachowanie jest oczekiwane przy MFA?
8. Jakie limity obowiązują na użytkownika, szkołę i aplikację? Czy wolno odczytywać plan raz na godzinę 08:00–18:00 `Europe/Warsaw`? Czy są zalecane interwały, `Retry-After`, ETag lub odczyt przyrostowy?
9. Czy istnieją webhooki zmian planu lub wersja/cursor synchronizacji? Jak długo przechowywane są informacje o usuniętych lub odwołanych zajęciach?
10. Jakie stabilne identyfikatory mają lekcja, seria i pojedyncze wystąpienie? Czy przeniesiona lekcja zachowuje ID? Jak zidentyfikować wyjątki cyklu i zmiany nauczyciela/sali?
11. Prosimy o dokumentację statusów: odwołanie, zastępstwo, przełożenie, zajęcia zdalne i indywidualne. Jakie znaczenie mają poszczególne kolory i ikony w aktualnej wersji Kołobrzegu oraz ich odpowiedniki w danych?
12. W jakiej strefie i formacie są daty/godziny? Jak reprezentowane są zajęcia po zmianie czasu oraz wielotygodniowe cykle i przerwy świąteczne?
13. Czy API/export obejmuje wiadomości, ogłoszenia i nieobecności? Jak oznaczone są wiadomości tylko dla rodziców? Czy sam odczyt zmienia stan przeczytania lub powoduje inne skutki?
14. Jakie są zasady przechowywania, retencji i usuwania kopii danych w prywatnej aplikacji rodzinnej, obowiązek aktualizacji dokumentacji oraz kanał zgłaszania incydentów i zmian API?

Nie potrzeba przekazywać producentowi hasła, QR ani aktywnego tokenu użytkownika. Pytania stanowią przygotowanie do kontaktu; niczego nie wysłano.

## Plan po potwierdzeniu dopuszczonego dostępu

1. **Dokumentacja i zgoda:** zatwierdzić wspierany kontrakt, read-only zakres oraz limity, następnie testować na danych dostawcy/emulatorach. Jeśli dostęp jest zastrzeżony dla oficjalnej aplikacji, pozostać przy pustym widoku lub zaoferować udokumentowany eksport.
2. **Oddzielne połączenie:** przypisać uprawnioną rodzinę i istniejący profil do zweryfikowanego ucznia/tenantu. SP4 pozostaje niezależny. Jeśli będzie wymagany token/sekret, przechowywać go wyłącznie po stronie serwera w zaszyfrowanej strukturze i zarządzanym sekrecie przeznaczonym dla Fryderyka; nie zmieniać klucza ani sesji eduVULCAN i konfiguracji Google Calendar.
3. **Osobny adapter:** pobierać wyłącznie dokumentowane dane i odróżniać plan, ogłoszenia, wiadomości i nieobecności. Najpierw potwierdzić poprawność osobnego widoku Fryderyka, bez zapisu do wspólnego kalendarza.
4. **Idempotencja:** oprzeć ID na tenant/połączenie/uczeń/zewnętrzne ID lekcji lub wystąpienia. Zmiana godziny lub sali aktualizuje ten sam rekord, jeśli wynika z tożsamości dostawcy. Nie identyfikować wydarzenia tylko po tytule i godzinie; nie dopasowywać przełożenia heurystycznie bez udokumentowanego ID.
5. **Odwołania i braki:** potwierdzone odwołanie zachować jako `ODWOŁANE`; brak elementu w niepełnym lub błędnym pobraniu nie oznacza odwołania. Nie usuwać wpisów ręcznych ani prywatnych wydarzeń innych źródeł.
6. **Kalendarium:** po potwierdzeniu danych dodać źródło `fryderyk`, rzeczywistą datę, początek/koniec i właściciela. Zachować istniejące uprawnienia private/family, lokalną widoczność i niezależność SP4.
7. **Prywatność:** wiadomości rodzica przechowywać odrębnie od planu i wiadomości ucznia. Child nie może uzyskać dostępu przez URL, kolekcję, kalendarz ani powiadomienie. Przy potrzebie nowych kolekcji przygotować wąskie Rules i testy emulatorowe, bez publikowania ich w tym etapie. Nie korzystać z Admin SDK bez własnej weryfikacji członkostwa i uprawnień.
8. **Baseline i alerty:** pierwsze pobranie tworzy baseline; potem porównywać znaczące pola, ignorować `syncedAt`/`updatedAt`. Stabilne ID plus hash rzeczywistej zmiany zapobiegają ponownym alertom o tym samym stanie.
9. **Stan połączenia:** „Połączono” wyłącznie po potwierdzonej autoryzacji, „Ostatnia udana synchronizacja” wyłącznie po kompletnym zapisie. Błąd przejściowy zachowuje ostatnie dobre dane; wygasła/odwołana autoryzacja wymaga ponownego połączenia przez uprawnionego rodzica, bez prób hasłem.

### Proponowany przyszły harmonogram

Po pisemnym potwierdzeniu limitów preferowany jest pojedynczy serwerowy scheduler **`0 8-18 * * *`**, **`Europe/Warsaw`**: 11 terminów dziennie, od 08:00 do 18:00 włącznie. Działałby przy zamkniętej aplikacji. To propozycja, a nie istniejąca lub uruchomiona Function.

- Jeśli dostawca narzuca rzadsze odczyty, zwiększyć odstęp. Jeśli oferuje autoryzowane webhooki, preferować je i ograniczyć harmonogram do kontroli spójności.
- Wspólna atomowa blokada manual/scheduler dla **tego samego połączenia Fryderyka**, z deduplikacją planowanego slotu `scheduleTime`, budżetem czasu i ochroną przed zapisem wyniku starej sesji.
- Pobieranie przyrostowe lub warunkowe ETag/wersja, jeśli jest dokumentowane; żadnego ciągłego odpytywania przeglądarki ani dodatkowego schedulera co kilka minut.
- Ograniczone ponowienia timeout/5xx z opóźnieniem; dla 429 respektowanie `Retry-After` i limitu prób. Przy 401/403 odróżniać dokumentowane wygaśnięcie od blokady/zakazu; nie omijać żadnego zabezpieczenia.
- Logi wyłącznie: czas próby/sukcesu, liczby rekordów, bezpieczny kod błędu. Bez treści wiadomości, tożsamości ucznia i danych autoryzacyjnych.
- Przetestować UTC i `Europe/Warsaw`, zmianę czasu, równoległe wykonanie, odwołanie, przełożenie, niepełne dane, nowe baseline i brak duplikatów. Nie wykorzystywać prawdziwych rodzinnych danych do zapisów testowych.

## Następne kroki i warunek rozpoczęcia backendu

**Należy skontaktować się z Netro42** przez oficjalny kanał, ewentualnie z pomocą administratora PSM w Kołobrzegu. Wystarczy przesłać powyższe pytania i opis aplikacji wykorzystującej dane własnego dziecka. Kod, endpointy, sesję, dane aktywacyjne lub zgodę na użycie mobilnego mechanizmu musi potwierdzić dostawca; nie należy ich wyprowadzać z domysłów.

Do tego czasu dozwolone są poprawki istniejącego UI i jawnie niepołączony widok przygotowawczy. **Nie implementujemy pobierania, logowania, tokenów, zmian Firestore/Storage Rules ani schedulera Fryderyka.** Realne połączenie oraz publikacja serwerowej funkcji wymagają osobnego następnego etapu i zgody użytkownika na wdrożenie.

Ten audyt nie zmienił produkcji, danych, chmury, sekretów, połączenia eduVULCAN, harmonogramów SP4 ani konfiguracji Google Calendar.
