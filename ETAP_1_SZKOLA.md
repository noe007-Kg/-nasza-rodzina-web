# Nasza Rodzina 1.5.1 — etap 1: design system i Szkoła

Zakres tego etapu: wspólne komponenty oraz wygląd Szkoły. Numer aplikacji pozostaje 1.5.1. Pozostałych modułów i nawigacji nie przebudowano. Nie wykonano git push ani wdrożenia.

## Rezultat

- Jasne różowe tło, białe karty 22 px, subtelne obramowania i cienie, pastelowe akcenty, granatowy tekst.
- Wspólne Card, StatCard, ProfileSelector, SectionHeader, StatusPill, PrimaryButton, SecondaryButton i jedna rodzina ikon SVG.
- Profile uczniów z istniejącymi zdjęciami lub dotychczasowymi emoji. Aktywny profil ma różową obwódkę.
- Panel wybranego ucznia: nazwa szkoły i klasy z istniejącego publicznego statusu połączenia, status i czas synchronizacji.
- Kafelki Dzisiaj, Plan lekcji, Oceny, Zadania domowe, Sprawdziany, Wiadomości dla rodziców oraz Zajęcia dodatkowe. Liczby i podglądy pochodzą z dostępnych temu kontu zapisanych danych wybranego ucznia.
- Kliknięcie kafla prowadzi do istniejącego planu tygodnia lub listy wpisów. Zachowano dodawanie, edycję, usuwanie, szczegóły, import CSV/JSON i połączenia z kalendarzem.
- Panel eduVULCAN pozostaje na dole. Ma wspólne kolory, kartę, status i ikonę; jego operacje działają dotychczasowym sposobem.
- Dialogi zachowują obsługę klawiatury, Escape i powrót fokusu do przycisku otwierającego. Cele dotykowe mają co najmniej 44 px.

## Dane i uprawnienia

Nie zmieniono backendu, API, Authentication, Firestore, Storage, reguł, kolekcji, synchronizacji, zapisu danych ani konfiguracji środowiska. Sebastian i Dominika nadal korzystają ze wspólnego połączenia rodziny. Dziecko nie pobiera statusu połączenia rodziców ani prywatnej skrzynki rodziców; widzi własne dostępne dane. Wpisy eduVULCAN pozostają tylko do odczytu.

Dodano wyłącznie odczyt istniejących zdjęć członków rodziny do prezentacji profili. Nagłówek rodzica korzysta z odpowiedzi statusu już pobranej przez istniejący panel eduVULCAN, bez dodatkowego żądania lub synchronizacji. Nie zapisano żadnych haseł ani sekretów. Nowe Environment Variables w Vercel: **żadne**.

Jeśli widok dziecka nie ma w obecnym cache metadanych nazwy szkoły, wyświetla ogólny opis „Plan i szkolne sprawy”. Nie uzyskuje w tym celu dostępu do połączenia rodziców. Stan cache i ostatnia synchronizacja pochodzą z jego szkolnych wpisów.

## Responsywność i podglądy

Siatka zależy od szerokości kontenera: poniżej 700 px ma dwie kolumny, od 700 px trzy, od 980 px cztery. Kafel Dzisiaj zajmuje dwie kolumny. Przy szerokim układzie plan i lista wpisów stoją obok siebie. Na wąskim ekranie dni tygodnia i filtry przewijają się wewnątrz panelu.

| Wariant | Rozmiar | Kolumny | Podgląd |
| --- | --- | --- | --- |
| Telefon pionowo | 390 × 844 | 2 | [telefon](preview/school-phone-portrait.png) |
| Telefon poziomo | 844 × 390 | 3 | [telefon poziomo](preview/school-phone-landscape.png) |
| Tablet pionowo | 900 × 1440 | 2 | [tablet](preview/school-tablet-portrait.png) |
| Komputer poziomo | 1440 × 900 | 4 | [komputer](preview/school-desktop-landscape.png) |

Przy tablecie pionowo istniejący pasek boczny zajmuje część szerokości, dlatego ten wariant ma dwie kolumny. Podglądy używają syntetycznych danych z lokalnych emulatorów, nie danych produkcyjnych rodziny. Żadnej twarzy ani zdjęcia nie wygenerowano.

W środowisku testowym Chromium na dużych ekranach rezerwuje 15 px na klasyczny pasek przewijania; WebKit używa paska nakładanego na treść. To istniejące zachowanie aplikacji i platformy. Przy jednakowych rozmiarach okna oba silniki mają te same układy kolumn i brak przewijania poziomego. Test porównuje też szerokości i pozycje kafli przy dokładnie tej samej dostępnej szerokości kontenera, uwzględniając różnicę paska systemowego. Nie zmieniono w tym celu globalnych stylów pozostałych modułów.

## Lista plików tego etapu

| Plik | Zmiana |
| --- | --- |
| `src/ui/index.tsx` | Nowe wspólne komponenty i ikony SVG. |
| `src/ui/design-system.css` | Nowe tokeny i style ograniczone do `.family-ui`. |
| `src/SchoolModule.tsx` | Nowy układ Szkoły, kafle z istniejących danych i dostępne dialogi. |
| `src/school.css` | Style Szkoły i siatki zależne od kontenera. |
| `src/useSchoolProfilePhotos.ts` | Nowy odczyt istniejących zdjęć do UI, bez zapisów. |
| `src/EduVulcanConnection.tsx` | Wspólna karta, ikona i kapsułka; przekazanie już odczytanego publicznego statusu do nagłówka. |
| `src/edu-vulcan.css` | Dopasowanie kolorów panelu do wspólnych tokenów. |
| `tests/school-layout.spec.ts` | Nowe testy układów, liczników, profili, klawiatury, prywatności i geometrii obu silników. |
| `playwright.config.ts` | Dołączenie nowych testów do istniejącego zestawu. |
| `tests/browser.spec.ts` | Stabilizacja istniejącego testu Zdrowia: oczekiwanie na zakończenie wylogowania przed ponownym logowaniem. |
| `ETAP_1_SZKOLA.md` | Niniejszy opis i manifest. |
| `RAPORT_TESTOW.md` | Wyniki sprawdzeń tego etapu; zachowana wcześniejsza historia. |
| `preview/school-phone-portrait.png` | Nowy podgląd telefonu pionowo. |
| `preview/school-phone-landscape.png` | Nowy podgląd telefonu poziomo. |
| `preview/school-tablet-portrait.png` | Nowy podgląd tabletu pionowo. |
| `preview/school-desktop-landscape.png` | Nowy podgląd komputera. |
| `preview/school-dashboard.png` | Zbliżenie kafli do prezentacji tego etapu. |

Audyt względem niezmiennej paczki produkcyjnej 1.5.1 potwierdza identyczność chronionych plików `server/`, `api/`, reguł, konfiguracji Firebase, `src/firebase.ts`, `src/main.tsx`, pakietów i `.env.example`. Dotychczasowe funkcje odczytu i zapisu szkolnych danych pozostały bez zmian.

Wyniki wykonanych poleceń i testów: [RAPORT_TESTOW.md](RAPORT_TESTOW.md).

## Paczka

`Nasza_Rodzina_v1.5.1_SZKOLA_ETAP_1.zip` zawiera pełny projekt z tym etapem i podglądami. Nie zawiera node_modules, sekretów, lokalnych plików środowiska ani logów emulatorów. Przy dalszej pracy zachowaj obecną konfigurację Vercel/Firebase. Ten etap nie wymaga publikacji nowych reguł, migracji danych ani zmiany kluczy eduVULCAN.
