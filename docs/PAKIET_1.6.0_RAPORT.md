# Nasza Rodzina 1.6.0 — IN-APP, pakiet do akceptacji

> **Raport historyczny poprzedniego etapu IN-APP.** Późniejsza decyzja użytkownika dodała harmonogram eduVULCAN i triggery Firebase Functions. Aktualny raport: [EDUVULCAN_FUNCTIONS_HARMONOGRAM.md](EDUVULCAN_FUNCTIONS_HARMONOGRAM.md). **Dla aktualnego harmonogramu Blaze: TAK; Functions: TAK**, z zachowaniem dostarczania IN-APP bez systemowego FCM/Web Push. Poniższe dawne wyniki testów i listy plików dotyczą poprzedniego pakietu, a jego instrukcje „nie wdrażaj Functions” nie są aktualną instrukcją wdrożenia. Bieżące prace nie wykonały commit, push, deploymentu ani zmian sekretów.

Pakiet rozwija istniejącą aplikację produkcyjną **1.5.1** i zastępuje wcześniejszego kandydata **1.6.0 z Web Push** wariantem **1.6.0 IN-APP**. Nie wykonano `git push`, wdrożenia Vercel, publikacji reguł ani konfiguracji Firebase. Nie logowano się do produkcyjnych kont rodziny i nie zmieniano jej danych.

**Blaze wymagany: NIE. Firebase Functions wymagane: NIE. FCM / systemowe Web Push: NIE.** Brak VAPID nie jest błędem, a aplikacja nie rejestruje tokenu FCM i nie żąda zgody na systemowe powiadomienia. Google Auth, dzwonek, centrum oraz gwiazdki pozostają.

**Końcowa weryfikacja IN-APP: PASS.** Build, unit **68/68**, server **193/193**, Rules **22/22**, dodatkowa integracja Admin/eduVULCAN **7/7** oraz pełny Playwright **150/150** — **75 Chromium + 75 WebKit**, **0 FAIL**, kod zakończenia **0**, czas **13,1 min**. To rzeczywiste wyniki bieżącego wariantu, nie przeniesione wyniki wcześniejszej 1.6.0 Web Push.

Pełny ZIP obejmuje kod frontendowy i backend Vercel. Po udanej synchronizacji to Vercel/Firebase Admin tworzy wpisy inbox; aplikacja nie zależy od wdrożenia `functions/`. Katalog zachowano jako nieaktywne przygotowanie do przyszłości i usunięto jego aktywny target z `firebase.json`. Szczegóły: [POWIADOMIENIA_IN_APP_1.6.0.md](POWIADOMIENIA_IN_APP_1.6.0.md). Dalsze instrukcje dotyczą wyłącznie osobno zaakceptowanej aktualizacji; żadnej publikacji nie wykonano.

## 1. Wszystkie zmienione pliki

### Zmiana bieżącego wariantu IN-APP względem poprzedniego ZIP 1.6.0

Porównanie z `Nasza_Rodzina_v1.6.0_DO_AKCEPTACJI.zip`: **43 zmienione pliki**, bez usunięcia istniejących plików. Poprawiony ZIP ma nazwę `Nasza_Rodzina_v1.6.0_IN_APP_DO_AKCEPTACJI.zip`.

<!-- IN_APP_CHANGED_FILES_START -->
- `.env.example`
- `README.md`
- `docs/FIREBASE.md`
- `docs/NOTIFICATIONS.md`
- `docs/PAKIET_1.6.0_RAPORT.md`
- `firebase.json`
- `preview/account-settings.png`
- `preview/calendar-edit-series.png`
- `preview/calendar-recurring-event.png`
- `preview/health-upload-50.png`
- `preview/important-family-messages.png`
- `preview/index.html`
- `preview/notifications-center.png`
- `preview/notifications-settings.png`
- `preview/private-chat.png`
- `preview/school-dashboard.png`
- `preview/school-desktop-landscape.png`
- `preview/school-phone-landscape.png`
- `preview/school-phone-portrait.png`
- `preview/school-tablet-portrait.png`
- `preview/start-1440x900.png`
- `preview/start-390x844.png`
- `preview/start-768x1024.png`
- `preview/start-desktop.png`
- `preview/start-phone-landscape.png`
- `preview/start-phone-portrait.png`
- `preview/start-tablet-landscape.png`
- `preview/start-tablet-portrait.png`
- `server/edu-provider.mjs`
- `server/edu-service.mjs`
- `server/edu-storage.mjs`
- `server/notification-events.mjs`
- `src/EduVulcanConnection.tsx`
- `src/main.tsx`
- `src/notifications/index.tsx`
- `src/notifications/model.ts`
- `tests/README.md`
- `tests/edu-browser.spec.ts`
- `tests/edu-provider.test.mjs`
- `tests/notification-browser.spec.ts`
- `tests/notification-events.test.mjs`
- `tests/notification-model.test.ts`
- `vite.config.ts`
<!-- IN_APP_CHANGED_FILES_END -->

### Pełny zakres pakietu względem 1.5.1

