NASZA RODZINA v1.3.0 — DUŻA PACZKA FUNKCJONALNA
Data: 29.09.2026

To jest pełny projekt źródłowy React + TypeScript + Vite przygotowany do wgrania do repozytorium GitHub i automatycznego wdrożenia przez Vercel.

NAJWAŻNIEJSZE ELEMENTY v1.3.0
- nowy ekran Start: profile całej rodziny, pogoda Kołobrzeg, plan dnia, status kto gdzie jest, „Wszyscy wolni od…”, najważniejsze zadania, wydarzenia i lista zakupów,
- Kalendarz dzień/tydzień/miesiąc, osoby, cykliczność, edycja/usuwanie oraz sekcja integracji kalendarzy,
- Zadania: szybkie gotowce, punkty ustawiane przez rodzica, zatwierdzanie wykonania i nagrody,
- Zakupy: małe szybkie kafelki, własne zdjęcia/ikony, długie przytrzymanie do edycji/usunięcia, szybka notatka wielu produktów, kategorie, produkty 18+ tylko dla pełnoletnich,
- Czat: rodzinny i prywatny 1:1, avatary, reakcje/menu wiadomości i przyklejone pole pisania,
- Zdrowie: profile osób, wizyty, leki i potwierdzanie przyjęcia, dokumenty, wyniki, specjalizacje, kontrole, kontakty medyczne, ważne dokumenty Pawła dla rodziców,
- Szkoła: ręczny plan lekcji i zajęć dodatkowych, widok rodzica dla obu dzieci oraz indywidualny widok ucznia; miejsce pod przyszłą integrację VULCAN,
- Rodzina: profil-hub każdej osoby z planem, zadaniami i skrótami do modułów,
- Ustawienia: jasny/ciemny motyw, powiadomienia, kalendarze, uprawnienia, prywatność oraz stała sekcja „Co nowego?”,
- ekran ładowania z właściwym logo aplikacji,
- responsywne układy tablet/desktop + telefon.

ZACHOWANE ASSETY
public/login-family.png
public/start-banner.png
public/sidebar-sunset.jpg
public/nasza-rodzina-logo.svg
public/wojanek-napoj.png
public/wojanek-mus.png
public/oxy-chusteczki.png

FIREBASE
Projekt korzysta z istniejącego Firebase: Auth + Firestore + Storage.
Nowe funkcje używają kolekcji:
- members
- calendarEvents
- tasks
- shoppingItems
- quickProducts
- familyMessages
- healthRecords
- medicalContacts
- schoolItems

Pliki użytkowników są wysyłane do Firebase Storage do folderów health/ oraz quick-products/.
Jeżeli Storage nie jest jeszcze uruchomiony lub reguły go blokują, samo logowanie i moduły bez plików nadal działają, ale upload dokumentów/ikonek zgłosi komunikat o błędzie.

WAŻNE
- Integracje Google/Apple/Outlook i VULCAN są przygotowane wizualnie/logicznie, ale pełna synchronizacja wymaga osobnego etapu autoryzacji/API.
- Powiadomienia przeglądarkowe działające także po całkowitym zamknięciu strony wymagają później Web Push / service workera.
- Nie zapisujemy loginów ani haseł do VULCAN w Firestore ani w kodzie frontendu.

URUCHOMIENIE LOKALNE
1. npm install
2. npm run dev

BUDOWANIE
npm run build

WDROŻENIE NA VERCEL
Najprościej podmienić pliki projektu w obecnym repozytorium GitHub i zrobić commit do main. Vercel powinien sam wykryć Vite i wdrożyć nową wersję.

Wersja aplikacji jest ustawiona w src/main.tsx:
const APP_VERSION = '1.3.0';
