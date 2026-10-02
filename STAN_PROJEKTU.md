# Co jest gotowe w Naszej Rodzinie 1.5.0

Główna aplikacja i obecna warstwa wizualna są przygotowane do wdrożenia. Kolorystyka odpowiada przesłanemu wzorowi, a oryginalne logo jest używane w interfejsie i ikonach. Układ dopasowuje się do telefonu, tabletu i komputera, w pionie i poziomie.

## Działające funkcje

Logowanie i role rodziny, kalendarz, zadania i zatwierdzanie punktów, zakupy, rodzinny i prywatny czat, zdrowie z dokumentami, szkolny organizer z importem, profile rodziny, ustawienia, eksport kalendarza oraz PWA. Bieżące i wcześniejsze wyniki sprawdzeń opisuje `RAPORT_TESTOW.md`.

Wersja 1.5.0 dodaje kod backendu Vercel i panel połączenia eduVULCAN: autoryzację aktywnego rodzica, szyfrowane sesje, jawny wybór profilu SP4 i dziecka, odświeżanie na żądanie oraz odłączenie. Wiadomości pobrane z konta rodzica zapisuje osobno z dostępem wyłącznie rodziców. **Nie potwierdzono udanego logowania ani pobrania danych z rzeczywistego konta rodziny.**

## Uruchomienie na Twoim adresie

Pozostaje opublikowanie pełnego projektu przez GitHub/Vercel oraz sprawdzenie ustawień Twojego produkcyjnego Firebase. Przy przechodzeniu ze starej wersji potrzebne są profile, migracja danych, reguły i CORS; nowe reguły 1.5.0 należy opublikować również przy aktualizacji z 1.4.x. Integracja wymaga ponadto klucza Firebase Admin i klucza szyfrowania w serwerowych zmiennych Vercel. Sam statyczny ZIP uruchamia organizer bez backendu. Paczki nie zostały automatycznie wdrożone. Kroki: `START_TUTAJ.md`, `docs/FIREBASE.md`, `docs/WDROZENIE.md`, `docs/VULCAN.md`.

## Części, które nie mają pełnej automatyzacji

- **eduVULCAN:** jest kod połączenia i pobierania na żądanie, ale wymaga konfiguracji Vercel oraz weryfikacji logowania, listy placówek i zakresu danych na rzeczywistym koncie SP4. Sesja wygasa najpóźniej po 24 godzinach; bez zapisanego hasła rodzic łączy ją ponownie. Nie ma harmonogramu pobierania ani wysyłania wiadomości do nauczycieli. Ręczne wpisy i import pozostają dostępne. Szczegóły: `docs/VULCAN.md`.
- **Przypomnienia o lekach:** działają przy otwartej zakładce Zdrowie i ze zgodą przeglądarki. Nie ma gwarantowanych alarmów systemowych po zamknięciu aplikacji.
- **Sprawdzenie produkcji:** lokalne testy Chromium/WebKit i emulatorów nie zastępują sprawdzenia wdrożonej strony z Twoimi rzeczywistymi kontami na Chrome/Safari i urządzeniach rodziny.