Porównanie bajtów z dostarczonym projektem `Nasza_Rodzina_v1.5.1_SZKOLA_ETAP_1.zip`. Lista pomija zależności, build, logi, cache emulatorów i wyniki robocze testów. Pliki przeniesionych modułów pojawiają się jako nowe; dotychczasowy monolit `src/main.tsx` jest zmieniony. Listy obejmują również dokumentację i podglądy.

<!-- CHANGED_FILES_START -->
- `.env.example`
- `README.md`
- `docs/FIREBASE.md`
- `firebase.json`
- `firestore.rules`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `preview/school-dashboard.png`
- `preview/school-desktop-landscape.png`
- `preview/school-phone-landscape.png`
- `preview/school-phone-portrait.png`
- `preview/school-tablet-portrait.png`
- `preview/start-1440x900.png`
- `preview/start-390x844.png`
- `preview/start-768x1024.png`
- `server/edu-provider.mjs`
- `server/edu-service.mjs`
- `server/edu-storage.mjs`
- `src/EduVulcanConnection.tsx`
- `src/SchoolModule.tsx`
- `src/calendar-utils.ts`
- `src/main.tsx`
- `src/useSchoolProfilePhotos.ts`
- `storage.rules`
- `tests/README.md`
- `tests/browser.spec.ts`
- `tests/edu-browser.spec.ts`
- `tests/edu-provider.test.mjs`
- `tests/emulator-fixtures.ts`
- `tests/security.rules.test.mjs`
- `vercel.json`
- `vite.config.ts`
<!-- CHANGED_FILES_END -->

## 2. Wszystkie nowe pliki

### Nowe pliki bieżącego wariantu IN-APP względem poprzedniego ZIP 1.6.0

**18 nowych plików**. Katalog `functions/` i wcześniejsze pliki pozostają; nie usunięto istniejącej funkcjonalności.

<!-- IN_APP_NEW_FILES_START -->
- `api/notifications/refresh.mjs`
- `docs/POWIADOMIENIA_IN_APP_1.6.0.md`
- `functions/README.md`
- `server/notification-inapp-worker.mjs`
- `server/notification-inbox.mjs`
- `server/notification-refresh.mjs`
- `server/school-notifications.mjs`
- `src/notifications/legacy-push.ts`
- `src/notifications/refresh.ts`
- `src/school/activation-sync.ts`
- `src/school/edu-client.ts`
- `src/school/useEduActivationSync.ts`
- `tests/edu-activation.spec.ts`
- `tests/notification-inapp.integration.mjs`
- `tests/notification-refresh.spec.ts`
- `tests/notification-refresh.test.mjs`
- `tests/notification-school-inapp.test.mjs`
- `tests/school-activation.test.ts`
<!-- IN_APP_NEW_FILES_END -->

### Pełny zakres nowych plików pakietu względem 1.5.1

