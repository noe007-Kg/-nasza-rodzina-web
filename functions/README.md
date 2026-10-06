# Firebase Functions — harmonogram eduVULCAN i inbox IN-APP

Ten katalog jest aktywnym codebase **`nasza-rodzina`** w `firebase.json`, ze źródłem `functions` i runtime `nodejs22`. To przygotowana konfiguracja; **nie wykonano commit, push ani żadnego wdrożenia**. Uruchomienie funkcji w chmurze wymaga planu Blaze oraz osobnej zgody na późniejsze wdrożenie.

## Zakres

- Dwa harmonogramy eduVULCAN w `Europe/Warsaw`: `*/10 8-14 * * *` oraz `0 0-7,15-23 * * *`. Nie ma wywołania co 10 minut przez całą noc. Połączenia są obsługiwane kolejno z budżetem przebiegu, aby nie zaczynać następnego pobrania tuż przed timeout.
- Wspólna implementacja `server/edu-service.mjs` / `syncAction`, istniejąca sesja, szyfrowanie, sprawdzenia uprawnień i atomowy `acquireSyncLease`. Nie ma drugiej implementacji logowania, synchronizacji ani przechowywania hasła.
- Natychmiastowy trigger nowej `familyMessages`, semantyczne zmiany danych szkolnych oraz dotychczasowe przypomnienia leków co 5 minut. Zapis dotyczy `notificationInbox`; **FCM, `_notificationOutbox` i systemowe Web Push nie są aktywowane**.
- Baseline oraz deterministyczne ID zapewniają ciche pierwsze pobranie historii i deduplikację także przy ponownym dostarczeniu triggera. Wiadomości rodziców nie trafiają do dzieci.

## Jeden kod serwera w dwóch środowiskach

Firebase przesyła źródło `functions/`, więc nie może importować plików spoza tego katalogu w chmurze. `scripts/prepare-functions.mjs` tworzy wygenerowany `functions/server/` z kanonicznych `server/*.mjs`, sprawdza domknięcie importów i zapisuje manifest SHA-256. To przygotowanie artefaktu, a nie ręcznie utrzymywana kopia logiki. **Edytuj `server/`, nigdy wygenerowany `functions/server/`.**

Lokalne przygotowanie i kontrola, bez publikacji:

```bash
npm ci --prefix functions
npm run build --prefix functions
npm run check --prefix functions
```

Ten sam generator jest skonfigurowany w `firebase.json` jako `predeploy`. Zachowano istniejące Firestore Rules, Storage Rules i emulatory. Nie uruchamiaj komendy deploymentu w tym etapie.

## Konfiguracja istniejącej sesji

Functions używają zarządzanej tożsamości serwisowej projektu; nie dodawaj pliku Firebase Admin ani prywatnego klucza do katalogu. Środowisko Vercel nie jest automatycznie dziedziczone przez Functions.

Binding Secret Manager **`EDUVULCAN_ENCRYPTION_KEY_BASE64`** musi w przyszłym środowisku Functions wskazywać **dokładnie tę samą istniejącą wartość** co Vercel. Nie generuj nowego klucza ani nie rotuj istniejącego. `EDUVULCAN_ENCRYPTION_KEY_ID` musi również pozostać identyczne; gdy dotychczas nie było ustawione, obowiązuje istniejące `v1`. Zmiana klucza lub ID uniemożliwi odczyt istniejących sesji.

Przeniesienie istniejącej wartości do bezpiecznej konfiguracji Functions jest osobnym krokiem po akceptacji; w tej pracy nie zapisano ani nie zmieniono wartości sekretów. Brak lub niezgodna konfiguracja nie uruchamia awaryjnego logowania hasłem. Wygasła/odrzucona sesja otrzymuje bezpieczny stan wymagający ponownego połączenia przez rodzica; wcześniejszy limit czasu sesji nie został wydłużony.

Pełna polityka harmonogramu, DST, wymagane API i aktualne wyniki testów: [EDUVULCAN_FUNCTIONS_HARMONOGRAM.md](../docs/EDUVULCAN_FUNCTIONS_HARMONOGRAM.md).
