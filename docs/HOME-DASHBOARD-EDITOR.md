# Dostosowanie strony Start

Wzorzec obsługi odpowiada edytorowi Grafik on 0.2.25 (`63c8a3da04cbcb422502c23a51bcfdbea716503c`, `src/components/DashboardLayout.tsx`): „Dostosuj pulpit”, uchwyt przeciągania, przyciski ↑/↓, rozmiary „Mały kwadrat”, „Prostokąt”, „Duży”, „Gotowe”, przywrócenie domyślnego układu i anulowanie. Zmiana kolejności i rozmiaru dotyczy rodziny, paczek, kalendarza, zadań, szybkiego dostępu i szkoły. Zawartość nie reaguje na kliknięcia w trybie edycji. Klawiatura obsługuje spację, strzałki oraz Escape.

Rodzina ma domyślnie duży kafel, a paczki mały kwadrat. Kafelek paczek pokazuje liczbę i status; przycisk otwiera pełne szczegóły, notatki, kody odbioru i zdjęcia QR. Jednocześnie działa tylko jedno okno szczegółów. Wybór większego rozmiaru pokazuje dotychczasowy pełny widok paczek. Bez aktywnych paczek kafelek pozostaje ukryty poza trybem edycji.

Kwadraty zachowują proporcje 1:1; obszerną zawartość pozostałych sekcji można przewinąć wewnątrz. Pomiar wysokości przez ResizeObserver zachowuje niezależne odstępy między kafelkami. Telefon (do 767 px szerokości okna) i większy ekran mają osobne układy. Liczba kolumn dopasowuje się również do dostępnej szerokości strony.

Układ zapisuje się dopiero po „Gotowe”. Anulowanie i Escape podczas przeciągania nie zapisują zmian. Błąd zapisu pozostawia wersję roboczą do ponowienia. Nowe preferencje przechowuje `_homeLayouts/{uid}` za uwierzytelnionym endpointem `/api/family/home-layout`. Serwer sam wybiera UID, sprawdza bieżący aktywny profil i dopuszcza tylko sześć znanych identyfikatorów, trzy rozmiary oraz dwa rodzaje ekranu. Transakcja zachowuje układ drugiego ekranu. Nie ma zapisu w Preview. Istniejąca domyślna odmowa w regułach Firestore blokuje bezpośredni dostęp do tej kolekcji; nie zmieniono reguł ani dawnych `userPreferences`.

Pamięć urządzenia zawiera tylko kopię układu przypisaną do UID. Zmiana konta resetuje stan edycji; opóźniona odpowiedź starego konta nie nadpisuje nowego. Przy pierwszym odczycie bez nowego układu zachowujemy wcześniejszą kolejność sekcji jako punkt wyjścia. Nowe kafelki są dopisywane, stare i zduplikowane identyfikatory usuwane podczas normalizacji.

Weryfikacja obejmuje walidację modelu, izolację UID i ekranów, aktualne członkostwo, Preview i ochronę endpointu; transakcje prawdziwego emulatora i odmowę bezpośredniego dostępu; widoki 360–1440 px, proporcje kwadratów, brak nakładania i przewijania strony w poziomie, przeciąganie myszą i dotykiem, klawiaturę, strzałki, anulowanie, reset, zapis po przeładowaniu, zmianę konta, błąd zapisu i podgląd kodów paczki.