<!-- NEW_FILES_START -->
- `api/account/google-login.mjs`
- `api/account/members.mjs`
- `api/notifications/refresh.mjs`
- `api/notifications/register.mjs`
- `api/notifications/status.mjs`
- `api/notifications/unregister.mjs`
- `docs/ACCOUNT_GOOGLE.md`
- `docs/EDUVULCAN_ODPOWIEDZI_AUDYT.md`
- `docs/KALENDARZ_PAKIET.md`
- `docs/NOTIFICATIONS.md`
- `docs/PAKIET_1.6.0_RAPORT.md`
- `docs/POWIADOMIENIA_IN_APP_1.6.0.md`
- `docs/calendar.rules.fragment.txt`
- `functions/README.md`
- `functions/index.mjs`
- `functions/notification-baseline.mjs`
- `functions/notification-events.mjs`
- `functions/package-lock.json`
- `functions/package.json`
- `preview/account-login.png`
- `preview/account-password-reset.png`
- `preview/account-settings.png`
- `preview/calendar-edit-series.png`
- `preview/calendar-recurring-event.png`
- `preview/health-upload-50.png`
- `preview/important-family-messages.png`
- `preview/index.html`
- `preview/notifications-center.png`
- `preview/notifications-settings.png`
- `preview/private-chat.png`
- `preview/shopping-products.png`
- `preview/start-desktop.png`
- `preview/start-phone-landscape.png`
- `preview/start-phone-portrait.png`
- `preview/start-tablet-landscape.png`
- `preview/start-tablet-portrait.png`
- `server/account-auth.mjs`
- `server/account-http.mjs`
- `server/account-members.mjs`
- `server/notification-devices.mjs`
- `server/notification-events.mjs`
- `server/notification-http.mjs`
- `server/notification-inapp-worker.mjs`
- `server/notification-inbox.mjs`
- `server/notification-refresh.mjs`
- `server/notification-worker.d.mts`
- `server/notification-worker.mjs`
- `server/school-notifications.mjs`
- `src/FamilyTopBar.tsx`
- `src/account/AccountSettings.tsx`
- `src/account/FamilyMembersSettings.tsx`
- `src/account/GoogleLoginButton.tsx`
- `src/account/account-client.ts`
- `src/account/account.css`
- `src/app-shared.tsx`
- `src/calendar-ics.ts`
- `src/calendar-series.ts`
- `src/calendar-store.ts`
- `src/family-directory.tsx`
- `src/family-members.ts`
- `src/family-shell.css`
- `src/features/CalendarPage.tsx`
- `src/features/ChatComposer.tsx`
- `src/features/ChatPage.tsx`
- `src/features/FamilyPage.tsx`
- `src/features/HealthPage.tsx`
- `src/features/HealthUploadStatus.tsx`
- `src/features/LoginPage.tsx`
- `src/features/SettingsPage.tsx`
- `src/features/ShoppingPage.tsx`
- `src/features/StartPage.tsx`
- `src/features/TasksPage.tsx`
- `src/features/calendar-package.css`
- `src/features/chat-health.css`
- `src/features/chat-layout.ts`
- `src/features/health-upload.ts`
- `src/features/shopping-cards.css`
- `src/features/start-dashboard.css`
- `src/features/start-layout.ts`
- `src/features/useDashboardOrder.ts`
- `src/notifications/index.tsx`
- `src/notifications/legacy-push.ts`
- `src/notifications/model.ts`
- `src/notifications/notifications.css`
- `src/notifications/push.ts`
- `src/notifications/refresh.ts`
- `src/notifications/sound.ts`
- `src/school-enhancements.css`
- `src/school/activation-sync.ts`
- `src/school/edu-client.ts`
- `src/school/useEduActivationSync.ts`
- `tests/account-auth.test.mjs`
- `tests/account-browser.spec.ts`
- `tests/account-members.test.mjs`
- `tests/calendar-package.spec.ts`
- `tests/calendar-package.test.ts`
- `tests/chat-health.spec.ts`
- `tests/chat-health.test.ts`
- `tests/edu-activation.spec.ts`
- `tests/notification-baseline.test.mjs`
- `tests/notification-browser.spec.ts`
- `tests/notification-devices.test.mjs`
- `tests/notification-events.test.mjs`
- `tests/notification-inapp.integration.mjs`
- `tests/notification-model.test.ts`
- `tests/notification-refresh.spec.ts`
- `tests/notification-refresh.test.mjs`
- `tests/notification-school-inapp.test.mjs`
- `tests/notification-worker.test.mjs`
- `tests/school-activation.test.ts`
- `tests/school-shopping.spec.ts`
- `tests/school-shopping.test.ts`
- `tests/start-browser.spec.ts`
- `tests/start-layout.test.ts`
<!-- NEW_FILES_END -->

Nie usunięto plików projektu bazowego. Moduły zostały wydzielone z `main.tsx` do `src/features/`, aby kolejne zmiany nie rozbudowywały jednego ogromnego pliku.

Zakres aplikacji:

- Stały górny pasek pokazuje profile rodziny, z aktualnym UID na pierwszym miejscu. Profile przewijają się wewnątrz paska; Start nie powiela avatarów ani kart członków. Zarządzanie członkami znajduje się w Ustawieniach.
- Sidebar ma większe dotychczasowe logo, nazwę w dwóch wierszach i podpis. Dolna nawigacja zachowuje Start / Kalendarz / Zadania / Zakupy / Więcej i istniejący bottom sheet. Wylogowanie przeniesiono na dół Ustawień.
- Start łączy powitanie, istniejącą grafikę i pogodę Open-Meteo w kompaktowy banner. Siedem pastelowych kafli pokazuje rzeczywiste dane. „Rodzinny czas” korzysta z dotychczasowego obliczania końca zajęć. Kafelki przenosi się po przytrzymaniu 550 ms, z tolerancją 8 px i `DragOverlay`; pozostałe pozostają nieruchome aż do puszczenia. Zapis następuje tylko po drop, w preferencjach UID, z osobnym cache UID na urządzeniu.
- Logowanie używa wspólnych SVG; reset hasła jest subtelnym wierszem pod hasłem i wywołuje istniejący Firebase reset. Google jest dodatkowym providerem istniejącego UID. E-mail zmienia się dopiero po reautoryzacji i kliknięciu linku na nowy adres.
- Czat rodzinny i prywatny używają wspólnego `ChatComposer`, przewijalnej listy wiadomości i pomiaru `visualViewport`. Zachowano wysyłanie tekstu, odpowiedzi i istniejące operacje. Uwzględniono klawiaturę, dolną nawigację i safe area.
- Zdrowie używa rzeczywistego `uploadBytesResumable`. Postęp liczony jest z bajtów; 100% pojawia się po potwierdzeniu Storage. Dokumenty otwiera się autoryzowanym `getBlob`, bez publicznych URL z tokenem.
- Kalendarz obsługuje poniedziałek–piątek, interwały co N dni/tygodni/miesięcy/lat, wybór dni tygodnia i kończenie według daty/liczby. Edycja/usuwanie obejmują jedno wystąpienie, to i kolejne albo całą serię. Dodano prawdziwą prywatność przez odrębną chronioną kolekcję i import/eksport ICS z osobą oraz zakresem dat.
- Szkoła zachowuje zaakceptowany design i działającą integrację. `schoolEnabled` kontroluje dostępność uczniów; starsze dokumenty korzystają z kompatybilnych domyślnych metadanych, bez migracji zapisywanej do bazy. Layla nie występuje w selektorze szkolnym. Rodzic przełącza uczniów, dziecko widzi własnego. Gwiazdki wiadomości są indywidualne.
- Szybkie Zakupy zachowują własne zdjęcia, dodawanie, edycję, kategorie i long press. Obraz wypełnia kwadrat; nazwa ma czarny tekst i jasny text-shadow.
- Dzwonek pokazuje nieprzeczytane powiadomienia. Centrum obsługuje moduł, czas, odczyt i gwiazdkę. Preferencje ON/OFF, dźwięk i osiem kategorii są przypisane do UID. Ważne wpisy są pierwsze, od najnowszych.

