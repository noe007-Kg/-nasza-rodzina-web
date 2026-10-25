# Pakiet A — wydzielone wdrożenie

Autoryzacja użytkownika 25.10.2026: „popraw to wszystko i wdrożyć to”.
Zakres: istniejące zadania, punkty, nagrody i dowody zdjęciowe.
Bez migracji 236 dokumentów i bez rozbudowy backupów.

Reguły wdrażamy rozdzielonymi konfiguracjami. Nie używać głównego firebase.json
do pełnego wdrożenia pozostałych modułów w ramach Pakietu A.

- `firebase-tasks.json`: reguły Firestore zmieniają wyłącznie blok zadań.
  Reszta jest identyczna z aktywnym przed wdrożeniem rulesetem
  `ed244bbf-0a5d-4507-9963-1c1683a3a307`. SHA256 części bez bloku tasks:
  `ad8f9671ed0ee6a807ba8a15ea8b8fe3c40fc0f4d09f3b5b89c9910b44c74e7f`.
- `firebase-proofs.json`: tylko nowy bucket `nasza-rodzina-task-proofs`,
  z regułami biletów zdjęciowych. Soft delete wyłączony, wersjonowanie wyłączone.
- `firebase-rewards.json`: istniejący bucket; dostęp otwiera się tylko dla
  prywatnego prefiksu `taskRewardImages`. Pozostałe ścieżki pozostają zabronione,
  tak jak w dotychczasowej aktywnej wersji Storage. Zachowano 7-dniowy soft delete.
- `firestore.indexes.json`: cztery indeksy kolejek. Dodawać przez operacje create,
  bez synchronizacji usuwającej inne istniejące indeksy.

Dokładne artefakty reguł testuje `tests/package-a-release.rules.test.mjs` na lokalnej
bazie `demo-nasza-rodzina` (Firestore 8080, Storage 9199).

Osobna funkcja `functions/tasks-only.mjs` wdraża tylko `taskPhotoCleanup` w regionie
`europe-west1`, Node 22, harmonogram co godzinę, strefa Europe/Warsaw.
Przy przygotowaniu osobnej paczki ustaw ją jako `index.mjs`, dołącz zależności
`server/` i manifest Functions, usuń repozytoryjne skrypty build i ustaw:
`TASKS_WRITES_ENABLED=true`, `TASK_PROOF_BUCKET=nasza-rodzina-task-proofs`,
`TASK_REWARD_BUCKET=nasza-rodzina.firebasestorage.app`.
Nie wdrażaj innych eksportów ani deklaracji sekretów. Flagi Functions nie używają
zastrzeżonego prefiksu `FIREBASE_`.

Vercel produkcja: `TASKS_WRITES_ENABLED=true`, `TASK_PROOF_BUCKET` i
`VITE_TASK_PROOF_BUCKET=nasza-rodzina-task-proofs`, `FIREBASE_STORAGE_BUCKET` wskazuje
istniejący bucket ilustracji. `TASKS_LEGACY_FAMILY_ID` jawnie wiąże cztery stare
zadania z istniejącą rodziną bez przepisywania ich dokumentów. `FAMILY_V2_SITE_ORIGIN`
wskazuje główną domenę aplikacji. Nie włączaj wspólnego `FAMILY_V2_WRITES_ENABLED`:
zdrowie i finanse mają zachować dotychczasowy stan. Preview zawsze blokuje zapis.

Po publikacji sprawdź: zgodność aktywnych rulesetów z plikami, READY każdego
wymaganego indeksu, ACTIVE funkcji, ENABLED harmonogramu, poprawny wynik ręcznego
uruchomienia sprzątania oraz READY wdrożenia dokładnego SHA Vercel.
