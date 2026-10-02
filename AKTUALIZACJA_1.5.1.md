# Aktualizacja 1.5.0 → 1.5.1: wspólne połączenie eduVULCAN

Poprawka udostępnia aktywnym rodzicom **jedno wspólne połączenie dziennika**, zamiast osobnej sesji dla każdego UID rodzica. W Naszej Rodzinie logujesz się jako Sebastian albo Dominika; w formularzu eduVULCAN podajesz dane aktywnego konta Dominiki i wybierasz Nikodema/SP4. Oba konta aplikacji z rolą `parent` korzystają potem ze wspólnego statusu, synchronizacji i pobranych danych.

Nie wykonano `git push` ani publikacji na Vercel/Firebase. Nie używano rzeczywistych danych logowania ani kodów aktywacyjnych rodziny. Wygląd pozostałych modułów pozostaje zachowany.

## Co uaktualnić

Użyj pełnej paczki **Nasza_Rodzina_v1.5.1_PROJEKT.zip**. Do głównego katalogu repozytorium `noe007-Kg/-nasza-rodzina-web` wgraj zawartość folderu `Nasza_Rodzina_v1.5.1`, z `api/` i `server/`. `package.json` musi pozostać w katalogu ustawionym w Vercel jako **Root Directory**.

Zmiany dotyczą autoryzacji i zakresu połączenia w `server/`, panelu `src/EduVulcanConnection.tsx`, reguł Firestore, testów oraz dokumentacji. Pozostałe moduły i ich style nie są zmienione. Lista plików kodu tej poprawki:

| Plik | Zmiana |
| --- | --- |
| `server/edu-auth.mjs` | Weryfikacja użytkownika Firebase, aktywnego profilu i roli bez porównywania wyświetlanej nazwy rodzica. |
| `server/edu-access.mjs` | Nowe rozdzielenie wspólnego połączenia rodziny i własnego zakresu ucznia. |
| `server/edu-http.mjs` | Autoryzacja żądań w konkretnym zakresie połączenia. |
| `server/edu-service.mjs` | Wspólne logowanie, status, wybór ucznia, synchronizacja i rozłączenie. |
| `server/edu-storage.mjs` | Zapis wspólnej sesji, szyfrowanie i blokady połączenia, usuwanie starych sesji rodziców oraz odmowa importu wiadomości do zakresu ucznia. |
| `server/edu-provider.mjs` | Przekazanie i sprawdzenie szkolnej tożsamości wybranego ucznia oraz pominięcie wiadomości w zakresie ucznia. |
| `src/EduVulcanConnection.tsx` | Formularz i przyciski połączenia oraz wspólny status i wybrany uczeń. |
| `src/main.tsx` | Wyłącznie wyświetlany numer wersji: 1.5.1. |
| `firestore.rules` | Prywatność sesji i powiązań oraz wiadomości dostępnych wyłącznie właścicielowi konta ucznia. |
| `package.json`, `package-lock.json` | Numer wydania 1.5.1; zależności pozostają bez zmian. |

Testy i dokumentacja również są dołączone do pełnej paczki. Pliki `api/eduvulcan/*.mjs` wykorzystują zmienione wspólne funkcje serwera i nie wymagają osobnego przepisywania ścieżek.

Pełna lista wszystkich zmienionych, dodanych i usuniętych plików względem paczki 1.5.0: [ZMIENIONE_PLIKI_1.5.1.txt](ZMIENIONE_PLIKI_1.5.1.txt).

Nie wysyłaj `node_modules`, `dist`, `.env.local`, klucza Firebase Admin, haseł ani tokenów. `package.json` i `package-lock.json` zawierają numer 1.5.1; aktualizacja nie wymaga nowych zależności.

## Firebase

1. W **Authentication → Users** sprawdź rzeczywiste UID kont Sebastiana i Dominiki w Naszej Rodzinie.
2. Każdy z tych UID musi mieć dokument `members/{UID}` z `role: parent`, `active: true` i `canLogin: true`. Nie nadajemy roli na podstawie nazwiska, e-maila ani podobieństwa nazwy rodzica do nazwiska ucznia.
3. Opublikuj `firestore.rules` z tej paczki, również przy aktualizacji z 1.5.0. Chronią wspólną sesję i przygotowany odrębny zakres ucznia. Publikacja w Vercel sama nie aktualizuje reguł Firebase. `storage.rules` pozostają bez zmian względem 1.5.0.

Autoryzacja backendu wymaga zweryfikowanego tokenu Firebase i aktywnego profilu rodzica. Pola wyświetlanej nazwy nie stanowią dodatkowego warunku uprawnienia do połączenia rodzinnego.

## Dokładnie jakie Environment Variables w Vercel

**Nowe zmienne wymagane przy aktualizacji z 1.5.0: żadne.** Zachowaj istniejące wartości; nie generuj nowego klucza szyfrowania tylko z powodu tej poprawki.