## 3. Czy zmieniono firestore.rules

**Dla zmiany 1.6.0 Web Push → IN-APP: NIE są wymagane dalsze zmiany.** Reguły przygotowane w pierwotnym pakiecie 1.6.0 pozostają. Klient nie może tworzyć dowolnej treści `notificationInbox` ani czytać cudzej skrzynki; wpisy tworzy autoryzowany backend Vercel przez Firebase Admin.

Względem bazowej 1.5.1 pierwotny pakiet 1.6.0 dodał:

- `privateCalendarEvents`: odczyt i zapis wyłącznie właściciela; publiczny kalendarz odrzuca pozorną prywatność przez `private:true`.
- `userPreferences/{UID}`: tylko właściciel, walidowane pola układu Startu, preferencji i indywidualnych gwiazdek.
- `notificationInbox/{UID}/items`: właściciel czyta i zmienia tylko `read`, `readAt`, `starred`; treść, tworzenie i usuwanie należą do backendu.
- Chronione `_notificationDevices`, `_notificationTokenOwners`, `_notificationEvents`, `_notificationOutbox`, `_notificationBaselines`: brak bezpośredniego dostępu klienta, także rodzica.
- Bezpieczne identyfikatory nowych członków `member-<24 znaki hex>`; istniejące UID i personKey zachowane.

Jeśli wcześniejszych reguł 1.6.0 nie opublikowano, przyszłe wdrożenie całego pakietu nadal wymaga ich przeglądu i osobnej akceptacji publikacji. Przejście na IN-APP nie otwiera żadnej kolekcji i nie usuwa ochrony poprzedniej wersji. Reguł nie opublikowano. Indeksy pozostają bez zmian.

## 4. Czy zmieniono storage.rules

**Dla zmiany 1.6.0 Web Push → IN-APP: NIE.** W pierwotnym pakiecie 1.6.0 dodano jedynie bezpieczny format nowych identyfikatorów członków. Podział `health/parents` / `health/shared`, autoryzacja UID i osoby, limit 10 MB, typy PDF/JPG/JPEG/PNG oraz blokada dawnych niechronionych ścieżek pozostają. Nie obniżono ochrony Zdrowia ani nie zmieniono plików produkcyjnych. Reguł nie opublikowano.

## 5. Czy zmieniono backend

**Tak, zależność powiadomień od Functions zastąpiono autoryzowanym backendem Vercel.** Po udanej synchronizacji eduVULCAN backend porównuje poprzednie i nowe dane, inicjalizuje baseline i zapisuje właściwe `notificationInbox/{UID}/items` przez Firebase Admin. Wspólne helpery semantycznego wykrywania zmian i deduplikacji są wykorzystywane ponownie. Klient nie otrzymuje prawa do tworzenia dowolnej treści powiadomień.

Wykrywanie obejmuje nowe i zmienione oceny, nowe wiadomości nauczyciela, zadania, sprawdziany i rzeczywiste zmiany planu. `syncedAt`, `updatedAt`, ID synchronizacji i inne techniczne metadane nie są powodem alertu. Stable ID źródła, typ zmiany i skrót treści pozwalają uniknąć powtórzenia tego samego wpisu. Pierwszy import historii tworzy baseline bez starych alertów. Wiadomości nauczyciela otrzymują wyłącznie uprawnieni rodzice; dziecko nie dostaje prywatnej skrzynki ani jej treści w powiadomieniu.

Baseline jest inicjalizowany **osobno dla każdej faktycznie odczytanej sekcji**: m.in. ocen, wiadomości i planu. Częściowa synchronizacja, która pobrała tylko lekcje, nie uznaje nieodczytanej historii ocen za znaną. Po odzyskaniu dostępu pierwsze pobranie np. 20 istniejących ocen pozostaje bez alertów. Natomiast udana odpowiedź ocen z poprawną pustą listą inicjalizuje baseline ocen: późniejsza rzeczywiście nowa ocena daje jeden alert. Nie traktuje się błędu sekcji ani braku odpowiedzi jako potwierdzonego zera rekordów.

`server/edu-provider.mjs` zmieniono wyłącznie o wewnętrzne metadane sekcji, których pobranie faktycznie się powiodło; `edu-service` przekazuje je do chronionego zapisu. Nie zmieniono adresów/żądań logowania, ciastek, formatu sesji, haseł, szyfrowania ani rate-limitów. Provider nie jest więc bajtowo identyczny ze starą paczką, choć dotychczasowy kontrakt UI/API i mechanizm połączenia pozostają.

