# Nasza Rodzina 1.6.0 — powiadomienia IN-APP

> **Dokument historyczny poprzedniego etapu.** Późniejsza decyzja użytkownika przywróciła Firebase Functions i Cloud Scheduler dla bezpiecznej synchronizacji eduVULCAN także przy zamkniętej aplikacji oraz serwerowych triggerów inbox. Aktualna instrukcja: [EDUVULCAN_FUNCTIONS_HARMONOGRAM.md](EDUVULCAN_FUNCTIONS_HARMONOGRAM.md). **Dla aktualnego harmonogramu Blaze i Functions są wymagane**, lecz FCM, Web Push, VAPID i systemowa zgoda nadal nie są wymagane. Poniższe stwierdzenia o braku Functions/harmonogramu dotyczą wyłącznie poprzedniego pakietu; nie stosuj ich jako instrukcji aktualnego wdrożenia. Niczego nie wdrożono.

Ten dokument zastępuje wcześniejszą instrukcję wymagającą Firebase Functions i systemowych Web Push. Pakiet przygotowano do akceptacji. **Nie wykonano `git push`, wdrożenia Vercel ani publikacji Firebase.**

## Co jest wymagane

| Element | Bieżący tryb IN-APP |
|---|---|
| Blaze dla powiadomień | **NIE** |
| Firebase Functions | **NIE** — katalog zachowany wyłącznie na przyszłość |
| Cloud Scheduler / harmonogram synchronizacji | **NIE** |
| Firebase Cloud Messaging / Web Push | **NIE** |
| VAPID | **NIE** — `VITE_FIREBASE_VAPID_KEY` może pozostać puste |
| Zgoda na systemowe powiadomienia | **NIE** — aplikacja jej nie żąda |
| Istniejący backend Vercel i Firebase Admin | **TAK** — dotychczasowa konfiguracja |
| Firebase Auth / Firestore | **TAK** — dotychczasowy projekt, konta, UID i uprawnienia |

Nie zmieniaj planu ani Storage w celu włączenia powiadomień IN-APP. Ten tryb nie dodaje wymagania Blaze i nie zmienia niezależnych warunków dostawcy dla istniejącej usługi Storage.

## Synchronizacja eduVULCAN

1. Po zalogowaniu/uruchomieniu rodzica oraz przy powrocie aplikacji do foreground sprawdzany jest czas ostatniej **udanej** synchronizacji (`status.lastSuccessAt`) wspólnego rodzinnego połączenia. Dziecko nie wywołuje API rodzica i nadal widzi wyłącznie własne uprawnione dane. Status oraz trwające żądania są współdzielone przez UI, aby równoczesna aktywacja nie uruchamiała kilku pobrań.
2. Jeśli minęło **co najmniej 60 minut**, wykonywana jest automatyczna synchronizacja. Jeśli minęło mniej, ponowne pobranie jest pomijane.
3. Konta rodziców nadal używają jednego wspólnego połączenia. Zakres oraz blokady pozostają zgodne z istniejącym backendem.
4. Zwykłe przełączanie modułów nie jest aktywacją aplikacji. Nie ma godzinnego `setInterval`, odpytywania w tle ani harmonogramu pobierającego dziennik przy zamkniętej aplikacji.
5. „Synchronizuj teraz” pozostaje. Omija wyłącznie godzinny limit automatycznego UI, nadal respektując istniejący pięciominutowy backendowy rate-limit i blokadę trwającego pobrania. Udane pobranie sprzed mniej niż pięciu minut skutkuje czytelną informacją zamiast zbędnego żądania synchronizacji.
6. Wygaśnięcie eduVULCAN nie jest obchodzone: użytkownik może ponownie połączyć konto istniejącym bezpiecznym formularzem. Nie przechowuje się hasła w frontendzie, Firestore ani repozytorium.

## Skąd pochodzą wpisy dzwonka

Po udanej synchronizacji istniejący backend Vercel porównuje poprzednie i nowe dane szkolne. Wspólne helpery wykrywania zmian są wykorzystywane ponownie; nie powstała druga kopia zasad deduplikacji tylko dla UI.

Wykrywane są nowe i zmienione oceny, nowe wiadomości nauczyciela, sprawdziany, zadania oraz rzeczywiste zmiany planu lekcji. Semantyczny skrót nie obejmuje samego `syncedAt`, `updatedAt`, ID synchronizacji ani podobnych pól technicznych. Stable ID źródła + rodzaj zmiany + skrót treści identyfikuje alert; kolejna synchronizacja bez zmian nie zwiększa licznika.

