# Wydzielone wdrożenie Zdrowia — 25.10.2026

Użytkownik zlecił sprawdzenie, a następnie naprawę i wdrożenie modułu Zdrowie.
Nie uruchamiać migracji 236 dokumentów ani pełnego wdrożenia wszystkich modułów.

- `firebase-firestore.json` wdraża tylko reguły Zdrowia. Blok `healthRecords` jest
  rozszerzony o ochronę powiązań załączników oraz dodane są serwerowe dokumenty i
  upoważnienia. Reguły poza tym blokiem są bajtowo identyczne z zastaną produkcją.
- `firebase-storage.json` dodaje wyłącznie `healthDocuments` do obecnego magazynu.
  Reguły ilustracji nagród i blokada pozostałych ścieżek pozostają identyczne.
  Osobny magazyn dowodów zadań nie jest zmieniany.
- `release-base.json` wiąże artefakty z aktywnymi przed wdrożeniem rulesetami.
- `firestore.indexes.json` zawiera dwa indeksy. Tworzyć wyłącznie brakujące,
  bez usuwania lub pełnej synchronizacji pozostałych indeksów.

Funkcje wdrażać z osobnej paczki z `functions/health-only.mjs` jako `index.mjs`:
`healthDocumentReminders` o 08:00 i `healthDocumentCleanup` o 15. minucie każdej
godziny; strefa Europe/Warsaw, region europe-west1, Node 22. Załączyć zależności
`server/` i manifest Functions bez repozytoryjnych skryptów build.
Parametry paczki: `HEALTH_WRITES_ENABLED=true`,
`HEALTH_STORAGE_BUCKET=nasza-rodzina.firebasestorage.app`.
Nie wdrażać pozostałych funkcji ani sekretów szkoły, kalendarza lub finansów.

Frontend/API Vercel: `HEALTH_WRITES_ENABLED=true` tylko w produkcji. Wspólna flaga
`FAMILY_V2_WRITES_ENABLED` pozostaje wyłączona; finanse nie są uruchamiane.

Przed publikacją potwierdzić READY indeksów, identyczność aktywnych rulesetów,
ACTIVE obu funkcji i ENABLED harmonogramów. Ręczne wykonanie konserwacji nie jest
częścią kontroli tylko do odczytu i nie powinno być uruchamiane bez sprawdzenia
zakresu danych do usunięcia. Gotowe dokumenty nigdy nie są usuwane z powodu daty
ważności; sprzątanie dotyczy jawnie żądanych usunięć i wygasłych szkiców.

W profilach trzech dzieci stwierdzono brak dat urodzenia. Nie wolno ich zgadywać
ani nadawać rodzicowi dostępu na podstawie samej etykiety „dziecko”. Do dokumentów
małoletniego potrzebna jest poprawna data w profilu; osoba pełnoletnia może
samodzielnie upoważnić inną osobę. To brak danych do konfiguracji, a nie flaga,
którą można bezpiecznie obejść przy wydaniu.