Automatyczne pobieranie jest aktywacją aplikacji: zalogowanie/uruchomienie rodzica oraz powrót do foreground sprawdzają ostatnią **udaną** synchronizację (`status.lastSuccessAt`). Próg wynosi **co najmniej 60 minut**. Status i trwające wywołania są współdzielone przez UI, bez równoczesnych duplikatów. Zmiana modułu nie synchronizuje; nie ma godzinnego `setInterval`, Cloud Scheduler ani pobierania przy zamkniętej aplikacji. „Synchronizuj teraz” omija limit godzinny, ale pobranie sprzed mniej niż pięciu minut skutkuje czytelną informacją zamiast zbędnego żądania. Dotychczasowy pięciominutowy rate-limit i pozostałe zabezpieczenia backendu pozostają. Dziecko nie wywołuje API rodzica.

Backend Google i zarządzania członkami pozostaje bez zmiany działania. Łączenie providerów zachowuje UID, a archiwizacja nie usuwa Auth ani historii. Wspólny zakres rodziców eduVULCAN, szyfrowanie, key ID i istniejące rate-limity pozostają. Nie rotowano klucza ani nie rozłączano produkcyjnej sesji.

Kategorie pozaszkolne używają autoryzowanego `POST /api/notifications/refresh` i `server/notification-refresh.mjs`. Zamontowany raz w powłoce aplikacji hook uruchamia odświeżenie przy starcie, foreground oraz potwierdzonej rzeczywistej zmianie istniejących dokumentów Firestore. Krótki debounce łączy serię zmian, bez `setInterval` i odpytywania ukrytej aplikacji. Serwer ponownie odczytuje rzeczywiste dane kalendarza, zadań, zakupów, czatu i Zdrowia, sprawdza UID/uprawnienia i tworzy własny baseline; klient przekazuje tylko powód aktywacji, nigdy treść ani listę odbiorców.

Kod `functions/` zachowano do przyszłych prac, ale usunięto aktywny target z `firebase.json`. **Nie trzeba go instalować ani wdrażać do działania tej wersji.** Nie aktywowano wysyłania FCM, outbox do doręczania systemowego ani przypomnień z harmonogramu Functions. Nowe/zmienione rekordy Zdrowia mogą dawać alert w otwartej aplikacji; nie jest to działający w tle harmonogram dawkowania. Serwer ponownie odczytuje źródło pozaszkolnego alertu wewnątrz transakcji inbox: zmiana uczestników czatu lub ustawienie prywatności przed zapisem nie może dostarczyć alertu na podstawie nieaktualnych uprawnień.

## 6. Czy potrzebne są nowe Environment Variables

**Dla zmiany na IN-APP: NIE.** Google zachowuje dwa ustawienia już opisane w 1.6.0. Powiadomienia wewnętrzne używają istniejącej konfiguracji Firebase/Vercel i nie wymagają VAPID, FCM ani dodatkowego klucza Admin.

## 7. Dokładna lista Environment Variables

| Nazwa | Status w IN-APP | Miejsce i charakter |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Zachowana, wymagana dla dodatkowego logowania Google | Publiczny webowy OAuth Client ID, build Vite. |
| `GOOGLE_CLIENT_ID` | Zachowana, wymagana dla backendu Google | Ten sam OAuth Client ID, backend Vercel. |
| `VITE_FIREBASE_VAPID_KEY` | **OPCJONALNA, nieaktywna** | Może pozostać pusta lub zachowana wyłącznie do przyszłego etapu. Brak nie powoduje błędu. |

**Nowe wymagane ENV dla przejścia z 1.6.0 Web Push na IN-APP: brak.** Nie jest wymagany client secret Google, prywatny VAPID ani nowy klucz Admin. Zachowaj wszystkie `VITE_FIREBASE_*`, serwerowy `FIREBASE_PROJECT_ID`, dokładnie jeden z istniejących formatów Admin `FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_SERVICE_ACCOUNT_BASE64` oraz dotychczasowe ustawienia eduVULCAN/origin.

**Nie rotuj `EDUVULCAN_ENCRYPTION_KEY_BASE64`; nie zmieniaj key ID, projektu Firebase ani UID użytkowników.** Szablon `.env.example` zawiera wyłącznie publiczną konfigurację oraz puste pola sekretów.

## 8. Czy potrzebna jest konfiguracja Firebase Console

**Dla przejścia na IN-APP: nie trzeba włączać nowych usług ani planu.** Nie włączaj Blaze z powodu powiadomień, Firebase Functions, FCM, Web Push, Cloud Scheduler ani nowego projektu. Zachowaj bieżące Auth, Firestore i Storage.

Jeśli Google nie było skonfigurowane, pozostaje dotychczasowa instrukcja provider Google i autoryzowane domeny z punktu 9. Jeśli przygotowanych reguł 1.6.0 nie opublikowano, publikacja całego pakietu jest osobnym krokiem po akceptacji; IN-APP nie wymaga ich dalszego osłabienia. Nie wykonuj historycznego bootstrapu/migracji 1.3.3 w działającej produkcji 1.5.1.

