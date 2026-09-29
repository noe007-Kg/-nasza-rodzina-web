NASZA RODZINA v1.3.0 — PAKIET GŁÓWNY
Data: 29.09.2026

Ten folder jest pełnym projektem React + TypeScript + Vite gotowym do wgrania do repozytorium GitHub i wdrożenia na Vercel.

NAJWAŻNIEJSZE MODUŁY W TEJ WERSJI
- Start: wspólny plan dnia całej rodziny, pogoda Kołobrzeg, profile, statusy, „Wszyscy wolni od…”, zadania, wydarzenia i podgląd listy zakupów.
- Kalendarz: dzień / tydzień / miesiąc, wydarzenia, powtarzanie, osoby, zakończone wydarzenia z dzisiejszego dnia pozostają widoczne.
- Zadania: szybkie gotowce, priorytety, powtarzanie, system punktowy, zatwierdzanie przez rodzica, panel nagród.
- Zakupy: małe szybkie kafelki, automatyczne kategorie, szybka notatka wielu produktów, własne zdjęcia/ikonki, długie przytrzymanie do edycji/usunięcia, produkty 18+ tylko dla dorosłych.
- Czat: czat rodzinny i rozmowy prywatne 1:1, avatary, prosty układ komunikatora.
- Zdrowie: profile całej rodziny, wizyty, leki i potwierdzanie przyjęcia, historia chronologiczna, specjalizacje, dokumenty, kontakty medyczne, ważne dokumenty Pawła tylko dla rodziców w interfejsie.
- Szkoła: ręczny plan lekcji, zajęcia dodatkowe, zadania, sprawdziany, oceny i wiadomości. Rodzic widzi oboje dzieci, uczeń swój profil.
- Rodzina: centrum profili z dzisiejszym planem, zadaniami i skrótami do modułów.
- Ustawienia: Jasny/Ciemny motyw, powiadomienia, uprawnienia, miejsce na integracje kalendarzy, prywatność, dane i stała sekcja „Co nowego?”.
- Ekran ładowania z logo aplikacji.

WAŻNE: FUNKCJE PRZYGOTOWANE, ALE NIE W PEŁNI PODŁĄCZONE
- Google Calendar / Apple Calendar / Outlook: interfejs jest przygotowany, pełna synchronizacja wymaga OAuth/API.
- VULCAN: na razie plan i dane szkolne wpisujemy ręcznie; nie zapisujemy loginów ani haseł VULCAN w aplikacji.
- Web Push działający po zamknięciu strony: wymaga backendu/service workera i konfiguracji powiadomień push.
- Wysyłanie zdjęć produktów oraz dokumentów zdrowotnych wymaga włączonego Firebase Storage i odpowiednich reguł Storage.

WDROŻENIE NA VERCEL
1. Rozpakuj ZIP.
2. Wgraj CAŁĄ zawartość folderu do głównego katalogu repozytorium GitHub (zastępując starą wersję aplikacji).
3. Zatwierdź Commit changes.
4. Vercel połączony z repozytorium powinien automatycznie rozpocząć wdrożenie.
5. Build command: npm run build
6. Output directory: dist
7. Framework preset: Vite (zwykle wykrywany automatycznie).

FIREBASE
Konfiguracja Firebase jest w src/firebase.ts i zachowuje dotychczasowy projekt Firebase użytkownika.
Nie zmieniaj danych projektu Firebase bez potrzeby.

GŁÓWNE PLIKI
- src/main.tsx
- src/style.css
- src/firebase.ts
- public/login-family.png
- public/start-banner.png
- public/sidebar-sunset.jpg
- public/nasza-rodzina-logo.svg
- public/wojanek-napoj.png
- public/wojanek-mus.png
- public/oxy-chusteczki.png

WERSJA
v1.3.0
