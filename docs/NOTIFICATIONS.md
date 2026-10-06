# Powiadomienia Nasza Rodzina 1.6.0 — IN-APP z triggerami Functions

Aktualną konfigurację harmonogramu i Functions opisuje [EDUVULCAN_FUNCTIONS_HARMONOGRAM.md](EDUVULCAN_FUNCTIONS_HARMONOGRAM.md). [Poprzednia instrukcja IN-APP](POWIADOMIENIA_IN_APP_1.6.0.md) pozostaje historyczna: późniejsza decyzja użytkownika dodała serwerowy harmonogram i triggery, zachowując dostarczanie powiadomień wewnątrz aplikacji.

**Blaze i Firebase Functions są teraz wymagane dla harmonogramu działającego przy zamkniętej aplikacji. FCM/Web Push pozostają wyłączone.** Nie rejestruje się tokenu FCM, nie pyta o zgodę systemową, a brak `VITE_FIREBASE_VAPID_KEY` nie jest błędem. Zamknięta aplikacja może otrzymywać nowe wpisy w bazie, ale nie pokazuje powiadomienia systemowego ani nie odtwarza dźwięku. Wszystko pozostaje przygotowane lokalnie, bez wdrożenia.

## Tworzenie wpisów

Dzwonek, licznik nieprzeczytanych, centrum, gwiazdki i preferencje UID pozostają. Inbox tworzą wyłącznie autoryzowane backendy Vercel i Functions z Firebase Admin. Klient czyta własny `notificationInbox/{UID}/items` i może zmienić odczyt/gwiazdkę; nie może tworzyć dowolnej treści alertu. Nie otwarto reguł Firestore.

Nowa `familyMessages` ma trigger utworzenia dokumentu, więc po przyszłym wdrożeniu nie czeka na otwarcie aplikacji, odpytywanie ani harmonogram eduVULCAN. Trigger działa również dla prywatnej rozmowy, lecz otrzymują ją wyłącznie jej uprawnieni uczestnicy. Własna wiadomość nadawcy nie staje się jego nowym alertem. Ponowne dostarczenie tego samego zdarzenia nie tworzy drugiego wpisu.

Synchronizacja szkolna wykorzystuje istniejącą kanoniczną logikę diff, baseline i trwały dziennik zmian. Triggery `schoolItems`, `schoolParentMessages` i `schoolStudentMessages` respektują ten sam stan porównania oraz pomijają techniczne zmiany czasu importu/odczytu. Import oraz trigger Firestore nie mogą wytworzyć dwóch alertów dla tej samej informacji. Pierwsze pobranie historii jest ciche, osobno dla każdej faktycznie odczytanej sekcji; udana pusta lista także stanowi baseline. Przesunięcie okna dat planu nie jest samo w sobie zmianą planu.

Rodzice otrzymują wpisy zgodne z uprawnieniami do dzieci, a dziecko nie dostaje prywatnej skrzynki rodzica/nauczyciela. Backend ponownie sprawdza odbiorcę i preferencje; ograniczenia obowiązują również poza UI. Treść wpisu nie ujawnia nadmiernych szczegółów, a kliknięcie prowadzi do modułu z jego dotychczasowymi regułami dostępu.

Dotychczasowy autoryzowany `POST /api/notifications/refresh` i foreground hook pozostają dla pozaszkolnych danych. Functions korzystają ze wspólnego routingu/identyfikatorów, więc uruchomienie obu ścieżek nie tworzy podwójnego powiadomienia. Przypomnienia `medicineReminders` pozostają co 5 minut.

## Synchronizacja i dźwięk

eduVULCAN ma dwa zadania `Europe/Warsaw`: 08:00–14:50 co 10 minut oraz 15:00–07:00 o pełnej godzinie. Wywołanie nie oznacza wymuszonego pobrania: istniejący lease, uprawnienia, ważność sesji i atomowe ograniczenia 10/60 minut mogą je bezpiecznie pominąć. Ręczna synchronizacja i istniejące sprawdzenie przy aktywacji aplikacji pozostają, z dotychczasowym backendowym rate-limit.

Delikatny dźwięk działa wyłącznie w widocznej aplikacji po odblokowaniu Web Audio gestem użytkownika, jeżeli dźwięk i kategoria są ON. Brak audio, blokada autoplay albo OFF nie blokują samego wpisu. Nie odtwarza się dźwięku w tle ani nie omija wyciszenia/Focus. To samo dotyczy desktopu, Androida i iOS/PWA; nie dodano własnego dźwięku systemowego.

W Ustawienia → Powiadomienia systemowe push pozostają funkcją przyszłej aktualizacji. Nie dodano drugiego service workera ani zależności od VAPID. Aktualizacja nie zmienia Google Auth, UID rodziny ani istniejącego klucza szyfrującego eduVULCAN.