Backend Admin tworzy własne kolekcje techniczne i inbox przy bezpiecznym działaniu; nie zakłada się ręcznie duplikatów profili. Warunki rozliczania już używanego Storage są niezależne od powiadomień i nie są obchodzone przez tę aktualizację.

## 9. Czy potrzebna jest konfiguracja Google Auth

**Tak.** Firebase Authentication → Sign-in method → Google: włączyć provider i wskazać e-mail wsparcia, zachowując dotychczasową metodę hasła. W tym samym projekcie Google Cloud odszukać webowy OAuth Client ID; można użyć klienta utworzonego przez Firebase.

W Authorized JavaScript origins dodać dokładną domenę `https://…` bez ścieżki. Zachować Firebase redirect URI `https://<dotychczasowy-authDomain>/__/auth/handler`. Przy testowym ekranie zgody OAuth dodać rodzinę jako użytkowników testowych. `VITE_GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_ID` muszą wskazywać ten sam klient. Nie tworzyć drugiego projektu Firebase lub drugich kont rodziny.

Pierwsze połączenie odbywa się po dotychczasowym logowaniu: Ustawienia → Konto i logowanie → Połącz Google. `linkWithPopup` działa na obecnym użytkowniku. Niepołączone Google nie uzyskuje nowego UID ani dostępu przez ekran logowania. Konflikty metod są obsługiwane bez zamiany kont. Szczegóły: [ACCOUNT_GOOGLE.md](ACCOUNT_GOOGLE.md).

## 10. Czy potrzebna jest konfiguracja Firebase Cloud Messaging / Web Push

**NIE.** Bieżąca aplikacja nie rejestruje tokenu FCM, nie żąda `Notification.requestPermission`, nie uruchamia Web Push i nie wysyła systemowych alertów po zamknięciu. Ustawienia informują, że powiadomienia systemowe są funkcją przyszłej aktualizacji.

Dzwonek/centrum czytają własny inbox z Firestore. Nowe alerty zapisuje backend Vercel, nie Functions. Katalog przygotowania do push pozostaje w paczce, lecz nie jest zależnością bieżącej aplikacji. Nie trzeba instalować `functions/`, dodawać targetu do `firebase.json` ani wdrażać Cloud Functions.

## 11. Czy potrzebny jest VAPID key

**NIE.** `VITE_FIREBASE_VAPID_KEY` jest opcjonalnym przygotowaniem do przyszłości i może być puste. Nie wpływa na zwykłe uruchomienie, logowanie, pobieranie eduVULCAN, dzwonek, ★ ani centrum. Nie generuj nowej pary kluczy z powodu IN-APP; nie zapisuj prywatnych kluczy w repozytorium.

## 12. Czy trzeba zmienić service worker

Wariant IN-APP nadal ma **jeden istniejący `/sw.js`** dla powłoki PWA, instalacji i kontrolowanej aktualizacji. Nie tworzy się `firebase-messaging-sw.js` ani drugiego workera. Bieżący worker nie uruchamia doręczania push ani systemowego `showNotification`; nie zapisuje danych szkolnych, sesji eduVULCAN ani dokumentów Zdrowia w cache powłoki.

Uaktualnienie PWA pobiera nową wersję workera zwykłym mechanizmem aktualizacji aplikacji. Przygotowany wcześniejszy kod przyszłego push może pozostać poza aktywną ścieżką builda, bez żądania VAPID lub zgody użytkownika.

## 13. Jak działa dźwięk powiadomień na desktopie

Wyłącznie w widocznej aplikacji, po geście użytkownika odblokowującym Web Audio. Nowy dozwolony wpis może odtworzyć około jednej sekundy łagodnego dzwonka. Dźwięk OFF, master OFF, wyłączona kategoria albo ukryta karta wyłączają odtwarzanie. Błąd lub blokada audio nie blokują wpisu w centrum. Nie ma dźwięku ani alertu systemowego przy zamkniętej aplikacji.

## 14. Jak działa na Androidzie

Widoczna aplikacja/przeglądarka/PWA używa tego samego krótkiego Web Audio po odblokowaniu gestem, w granicach wsparcia Chrome i ustawień systemu. IN-APP nie uruchamia kanału systemowego push i nie odtwarza dźwięku w tle. Nie omija wyciszenia, głośności ani „Nie przeszkadzać”.

## 15. Jak działa na iOS/PWA

Widoczna aplikacja w Safari lub zainstalowanej PWA może odtworzyć dzwonek po geście użytkownika, jeśli przeglądarka i ustawienia systemu pozwalają. Do IN-APP nie jest potrzebna zgoda na Web Push, wymaganie iOS 16.4 dla push ani instalacja PWA jako warunek dzwonka. Instalowalna PWA pozostaje. W tle i przy zablokowanym ekranie aplikacja nie odtwarza audio i nie pokazuje systemowego alertu.

## 16. Ograniczenia systemowe własnego dźwięku

