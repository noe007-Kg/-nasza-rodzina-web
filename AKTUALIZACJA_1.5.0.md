# Aktualizacja na Twoim GitHub, Vercel i Firebase

Użyj paczki **Nasza_Rodzina_v1.5.0_PROJEKT.zip**. Rozpakuj ją i otwórz folder `Nasza_Rodzina_v1.5.0`. Do repozytorium wysyłasz jego **zawartość**, a nie kolejny folder otaczający cały projekt.

## 1. GitHub: podmień pełny projekt

W repozytorium `noe007-Kg/-nasza-rodzina-web` zaktualizuj wszystkie pliki z paczki. W szczególności potrzebne są:

| Folder lub plik | Do czego służy |
| --- | --- |
| `src/` | Aplikacja, menu, kolorystyka, formularz połączenia i widok Szkoła |
| `public/` | Twoje logo, ikony, manifest i pozostałe publiczne zasoby |
| `api/` | Pięć funkcji serwerowych połączenia z dziennikiem |
| `server/` | Logowanie, odczyt dziennika, szyfrowanie i zapis do Firebase |
| `package.json`, `package-lock.json` | Zależności aplikacji i backendu |
| `vercel.json`, `vite.config.ts` | Konfiguracja budowania i funkcji Vercel |
| `index.html`, pliki `tsconfig*.json` | Uruchamianie i kompilacja interfejsu |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json` | Uprawnienia i konfiguracja Firebase |

Pozostałe pliki z paczki to instrukcje, testy i narzędzia administracyjne — również mogą znajdować się w repozytorium. Nie wysyłaj `node_modules`, `dist`, `.env.local`, prywatnego klucza Firebase ani hasła do eduVULCAN.

## 2. Firebase: opublikuj nowe reguły

W konsoli swojego projektu Firebase otwórz **Firestore Database → Reguły**, wklej zawartość `firestore.rules` i opublikuj. Następnie w **Storage → Reguły** opublikuj `storage.rules`.

Reguły trzeba zaktualizować również wtedy, gdy masz już wersję 1.4.x. Chronią one zapisane sesje, importowane wpisy oraz wiadomości dostępne wyłącznie rodzicom. Jeśli przechodzisz z 1.3.3, wykonaj również przygotowanie profili i migrację opisane w [docs/FIREBASE.md](docs/FIREBASE.md).

## 3. Vercel: ustaw konfigurację backendu

W projekcie Vercel otwórz **Settings → Environment Variables** i dodaj do środowiska Production:

- `FIREBASE_PROJECT_ID` — identyfikator Twojego projektu Firebase.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — prywatny klucz konta usługi z Firebase; pełna zawartość JSON. Alternatywą jest `FIREBASE_SERVICE_ACCOUNT_BASE64`.
- `EDUVULCAN_ENCRYPTION_KEY_BASE64` — nowy losowy klucz szyfrowania, wygenerowany według instrukcji.

Tych zmiennych nie poprzedzaj `VITE_`. To klucze serwera. Zachowaj istniejące publiczne zmienne `VITE_FIREBASE_*` swojej aplikacji.

Dokładne kroki uzyskania klucza Firebase i wygenerowania klucza szyfrowania są w [docs/VULCAN.md](docs/VULCAN.md). Konfiguracja projektu: **Vite**, Node **22.x**, instalacja `npm ci`, budowanie `npm run build`, wynik `dist`. Po ustawieniu zmiennych wykonaj **Redeploy**.

## 4. Połącz dziennik na swojej stronie

Zaloguj się do Naszej Rodziny jako rodzic, otwórz **Szkoła → eduVULCAN** i wpisz dane logowania bezpośrednio w formularzu. Pobierz listę dzienników, wskaż **Nikodem Połoński (SP4)** i przypisz go do **Nikodema** w aplikacji. Pierwsze pobranie uruchamia się po potwierdzeniu wyboru. Kolejne uruchamiasz przyciskiem **Odśwież dane**.

Paczka **STRONA** zawiera wyłącznie gotowy interfejs do hostingu statycznego. Do pobierania eduVULCAN potrzebujesz pełnej paczki **PROJEKT** i funkcji Vercel. Kod integracji jest przygotowany; skuteczne połączenie z rzeczywistym kontem rodziny wymaga sprawdzenia po wdrożeniu i wpisaniu danych logowania.