**Baseline:** pierwsze pobranie istniejącej historii inicjalizuje stan porównania, bez tworzenia dziesiątek starych alertów. Inicjalizacja jest osobna dla każdej faktycznie odczytanej sekcji. Jeżeli częściowe pobranie odczytało plan, ale nie oceny, późniejsze pierwsze pobranie 20 starych ocen nadal jest ciche. Udana odpowiedź z poprawną pustą listą ocen stanowi natomiast baseline ocen: kolejna rzeczywiście nowa ocena daje alert. Błąd/nieodczytana sekcja nie jest traktowana jako zero danych. Dopiero dalsze rzeczywiste zmiany po baseline generują nowe powiadomienia. Deduplikacja i zapis baseline są wykonywane na serwerze.

Plan lekcji uwzględnia również rzeczywisty zakres dat pobrania. Przesunięcie okna, np. przy późniejszym otwarciu aplikacji, nie oznacza zmiany wcześniejszego planu i nie wywołuje alertów o całej nowo pobranej historii. Nowa lekcja lub rzeczywista zmiana we wcześniej potwierdzonym zakresie może wygenerować właściwy wpis.

Backend tworzy `notificationInbox/{UID}/items` przez Firebase Admin. Klient nie dostaje uprawnienia do zapisu dowolnej treści. Preferencje i gwiazdki pozostają w `userPreferences/{UID}`. Odczyt dotyczy wyłącznie własnego UID; dziecko nie dostaje alertu z prywatnej wiadomości rodzica/nauczyciela ani dostępu do jej źródła.

Dzwonek wyświetla liczbę nieprzeczytanych, centrum przechowuje tytuł, treść, czas, moduł oraz odczyt/gwiazdkę. Ważne wpisy są na górze, od najnowszych. Kliknięcie prowadzi do właściwego modułu, który ponownie respektuje swoje istniejące uprawnienia.

Pozaszkolne kategorie korzystają z autoryzowanego `POST /api/notifications/refresh`. Zamontowany raz hook powłoki aplikacji uruchamia go przy starcie/foreground oraz potwierdzonej zmianie danych, z krótkim debounce. Nie ma odpytywania timerem ani wykonywania żądań w ukrytej aplikacji. Serwer rekonstruuje powiadomienia z rzeczywistych danych kalendarza, zadań, zakupów, czatu i Zdrowia, z własnym baseline UID/źródła i ponownym sprawdzeniem uprawnień. Klient nie przekazuje treści alertu, UID odbiorcy ani wskazanego dowolnie dokumentu do powiadomienia.

## Ustawienia i dźwięk

Ustawienia → Powiadomienia zachowują ON/OFF, dźwięk oraz kategorie. Systemowe push są opisane jako funkcja przyszłej aktualizacji. Nie ma przycisku wymagającego zgody systemowej ani komunikatu błędu z powodu pustego VAPID.

Dźwięk około jednej sekundy używa Web Audio wyłącznie podczas widocznej aplikacji. Wymaga odblokowania przez gest użytkownika i włączonego dźwięku oraz kategorii. OFF, ukryta karta, brak API albo blokada autoplay nie odtwarzają go. Sam wpis w centrum pozostaje dostępny niezależnie od powodzenia dźwięku.

Desktop, Android, Safari i zainstalowana PWA korzystają z tego samego dźwięku w aplikacji w granicach możliwości przeglądarki. Nie wysyła się systemowego alertu i nie próbuje odtwarzać dźwięku w tle. Tryb cichy, głośność i Focus mają pierwszeństwo.

## Konfiguracja i aktualizacja po akceptacji

Poniższe kroki są przygotowaną instrukcją; **żaden nie został wykonany na produkcji**.