Autoplay może być blokowane do czasu gestu, a przeglądarka może wstrzymać kartę lub audio. Tryb cichy, Focus i głośność systemu mają pierwszeństwo. W wariancie IN-APP nie próbuje się zastępować systemowego dźwięku ani uruchamiać Web Audio z workera w tle. Wpis w centrum i jego odczyt nie zależą od powodzenia dzwonka. Nie deklaruje się testu fizycznego dźwięku na każdym modelu telefonu.

## 17. Czy odpowiadanie eduVULCAN jest możliwe

**Odpowiadanie eduVULCAN: niemożliwe do wiarygodnego uruchomienia w tym etapie.** Portal może oferować wysyłanie, lecz obecny adapter nie ma potwierdzonego kontraktu identyfikatorów odbiorcy i wątku, formatów potwierdzeń oraz zachowania przy niejednoznacznym timeout. Publiczne trasy POST są przesłanką, nie dowodem działającego wysyłania na koncie rodziny.

Nie dodano przycisku udającego „Odpisz”, endpointu wysyłania ani wiadomości do nauczyciela. Pełny audyt i źródła: [EDUVULCAN_ODPOWIEDZI_AUDYT.md](EDUVULCAN_ODPOWIEDZI_AUDYT.md).

## 18. Wynik build

`npm run build`: **PASS**. TypeScript oraz Vite zbudowały bieżący wariant IN-APP. Vite wygenerował pojedynczy `/sw.js` (około 3 kB) bez aktywnego dostarczania Web Push. Istniejące ostrzeżenie o wielkości głównego pakietu JavaScript nie jest błędem builda.

Frontend i źródła E2E pozostały bajtowo identyczne przez cały przebieg 150 testów. Końcową poprawkę 7 plików backendu/integracji dotyczącą baseline objęto ponownym buildem, pełnymi 193 testami serwera i 7 realnymi integracjami emulatora. Nie zmieniła kontraktu UI/API ani wygenerowanego frontendu: `dist` pozostał bajtowo identyczny.

Instalacja `functions/` nie jest wymagana do builda, testów ani wdrożenia bieżącej aplikacji. Nie wdrożono Functions ani Vercel. Poprawny build nie jest potwierdzeniem produkcyjnego OAuth lub logowania do dziennika.

## 19. Wyniki testów

| Polecenie | Aktualny wynik IN-APP |
|---|---|
| `npm run test:unit` | **PASS — 8 plików, 68/68 testów** |
| `npm run test:server` | **PASS — 14 plików, 193/193 testów** |
| `npm run test:rules` | **PASS — 22/22** |
| `npm run test:e2e` | **PASS — 150/150, 75 Chromium + 75 WebKit** |
| Dodatkowa integracja z rzeczywistym Admin/Auth/Firestore/Storage emulatorów | **PASS — 7/7** |

Szczegółowe liczby unit/server pochodzą z pełnych przebiegów szczegółowych odpowiadających wymaganym skryptom. Dodatkową integrację uruchomiono na `tests/edu-storage.integration.mjs` oraz `tests/notification-inapp.integration.mjs`: prawdziwe tokeny emulatora rodziców, współdzielone szyfrowane połączenie, blokady/cooldown, przyszły zakres ucznia, bezpieczny import i tworzenie inbox z baseline bez Functions/outbox. Zestaw obejmuje 3 istniejące przypadki eduVULCAN i 4 przypadki IN-APP, w tym baseline sekcji po częściowym pobraniu i przesuwającym się zakresie planu.

Nowe testy obejmują aktywację aplikacji i próg 60 minut względem ostatniej **udanej** synchronizacji; brak synchronizacji przy zmianie modułu; ręczne pobranie; baseline; nową/zmienioną ocenę; powtórkę bez zmian → zero alertów; wiadomość rodzica bez dostępu dziecka; semantyczny plan bez technicznych metadanych; stabilne ID i deduplikację; start bez VAPID/Functions; brak żądania systemowej zgody. Pozaszkolne alerty sprawdzają własny UID, rzeczywiste źródła, preferencje, retry i ponowną kontrolę prywatności w transakcji zapisu inbox.

Końcowe rozszerzenie testów serwera/integracji sprawdza również baseline każdej sekcji po częściowym pobraniu: niedostępne oceny nie inicjalizują historii, późniejsze odzyskanie starych ocen jest ciche, a potwierdzona pusta lista umożliwia alert o następnej nowej ocenie. Potwierdzono również, że przesunięcie pobieranego zakresu dat planu nie powoduje alertów o historii nowego okna, a nowy rekord lub rzeczywista zmiana we wcześniej potwierdzonym zakresie daje właściwy alert. Rozszerzone testy backendu i realnej integracji emulatora zakończyły się powodzeniem.

Dotychczasowe testy kont i Google UID, danych, uprawnień, layoutu, composera i uploadu pozostają. Testy zachowanego przyszłego workera push są regresją nieaktywnego kodu, nie świadczą o używaniu FCM w tym wariancie.

