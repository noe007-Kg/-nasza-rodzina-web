# Audyt odpowiadania na wiadomości eduVULCAN

Data audytu: 2 października 2026. Zakres: obecny adapter Naszej Rodziny 1.5.1, zapisane publiczne źródła protokołu oraz modele wiadomości. Nie użyto danych logowania rodziny, nie uruchomiono wysyłania i nie zmieniono zapisanej sesji.

**Odpowiadanie eduVULCAN: niemożliwe do wiarygodnego uruchomienia w tym etapie.** Nie oznacza to, że sam portal nie ma tej funkcji. Istnieją publiczne przesłanki obsługi wysyłania, ale nie ma kompletnego, potwierdzonego kontraktu pozwalającego tej integracji poprawnie zaadresować odpowiedź i potwierdzić jej dostarczenie.

## Co znaleziono

Publiczna, przypięta wersja [PrometheusMessagesApi.kt](https://github.com/szponciciel04/DzienniczekSzpontniczek/blob/73d35c3d4a331fe009919004df860c9e97067374/composeApp/src/commonMain/kotlin/io/github/szpontium/api/prometheus/PrometheusMessagesApi.kt) zawiera:

| Operacja | Trasa | Ustalenie |
| --- | --- | --- |
| Nowa wiadomość | `POST /{tenant}/api/WiadomoscNowa` | W źródle istnieje metoda `sendMessage`. |
| Odpowiedź / przekazanie | `POST /{tenant}/api/WiadomoscOdpowiedzPrzekaz` | W źródle istnieje metoda `replyForwardMessage`. |
| Wysłane wiadomości | `GET /{tenant}/api/WyslaneSkrzynka` | Może być częścią późniejszej weryfikacji, ale brak potwierdzonego powiązania odpowiedzi z konkretnym żądaniem. |
| Skrzynki | `GET /{tenant}/api/Skrzynki` | Obecny adapter odczytuje skrzynki konta i sprawdza własną skrzynkę profilu. To nie jest potwierdzona książka adresowa nauczycieli. |
| Treść odebranej wiadomości | `GET /{tenant}/api/WiadomoscSzczegoly` | Obecna integracja używa tej trasy wyłącznie do odczytu. |

Model [PrometheusSendMessage](https://github.com/szponciciel04/DzienniczekSzpontniczek/blob/73d35c3d4a331fe009919004df860c9e97067374/composeApp/src/commonMain/kotlin/io/github/szpontium/api/prometheus/models/PrometheusMessage.kt) wymaga `globalKey`, `watekGlobalKey`, `nadawcaSkrzynkaGlobalKey`, `adresaciSkrzynkiGlobalKeys`, `tytul`, `tresc`; zawiera też pola odpowiedzi/przekazania. Żądania używają sesji cookies, `X-V-AppGuid` i `X-V-RequestVerificationToken`.

## Dlaczego nie dodano przycisku „Odpisz”

1. `server/edu-provider.mjs` pobiera odebrane wiadomości i ich treść, ale nie ustala zweryfikowanych identyfikatorów skrzynek odbiorców ani kompletnej tożsamości wątku potrzebnej do odpowiedzi. Nazwa nadawcy lub tekst `korespondenci` nie wystarcza do adresowania.
2. `server/edu-normalize.mjs` zapisuje lokalne wpisy do odczytu. Nie wolno wyprowadzać identyfikatorów odbiorców z imion, treści lub lokalnych ID Firestore.
3. Przytoczona publiczna metoda POST nie analizuje wyniku wysyłania. Nie potwierdza wymaganego formatu potwierdzenia, statusów błędów, deduplikacji ani zachowania po timeout, gdy wiadomość mogła już zostać wysłana.
4. Nie wykonano autoryzowanego testu wysłania na koncie rodziny. Same testy z atrapą nie dowodzą zgodności bieżącego portalu i uprawnień skrzynki.

Nie dodano backendowego endpointu wysyłania, nie wysłano wiadomości do nauczycieli, nie oznaczano wiadomości jako przeczytanych w portalu, nie zmieniono uprawnień ani szyfrowania. Wspólna sesja rodziców i klucz `EDUVULCAN_ENCRYPTION_KEY_BASE64` pozostały bez zmian. Gwiazdka „ważne” jest lokalną preferencją UID użytkownika Naszej Rodziny, a nie zmianą wiadomości w dzienniku.

## Co byłoby potrzebne do rzeczywistego wdrożenia

Potwierdzony kontrakt dla bieżącej wersji portalu: identyfikatory odbiorców i wątku, uprawnienia własnej skrzynki, format odpowiedzi na POST oraz mechanizm weryfikacji wyniku i zapobiegania ponownemu wysłaniu po niejednoznacznym timeout. Następnie bezpieczny endpoint backendu z autoryzacją rodzica, ścisłą kontrolą adresata i testem na autoryzowanym koncie testowym. Sesja i tokeny pozostałyby wyłącznie na backendzie.

Na tym etapie nie są wymagane nowe zmienne środowiskowe dotyczące odpowiadania eduVULCAN.