Jeżeli backend 1.5.0 nie był jeszcze skonfigurowany, w **Vercel → Settings → Environment Variables → Production** ustaw dotychczasowe wymagane zmienne:

| Zmienna | Wartość |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Identyfikator używanego projektu Firebase, zgodny z publicznym `VITE_FIREBASE_PROJECT_ID` i `project_id` klucza konta usługi. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` **albo** `FIREBASE_SERVICE_ACCOUNT_BASE64` | Dokładnie jeden wariant: cały prywatny JSON Firebase Admin albo ten sam plik zakodowany w base64. |
| `EDUVULCAN_ENCRYPTION_KEY_BASE64` | Losowy klucz 32-bajtowy zakodowany w base64. Jeśli już istnieje, zachowaj go. |

Dotychczasowe ustawienia opcjonalne także nie zmieniają się:

| Zmienna | Domyślna wartość i znaczenie |
| --- | --- |
| `EDUVULCAN_ENCRYPTION_KEY_ID` | `v1`; identyfikator używanego klucza. |
| `EDUVULCAN_SESSION_TTL_HOURS` | `24`; czas dostępu sesji większy od 0 i nieprzekraczający 24 godzin. |
| `EDUVULCAN_SITE_ORIGIN` | Puste: porównanie origin z hostem żądania. Możesz ustawić dokładny adres aplikacji, np. `https://twoja-rodzina.vercel.app`, bez ścieżki. |

Nie dodawaj przedrostka `VITE_` do żadnego sekretu serwerowego. Nie ustawiaj w Vercel loginu, hasła, UID rodziców, tokenu eduVULCAN ani kodu aktywacyjnego. Publiczne `VITE_FIREBASE_*` pozostają bez zmian. Szczegóły utworzenia kluczy: [docs/VULCAN.md](docs/VULCAN.md).

## Wdrożenie i pierwsze połączenie

1. W Vercel zachowaj konfigurację: **Vite**, Node **22.x**, instalacja `npm ci`, budowanie `npm run build`, wynik `dist`.
2. Gdy zdecydujesz się opublikować poprawkę, zapisz zmiany w gałęzi połączonej z Vercel. Po zapisaniu zmiennych środowiskowych wykonaj **Redeploy**. Przygotowanie tej paczki nie wykonuje tego za Ciebie.
3. Po statusie **Ready** sprawdź numer **1.5.1** na stronie. Zaloguj się kontem Sebastiana albo Dominiki i otwórz **Szkoła → eduVULCAN → Połącz konto**.
4. Wpisz login/e-mail i hasło aktywnego konta eduVULCAN Dominiki; wybierz **Połącz**. Hasło jest używane tylko w tej próbie logowania. Nie jest zapisywane w Firestore ani w kodzie klienta.
5. Wybierz jawnie **Nikodem Połoński (SP4)** i przypisz profil do **Nikodema** w Naszej Rodzinie. Pomiń przedszkole. Potwierdzenie profilu rozpocznie pierwszą synchronizację.
6. Zaloguj się drugim kontem rodzica i użyj **Sprawdź stan połączenia**. Powinieneś zobaczyć wspólny status, Nikodema i datę ostatniej udanej synchronizacji bez ponownego wpisywania hasła.
7. **Synchronizuj teraz** uruchamia pobranie danych; udane synchronizacje mają wspólny limit 5 minut. **Rozłącz** usuwa zapisaną wspólną sesję dla obu rodziców, zachowując pobrane dane szkolne.

Po przejściu z 1.5.0 połącz dziennik **raz ponownie**. Dawne sesje przypisane do UID rodziców nie są automatycznie uznawane za wspólną sesję. Przy połączeniu zostaną uporządkowane; historia pobranych danych pozostanie zachowana. Zapisana sesja wygasa najpóźniej po 24 godzinach i wtedy wymaga ponownego podania danych logowania.

Zakres przyszłego własnego połączenia ucznia jest przygotowany na serwerze i ograniczony do jego zatwierdzonej tożsamości szkolnej. Formularz dla konta dziecka nie jest jeszcze włączony. Nie daje dostępu do rodzinnej sesji ani wiadomości rodziców. **Pobieranie wiadomości w zakresie ucznia pozostaje wyłączone**, dopóki adapter nie potwierdzi roli właściciela skrzynki w eduVULCAN. Przygotowane reguły odrębnej przyszłej skrzynki ucznia dopuszczają wyłącznie tego ucznia, bez dostępu rodziców i rodzeństwa.

Wyniki sprawdzeń: [RAPORT_TESTOW.md](RAPORT_TESTOW.md). Połączenia z rzeczywistym kontem rodziny nie zweryfikowano; sprawdź je po wdrożeniu we własnym formularzu.
