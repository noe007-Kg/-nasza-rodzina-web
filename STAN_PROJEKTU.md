# Co jest gotowe w Naszej Rodzinie 1.5.1

Główna aplikacja i obecna warstwa wizualna są przygotowane do wdrożenia. Kolorystyka odpowiada przesłanemu wzorowi, a oryginalne logo jest używane w interfejsie i ikonach. Układ dopasowuje się do telefonu, tabletu i komputera, w pionie i poziomie.

## Działające funkcje

Logowanie i role rodziny, kalendarz, zadania i zatwierdzanie punktów, zakupy, rodzinny i prywatny czat, zdrowie z dokumentami, szkolny organizer z importem, profile rodziny, ustawienia, eksport kalendarza oraz PWA. Bieżące i wcześniejsze wyniki sprawdzeń opisuje `RAPORT_TESTOW.md`.

Wersja 1.5.1 poprawia backend Vercel i panel eduVULCAN: aktywni rodzice mają jedno wspólne połączenie. Sebastian i Dominika mogą zarządzać sesją oraz widzieć dane Nikodema/SP4 pobrane przy użyciu aktywnego konta eduVULCAN Dominiki. Uprawnienie wynika z roli `parent` w zweryfikowanym profilu Firebase; pełne imię i nazwisko rodzica nie jest warunkiem tego dostępu. Panel zawiera formularz połączenia, sprawdzenie stanu, synchronizację i rozłączenie; pokazuje ucznia i ostatni udany odczyt. Wiadomości pobrane z konta rodzica zapisuje osobno z dostępem wyłącznie rodziców. **Nie potwierdzono udanego logowania ani pobrania danych z rzeczywistego konta rodziny.**

Na serwerze przygotowany jest także osobny zakres połączenia ucznia, ograniczony do jego szkolnej tożsamości zatwierdzonej przez rodzica. Nie używa wspólnej sesji rodziców ani ich skrzynki. Formularz ucznia nie jest obecnie włączony w interfejsie.

## Uruchomienie na Twoim adresie

Pozostaje opublikowanie pełnego projektu przez GitHub/Vercel oraz sprawdzenie ustawień Twojego produkcyjnego Firebase. Przy przechodzeniu ze starej wersji potrzebne są profile, migracja danych, reguły i CORS; opublikuj reguły dołączone do tej paczki. Integracja wymaga klucza Firebase Admin i klucza szyfrowania w serwerowych zmiennych Vercel. **Aktualizacja z 1.5.0 nie wymaga żadnych nowych zmiennych środowiskowych**; zachowaj dotychczasowe wartości i połącz dziennik raz ponownie. Sam statyczny ZIP uruchamia organizer bez backendu. Nie wykonano `git push` ani wdrożenia. Kroki: `AKTUALIZACJA_1.5.1.md`, `START_TUTAJ.md`, `docs/FIREBASE.md`, `docs/WDROZENIE.md`, `docs/VULCAN.md`.

## Części, które nie mają pełnej automatyzacji

- **eduVULCAN:** jest kod połączenia i pobierania na żądanie, ale wymaga konfiguracji Vercel oraz weryfikacji logowania, listy placówek i zakresu danych na rzeczywistym koncie SP4. Sesja wygasa najpóźniej po 24 godzinach; bez zapisanego hasła rodzic łączy ją ponownie. Nie ma harmonogramu pobierania ani wysyłania wiadomości do nauczycieli. Ręczne wpisy i import pozostają dostępne. Szczegóły: `docs/VULCAN.md`.
- **Przypomnienia o lekach:** działają przy otwartej zakładce Zdrowie i ze zgodą przeglądarki. Nie ma gwarantowanych alarmów systemowych po zamknięciu aplikacji.
- **Sprawdzenie produkcji:** lokalne testy Chromium/WebKit i emulatorów nie zastępują sprawdzenia wdrożonej strony z Twoimi rzeczywistymi kontami na Chrome/Safari i urządzeniach rodziny.
