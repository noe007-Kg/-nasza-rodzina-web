# Fryderyk — potwierdzony stan analizy

Portal rodzica: https://psmkolobrzeg.fryderyk.edu.pl.

8 października 2026 wykonano pojedynczy anonimowy GET publicznej strony z normalną konfiguracją sieci środowiska. Odpowiedź: HTTP 403; tytuł HTML: `Attention Required! | Cloudflare`. Nie otrzymano formularza logowania. Nie wykonywano logowania, automatycznego rozwiązywania wyzwań, zmiany tożsamości sieciowej ani obchodzenia blokady. Sama ta odpowiedź nie dowodzi, jakie CAPTCHA/MFA występuje po zwykłym zalogowaniu ani jaka jest polityka mobilnego API.

Użytkownik potwierdził:

- brak widocznej opcji eksportu ICS/iCal;
- obecność „Dostęp mobilny” / „Wygeneruj dane logowania”.

Oficjalna instrukcja szkolna: https://www.gov.pl/attachment/5032c977-9ade-4656-a339-1e95508c6c8a. Opisuje parowanie aplikacji mobilnej przez QR lub wygenerowane dane, ważne przez 30 minut. To czas użycia danych do sparowania, a nie udokumentowany TTL późniejszej sesji. Instrukcja nie dokumentuje protokołu API planu i odnowienia sesji.

Nie przekazano ani nie zapisano kodu, hasła, QR, cookie lub tokenu rodzica. Nie ma jeszcze wiarygodnej podstawy do pokazania działającego połączenia, importowania planu lub dodania produkcyjnego schedulera Fryderyka.

## Co wymaga potwierdzenia przed implementacją

1. Wspierany przez dostawcę sposób parowania mobilnego oraz zakres udzielanej autoryzacji.
2. Endpoint i schema planu: stabilne ID, dzień, godziny, sala i nauczyciel.
3. Jawny status odwołania i identyfikacja rzeczywistych zmian; brak rekordu nie będzie domyślnie traktowany jako odwołanie.
4. Odnawianie sesji i rzeczywiste sygnały jej unieważnienia, bez zapisywania głównego hasła.
5. Uprawnienia użytkownika oraz warunki dostawcy dotyczące integracji.

Potrzebna jest dokumentacja dostawcy albo bezpieczna, uprawniona obserwacja działania oficjalnej aplikacji/portalu. Nie należy wysyłać tutaj surowego HAR, nagłówków autoryzacyjnych ani danych parowania. Samo istnienie mobilnego dostępu nie potwierdza publicznego API.

## Plan po potwierdzeniu protokołu

- Oddzielny adapter i połączenie Fryderyka, bez zmian SP4.
- Uczeń przypisany przez istniejący profil oraz zweryfikowaną zewnętrzną tożsamość, zamiast sprawdzania imienia.
- Zaszyfrowana aktualna sesja przechowywana wyłącznie przez backend; osobne scope/lease, stabilne identyfikatory i baseline.
- Najpierw plan w osobnej sekcji Szkoły i testy danych, dopiero potem projekcja do wspólnego kalendarza.
- Odwołane zajęcia pozostają jako `ODWOŁANE`.
- Docelowy, jeszcze nieutworzony harmonogram: `0 8-18 * * *`, `Europe/Warsaw`, oraz ręczne „Synchronizuj teraz”.

Stan: audyt częściowy; rzeczywiste połączenie i scheduler Fryderyka NIE są zaimplementowane. Nie zmieniono chmury ani danych produkcyjnych.
