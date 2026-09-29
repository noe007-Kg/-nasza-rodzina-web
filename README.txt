NASZA RODZINA v1.3.2 — VERSA / ETAP ZADANIA
Data: 30.09.2026

Ta paczka bazuje na Nasza Rodzina v1.3.0 i zmienia przede wszystkim zakładkę Kalendarz, zgodnie z zatwierdzonym jasnym szablonem aplikacji.

CO ZMIENIONO W v1.3.1
- Kalendarz otrzymał jasny layout spójny ze stroną Start.
- Desktop/tablet: profile rodziny u góry, duży kalendarz tygodniowy, mini-kalendarz, filtry osób, połączone źródła oraz nadchodzące wydarzenia.
- Telefon: osobny responsywny układ z paskiem dni, agendą dnia, przyciskiem dodawania i dolną nawigacją aplikacji.
- Widoki Dzień / Tydzień / Miesiąc pozostają działające.
- Dodawanie, edycja, usuwanie i wydarzenia cykliczne nadal korzystają z Firestore.
- Dodano czytelny pasek synchronizacji kalendarza.
- Sekcja źródeł pokazuje Nasza Rodzina oraz miejsca dla Google Calendar, Apple/iCloud i innych kalendarzy.
- Sidebar w szablonie ma tło kolorystyczne/gradientowe bez fotografii.
- Jasny motyw pozostaje głównym wzorcem. Ciemny motyw nadal jest dostępny w Ustawieniach.

BEZPIECZEŃSTWO WDROŻENIA
Zalecane jest wdrożenie najpierw do osobnej gałęzi GitHub i użycie Vercel Preview Deployment. Szczegóły: DEPLOY_VERCEL.txt.

FIREBASE
Projekt nadal używa obecnego Firebase: Auth + Firestore + Storage.
Wersja 1.3.1 nie zmienia nazw istniejących kolekcji i nie usuwa danych.

INTEGRACJE ZEWNĘTRZNE
Google Calendar / Apple iCloud / Outlook są przygotowane w interfejsie, ale pełna dwukierunkowa synchronizacja wymaga osobnego etapu z OAuth/API. Nie udajemy połączenia, jeśli nie zostało ono rzeczywiście skonfigurowane.

URUCHOMIENIE LOKALNE
1. npm install
2. npm run dev

BUDOWANIE
npm run build

Wersja aplikacji:
const APP_VERSION = '1.3.1';


Wersja 1.3.2 zawiera przebudowaną zakładkę Zadania zgodną z projektem 1.3 Versa.

NAPRAWA BUILD
Ta paczka przywraca pomocniczy kod modułu Zakupy, który został omyłkowo pominięty w pierwszej paczce v1.3.2.
