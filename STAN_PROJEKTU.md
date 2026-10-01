# Co jest gotowe w Naszej Rodzinie 1.4.2

Główna aplikacja i obecna warstwa wizualna są przygotowane do wdrożenia. Kolorystyka odpowiada przesłanemu wzorowi, a oryginalne logo jest używane w interfejsie i ikonach. Układ dopasowuje się do telefonu, tabletu i komputera, w pionie i poziomie.

## Działające funkcje

Logowanie i role rodziny, kalendarz, zadania i zatwierdzanie punktów, zakupy, rodzinny i prywatny czat, zdrowie z dokumentami, szkolny organizer z importem, profile rodziny, ustawienia, eksport kalendarza oraz PWA. Bieżące i wcześniejsze wyniki sprawdzeń opisuje `RAPORT_TESTOW.md`.

## Uruchomienie na Twoim adresie

Pozostaje opublikowanie plików przez GitHub/Vercel oraz sprawdzenie ustawień Twojego produkcyjnego Firebase. Przy przechodzeniu ze starej wersji potrzebne są profile z właściwymi rolami, migracja danych, reguły i CORS. Paczki nie zostały automatycznie wdrożone do Twojej strony. Kroki: `START_TUTAJ.md`, `docs/FIREBASE.md`, `docs/WDROZENIE.md`.

## Części, które nie mają pełnej automatyzacji

- **eduVULCAN:** nie ma automatycznego pobierania ocen, planu i wiadomości. Szkoła działa jako organizer z ręcznym wpisywaniem i importem w formacie aplikacji. Potwierdzony sposób połączenia i osobny backend wymagają dalszej pracy; `docs/VULCAN.md` opisuje stan integracji.
- **Przypomnienia o lekach:** działają przy otwartej zakładce Zdrowie i ze zgodą przeglądarki. Nie ma gwarantowanych alarmów systemowych po zamknięciu aplikacji.
- **Sprawdzenie produkcji:** lokalne testy Chromium/WebKit i emulatorów nie zastępują sprawdzenia wdrożonej strony z Twoimi rzeczywistymi kontami na Chrome/Safari i urządzeniach rodziny.
