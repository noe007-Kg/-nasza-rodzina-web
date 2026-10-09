# Etap 9 — ograniczenie liczby Functions Vercel

Trzy dotychczasowe pliki `api/account/members.mjs`, `profile.mjs` i `google-login.mjs` zastępuje jeden `api/account/[action].mjs`. Publiczne adresy **pozostają bez zmian**:

- `POST /api/account/members` — nadal tylko aktywny rodzic;
- `POST /api/account/profile` — nadal aktywny członek, a właściwa akcja nadal sprawdza uprawnienia do wybranego profilu;
- `POST /api/account/google-login` — nadal publiczne wejście dla dotychczasowej weryfikacji Google Identity Services i logowania do tego samego istniejącego Firebase UID.

Router korzysta z istniejącego `createAccountHandler` i istniejących akcji bez zmian. Wybiera operację wyłącznie ze ścisłej, niekodowanej ścieżki `request.url`. Nieznane, zakodowane, normalizowane lub niejednoznaczne ścieżki oraz konflikty `query.action` kończą się bezpiecznym 404, zanim zostanie zainicjalizowany Firebase. Parametr zapytania ani treść żądania nie może przełączyć ochrony `members` na publiczne logowanie Google.

Odpowiedź 404 ma ten sam zakaz cache i ochronę nagłówków co dotychczasowe odpowiedzi konta. Dane uwierzytelniające z treści są czyszczone, nie trafiają do komunikatu ani do logów.

Istniejący glob `api/account/*.mjs` w `vercel.json` obejmuje dynamiczny plik. Nie ma zmiany limitu czasu, bundlingu `server/**`, nagłówków, adresów klienta, Firebase Auth, UID, Firestore Rules, Storage Rules ani sekretów.

Audytowana baza `1f75aa2` miała 11 plików API. Po etapie profili miała 12, a konsolidacja trzech handlerów konta zmniejszyła tę liczbę do 10. Po dodaniu jednego grupowanego endpointu Google Calendar są **11 Functions Vercel**, zamiast 13. Względem `1f75aa2` usunięto dwa pliki; `profile.mjs` powstał dopiero w etapie pośrednim. Liczba i harmonogramy Firebase Functions nie są zmieniane przez tę konsolidację.

Test `tests/account-router.test.mjs` pokrywa rzeczywiste guardy rodzic/członek/publiczne, konflikt parametrów, niewłaściwe ścieżki, ochronę same-origin, metody HTTP, czyszczenie danych wejściowych oraz delegację produkcyjnego pliku API. Testy i build wykonuje główny agent razem z pozostałymi zmianami etapu; ten izolowany pakiet nie wykonuje deploymentu.

## Wyniki lokalne — Node.js 22.23.3

- Server: **333/333 PASS**, w tym 12 nowych scenariuszy rzeczywistych guardów routera.
- Functions: **54/54 PASS**, zgodność wygenerowanych modułów i działających harmonogramów.
- Build/TypeScript: **PASS**.
- Dotychczasowe akcje Auth i reguły pozostają bez zmian. Pełne testy przeglądarkowe klienta zostaną ponownie uruchomione razem z integracją Google Calendar.
- Bez push, deploymentu ani zmian chmurowych.