1. Zachowaj istniejące Firebase Authentication, UID, `members`, dane i konfigurację aplikacji. Nie uruchamiaj historycznego bootstrapu/migracji 1.3.3 w działającej rodzinie 1.5.1.
2. Zachowaj wszystkie obecne `VITE_FIREBASE_*`, serwerowy `FIREBASE_PROJECT_ID`, dokładnie jeden wariant `FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_SERVICE_ACCOUNT_BASE64` i dotychczasowy origin. Nie dodawaj drugiego klucza Admin do repozytorium.
3. **Nie zmieniaj ani nie rotuj `EDUVULCAN_ENCRYPTION_KEY_BASE64` i nie odłączaj wspólnej sesji rodziców z powodu tej aktualizacji.**
4. Google Auth pozostaje bez zmian: `VITE_GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_ID` wskazują ten sam publiczny webowy OAuth Client ID. Jeśli Google zostało już skonfigurowane, nie trzeba go łączyć ponownie. Szczegóły: [ACCOUNT_GOOGLE.md](ACCOUNT_GOOGLE.md).
5. Dla IN-APP nie dodawaj nowych zmiennych środowiskowych. `VITE_FIREBASE_VAPID_KEY` może pozostać puste lub zachowane jako nieaktywne przygotowanie; nie jest warunkiem builda, logowania, synchronizacji, dzwonka ani centrum.
6. Przejrzyj aktualny [raport](PAKIET_1.6.0_RAPORT.md), w tym wyniki testów oraz stwierdzenie, czy obecne reguły wymagają publikacji w Twojej produkcyjnej wersji. Klient nadal nie może tworzyć treści `notificationInbox`. Zmiana trybu IN-APP nie powinna otwierać tej kolekcji.
7. Po osobnej akceptacji aktualizacja obejmuje pełny projekt Vercel, w tym `api/` i `server/`. Sam upload plików statycznych nie uruchomi serwerowej synchronizacji i tworzenia inbox.
8. **Nie wdrażaj `functions/`, nie włączaj FCM/Web Push ani Cloud Scheduler.** `firebase.json` nie zawiera aktywnego targetu Functions. `npm ci --prefix functions` nie jest krokiem aktualizacji IN-APP.
9. Istniejąca PWA pobiera uaktualniony pojedynczy `/sw.js` wraz z powłoką aplikacji. Nie dodawaj `firebase-messaging-sw.js` ani drugiego service workera.

## Weryfikacja i ograniczenia

Wymagany zestaw został zakończony: `npm run build` **PASS**, `npm run test:unit` **68/68**, `npm run test:server` **193/193**, `npm run test:rules` **22/22**, `npm run test:e2e` **150/150** (75 Chromium + 75 WebKit, 13,1 min, kod zakończenia 0). Dodatkowa rzeczywista integracja lokalnych Auth/Firestore/Storage z Admin: **7/7**. Pełne wyniki są w [raporcie](PAKIET_1.6.0_RAPORT.md); nie przeniesiono wyników wcześniejszej wersji push.

Zakres obejmuje aktywację aplikacji i próg 60 minut, brak synchronizacji przy zmianie modułu, ręczne pobranie, baseline, nowe i zmienione rekordy, deduplikację, uprawnienia rodzica/dziecka oraz start bez VAPID, Functions i żądania systemowej zgody.

Powiadomienia wymagają udanej operacji źródłowej i połączenia aplikacji z Firestore. Zamknięta aplikacja niczego nie synchronizuje i nie pokaże systemowego alertu. Późniejsze otwarcie może pobrać nowe wpisy po dozwolonej aktywacji/synchronizacji. Nie ma gwarancji pracy bezterminowej wygasłej sesji eduVULCAN.

Pozaszkolne odczyty serwera są ograniczone do 500 rekordów na źródło i 768 KiB na dokument baseline. Zbyt duży niepełny zakres jest pomijany i raportowany w odpowiedzi, aby nie utworzyć fałszywego baseline ani duplikatów. Czat korzysta z 500 najnowszych wiadomości; starsza historia ponownie wchodząca do okna nie staje się nowym alertem. Serwer ponownie odczytuje źródło w transakcji inbox, aby zmiana uczestników/prywatności tuż przed zapisem nie dostarczyła wpisu niewłaściwemu UID.

Nie ma działającego w tle procesu opróżniania kolejki. Nieudany zapis wpisów szkolnych nie kasuje udanego importu: trwały dziennik zmian jest ponownie obsługiwany podczas następnego dozwolonego status/sync. Deterministyczne ID inbox chronią przed duplikatem przy retry. Harmonogram przypomnień leków Functions nie jest aktywny. Zachowano dotychczasowe lokalne przypomnienia podczas otwartego modułu Zdrowie; nie gwarantują alarmu po zamknięciu.
