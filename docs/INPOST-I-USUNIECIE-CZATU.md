# Paczki InPost i wyłączenie Czatu

## Zachowanie aplikacji

W Ustawieniach dorosły członek rodziny dodaje 24-cyfrowy numer przesyłki InPost Polska. Numer jest zapisywany na serwerze dla jego rodziny. Start pokazuje kafelek tylko wtedy, gdy istnieje aktywna przesyłka. Numer w kafelku jest skrócony do sześciu ostatnich cyfr. Widoczne są status, czas zdarzenia dostawcy, opcjonalny punkt odbioru i link do InPost. Zakończenie śledzenia lub końcowy status przewoźnika ukrywa przesyłkę. Nie przechowujemy kodów odbioru ani hasła InPost.

Brak dostępu API nie blokuje zapisu numeru: status jest jawnie niepotwierdzony, a użytkownik może otworzyć stronę przewoźnika. Nie ma automatycznego wykrywania paczek po telefonie lub koncie. Zapisana przesyłka nie jest dowodem, że dostawca już rozpoznaje jej numer.

## Oficjalny dostęp InPost

Sprawdzono 3 listopada 2026:

- [Tracking](https://developers.inpost-group.com/tracking): `GET /tracking/v1/parcels`, parametr `trackingNumbers`, do 10 numerów w żądaniu, uprawnienie `api:tracking:read`. Historia dostępna przez 121 dni. Integracja ustala wersję zdarzeń V1.
- [Authentication](https://developers.inpost-group.com/authentication): OAuth 2.1. Client ID i client secret wymagają przyznania dostępu przez zespół InPost. Backend tej jednej rodzinnej integracji używa Client Credentials. Dostęp do przesyłek zakupionych u różnych sprzedawców trzeba potwierdzić z InPost; samo posiadanie numeru nie gwarantuje uprawnienia API.
- Logowanie konta odbiorcy nie jest zaimplementowane. Oficjalny Authorization Code z PKCE wymaga rejestracji aplikacji i zgody InPost. Nie używamy nieoficjalnego API aplikacji mobilnej ani zapamiętywania haseł.
- [HTTP Status Codes](https://developers.inpost-group.com/http-status-codes): obsługujemy 429 oraz Retry-After. Publiczne sprawdzone strony nie określają liczbowego limitu żądań na sekundę/minutę; należy uzgodnić go podczas przyznawania dostępu. Limit 10 numerów na żądanie jest udokumentowany.
- [Webhooks](https://developers.inpost-group.com/webhooks-integration): konfiguracja przez opiekuna/zespół integracji InPost, HTTPS i uzgodnione uwierzytelnienie. Webhooki nie są aktywowane w tym wydaniu. Nie wystawiono niezabezpieczonego endpointu przyjmującego statusy.
- Sprawdzony schemat Tracking nie zawiera przewidywanej daty doręczenia, więc aplikacja jej nie wymyśla. Dodanie ETA wymaga potwierdzenia pola w umowie/schemacie dostawcy.

## Konfiguracja serwera

Wyłącznie produkcyjne zmienne serwera Vercel: `INPOST_CLIENT_ID`, `INPOST_CLIENT_SECRET`, `INPOST_ENVIRONMENT=production`, `INPOST_CRON_SECRET`. Nigdy nie używać prefiksu `VITE_` dla tych wartości. Istniejące uwierzytelnienie Firebase Admin i domena rodzinnego API są współdzielone z pozostałymi modułami.

Aktywne przesyłki są sprawdzane nie częściej niż co 3 godziny. Pusta lista ma następne sprawdzenie po 24 godzinach, bez bezcelowego zapytania do InPost. Dodanie pierwszej przesyłki uruchamia pierwszy odczyt; ponowne otwarcie strony nie omija serwerowego limitu. Błędy dostawcy zachowują ostatni status. Długie Retry-After może odsunąć sprawdzenie. Aktualizacja zakończonej przesyłki przełącza harmonogram na dobowy.

Dispatcher Cloud Scheduler uruchamia zabezpieczony endpoint co 15 minut, aby odebrać tylko zaplanowane zadania. To nie oznacza odpytywania InPost co 15 minut. Statusy są odczytywane po upływie 3h, z możliwym opóźnieniem do 15 minut. Przy otwartej aplikacji frontend odczytuje zapisany stan co 5 minut. Przy braku zapisanych numerów nie można odkryć nowych przesyłek, nawet przy sprawdzeniu dobowym.

## Bezpieczeństwo i dane

`_inpostFamilies` jest całkowicie niedostępne dla przeglądarki. Serwer sprawdza token Firebase z unieważnieniem, aktualny profil i familyId. Przeglądanie dotyczy własnej rodziny; dodawanie i archiwizowanie wymaga roli parent/adult. Nie przyjmuje familyId/UID od klienta. Zapytania są ograniczone do 20 aktywnych przesyłek i dwóch partii API. Transakcja Firestore ogranicza równoległe odpytywanie przez kilka urządzeń. Odpowiedzi nie są buforowane publicznie; sekrety i surowe dane odbiorcy nie trafiają do odpowiedzi.

Moduł Czat usunięto z routingu, nawigacji, Start i ekranu logowania. Start i mechanizm powiadomień nie nasłuchują wiadomości. Stare alerty czatu są ukryte bez usuwania ich dokumentów. Zapis nowych wiadomości, reakcji i potwierdzeń oraz usuwanie historii są zabronione regułami. Historia pozostaje dostępna według dotychczasowych uprawnień, bez poszerzenia widoczności prywatnych rozmów. Obsolete identyfikatory w preferencjach układu pozostają dla zgodności, bez kafelka Czatu.

Reguły wdrożenia w `deploy/inpost/firestore.rules` powstały jako minimalna zmiana rzeczywiście aktywnych reguł, aby nie nadpisać innych modułów różniącymi się regułami roboczymi repozytorium. Zmiany reguł należy nadal poddawać przeglądowi przed rozszerzaniem dostępu do aplikacji.

## Weryfikacja

Testy logiki obejmują walidację numerów, brak tokenu, OAuth i partie po 10, kolejność zdarzeń, stany końcowe, 429, zachowanie starych danych po awarii, zapis/archiwizację, rodzinę i role, Preview oraz odstępy 3h/24h. Test na prawdziwym emulatorze Firestore sprawdza izolację rodzin i pojedyncze odpytanie przy pięciu równoległych odczytach. Test reguł sprawdza zakaz bezpośredniego dostępu do paczek oraz zachowanie historii i zakaz zapisu czatu. Test przeglądarkowy z kontrolowaną odpowiedzią API sprawdza dodawanie, ponowny odczyt po przeładowaniu, ukrywanie kafelka i widoki 390/1024px. Rzeczywiste statusy InPost wymagają poświadczeń i przesyłki dostępnej dla przyznanego konta API.