Wszystkie testy Firebase używają wyłącznie lokalnego projektu `demo-nasza-rodzina` i syntetycznych fixture. Browser zastępuje odpowiedzi zewnętrznego portalu/API; nie jest to rzeczywiste logowanie rodziny do SP4 ani produkcyjny OAuth. FCM/Web Push nie jest uruchamiany, więc nie deklaruje się testu systemowego transportu.

## 20. Passed / failed

**Końcowy wynik: PASS, 0 FAIL.** Build, **68 unit**, **193 server**, **22 Rules**, **7 dodatkowych integracji** oraz pełne **150 E2E** zakończyły się powodzeniem. E2E wykonał po **75 testów** w Chromium i WebKit, bez pominiętych przypadków; czas **13,1 min**, kod wyjścia **0**. Nie dziedziczono wyniku ani liczby 136 E2E z wcześniejszej paczki Web Push.

Sprawdzono wszystkie wymagane scenariusze IN-APP i dotychczasowe funkcje. Końcowe testy obejmują też baseline dla poprawnie pustej sekcji, odzyskaną historię po częściowym błędzie, przesuwający się zakres planu oraz ponowne sprawdzenie prywatności źródła wewnątrz transakcji inbox. Kod Google, reguły oraz klucze zachowano bez zmian wobec poprzedniego pakietu 1.6.0.

Nie wykonywano produkcyjnego OAuth, logowania do eduVULCAN ani operacji na danych rodziny. Testy emulatora nie są deklaracją sprawdzenia fizycznego telefonu lub konta Google.

## 21. Znane ograniczenia i przekazanie pakietu

- Aplikacja **nie** synchronizuje ani nie wysyła systemowego push po zamknięciu. Nie ma godzinnego timera w tle; nowe dane szkolne pobiera dopiero aktywacja spełniająca próg 60 minut lub ręczna dozwolona synchronizacja.
- Działanie eduVULCAN wymaga ważnej istniejącej sesji. Wygaśnięcie wymaga ponownego połączenia przez istniejący bezpieczny formularz. Nie przechowuje się hasła, nie rotuje klucza ani nie usuwa wspólnej sesji z powodu UI.
- Dzwonek, centrum, ★ i preferencje pozostają. Dźwięk wymaga widocznej aplikacji, włączonej opcji i zgody przeglądarki na audio po geście; nie ma dźwięku w tle ani obchodzenia ustawień systemowych.
- Pozaszkolne odświeżenie Vercel inicjalizuje baseline osobno dla UID i źródła. Odczyty mają limit 500 rekordów na źródło i 768 KiB na dokument baseline; zbyt duży niepełny zakres jest pomijany zamiast generować fałszywe alerty. Czat używa okna 500 najnowszych wiadomości i nie traktuje starszej historii ponownie wchodzącej do okna jako nowej. Wynik endpointu raportuje pominięte zakresy. Nie ma cron przypomnień leków; istniejące lokalne przypomnienia w otwartym module Zdrowie pozostają.
- Nie wdrażaj katalogu `functions/`: zachowano go jedynie na przyszłość. Blaze/FCM/Web Push nie są zależnościami IN-APP. Bieżący backend Admin Vercel respektuje własność UID i uprawnienia źródłowych danych.
- Google działa zgodnie z poprzednim modelem samego UID. Produkcyjny ekran OAuth, domeny i zgody trzeba sprawdzić po osobno zaakceptowanej konfiguracji; nie tworzono nowych kont rodziny podczas testów.
- WebKit Playwright i kontrolowany `visualViewport` nie zastępują fizycznego iPhone'a ani wszystkich ustawień klawiatury/Focus. Pełne Chromium/WebKit przeszły pięć wymaganych szerokości/orientacji bez poziomego scrolla całej strony: 390×844, 844×390, 900×1440, 1024×768, 1440×900.
- ICS obsługuje implementowane reguły i wyjątki; nie jest pełną dwukierunkową synchronizacją każdego dostawcy. Nie eksportuje prywatnych wydarzeń innych UID.
- Metadane `schoolEnabled` / `canLogin` zachowują kompatybilne wartości dla starszych dokumentów, bez migracji zapisującej dane produkcji. Layla nie jest uczniem.

Podglądy w `preview/` używają wyłącznie syntetycznych danych emulatora i istniejących zdjęć. Galeria `preview/index.html` otwiera się lokalnie bez Firebase. Zweryfikowano komplet **17 PNG**. Widoki ustawień i centrum powiadomień zostały odświeżone na IN-APP; pozostałe przedstawiają zachowane funkcje. Starsze pliki podglądów historycznych pozostają poza galerią.

Poprawiony **pełny ZIP 1.6.0 IN-APP** zawiera `src/`, `public/`, `api/`, `server/`, zachowany nieaktywny `functions/`, konfigurację, lockfile, testy, dokumentację i podglądy. Nie zawiera `node_modules`, `dist`, `.env`, `.env.local`, klucza Admin, haseł, tokenów, prywatnych kluczy ani danych logowania eduVULCAN. `.env.example` ma wyłącznie publiczną konfigurację oraz puste sekrety/opcjonalny VAPID.

Przed publikacją należy zaakceptować nowy wariant IN-APP. **Nie wykonano push, wdrożenia Vercel ani publikacji Firebase.**
