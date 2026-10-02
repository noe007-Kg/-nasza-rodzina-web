# Nasza Rodzina 1.5.0 — połączenie eduVULCAN

Wersja zachowuje rodzinny organizer, Twoje logo i różowo-lawendowy wygląd z 1.4.2. Dodaje backend Vercel oraz panel połączenia do własnego konta rodzica w eduVULCAN. **Nie potwierdzono logowania i pobrania danych z rzeczywistego konta rodziny/SP4**; wyniki lokalnych sprawdzeń nie zastępują tego kroku.

## Dodane funkcje

- Logowanie przez serwer, lista dostępnych dzienników i jawne przypisanie profilu **SP4** do właściwego dziecka. Nie wybieramy pierwszego profilu ani przedszkola.
- Odświeżanie na żądanie: oceny bieżącego okresu, także opisowe i okresowe; datowany plan od 7 dni wstecz do 21 dni naprzód; zadania i sprawdziany od 7 dni wstecz do 30 dni naprzód.
- Odczyt do 30 wiadomości z wybranej skrzynki szkoły, z treścią jako zwykły tekst do 20 000 znaków. Wiadomości pozostają dostępne wyłącznie rodzicom. Nie pobieramy załączników, nie wysyłamy odpowiedzi ani żądań oznaczania wiadomości jako przeczytanej.
- Limit szczegółów zadań/sprawdzianów i wiadomości: do 30 w każdej sekcji; do 400 wpisów łącznie w jednej synchronizacji. Częściowe wyniki pokazują ostrzeżenia i zachowują poprzednie dane sekcji, których nie odczytano.
- Po pełnym udanym odczycie aktualizujemy lokalną kopię wycofanych ocen i zmienionego planu tylko w pobranym zakresie wybranego profilu. Własne wpisy i pozostałe dzieci pozostają zachowane.
- Token Firebase aktywnego rodzica na każdym żądaniu, zaszyfrowana sesja w prywatnej kolekcji i przycisk odłączenia. Hasło do dziennika nie jest zapisywane. Dostęp przez sesję wygasa najpóźniej po 24 godzinach; wygasły rekord usuwany jest przy żądaniu, nie przez automatycznie skonfigurowany harmonogram TTL.

Nie dodano odświeżania w tle/cron, frekwencji, pobierania załączników, wysyłania wiadomości ani całej historii dziennika. Ręczne wpisy oraz dotychczasowy import CSV/JSON nadal działają niezależnie od połączenia.

## Co przygotować do wdrożenia

Użyj **pełnej paczki PROJEKT** w GitHub/Vercel, z `api/` i `server/`. Ustaw serwerowy klucz Firebase Admin, klucz szyfrowania i domenę aplikacji; opublikuj nowe reguły Firestore. Zwykłe wgranie statycznego `dist` uruchamia organizer bez backendu integracji.

Instrukcja: [START_TUTAJ.md](START_TUTAJ.md), [docs/VULCAN.md](docs/VULCAN.md), [docs/FIREBASE.md](docs/FIREBASE.md) i [docs/WDROZENIE.md](docs/WDROZENIE.md). Dokładny zakres testów opisuje [RAPORT_TESTOW.md](RAPORT_TESTOW.md).
