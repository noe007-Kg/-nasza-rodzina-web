# Zdrowie — kontrola i wydanie, 25.10.2026

## Stan początkowy

Odczyt starszych wpisów i formularze działały. Zapis wizyt, leków, kontaktów,
chronionych dokumentów i upoważnień był blokowany przez wspólną flagę modułów,
choć przyciski zapisu wpisów wyglądały na aktywne. Reguły dokumentów i zgód nie
były wdrożone. Funkcja przypomnień lekowych była ACTIVE, lecz przypomnienia
ważności dokumentów i sprzątanie nie były uruchomione.

Usuwanie kontaktu omijało sprawdzanie blokady zapisu. Załączniki wyników i historii
korzystały ze starszej ścieżki plików, innej od chronionych załączników wizyt.

## Naprawy

- Osobne `HEALTH_WRITES_ENABLED` bez włączania finansów; ochrona Preview zachowana.
- Formularze odczytują stan zapisu z serwera, wyłączają zapis podczas blokady,
  a usuwanie kontaktów i potwierdzanie leków sprawdzają tę samą politykę.
- Każdy nowy załącznik, również wynik, historia, lek i dokument, korzysta z
  istniejącego biletu `healthDocuments`, uprawnień UID i sprawdzenia upoważnienia
  do kartoteki. Wynik nie tworzy automatycznie wizyty w kalendarzu.
- Zachowano ponowienia tej samej wysyłki i finalizacji bez duplikowania wpisu.
- Dokumenty otrzymują identyfikator rodziny; niezgodność rodziny i wyłączone
  profile są odrzucane. Upoważnienie osoby dorosłej wymaga jej zgody lub niezależnie
  zweryfikowanego umocowania prawnego; rodzic nie może sam sobie nadać takiej zgody.
- Wygasłe, niedokończone zwykłe dokumenty są teraz objęte sprzątaniem, podobnie jak
  szkice załączników. Gotowe dokumenty nie są usuwane automatycznie po wygaśnięciu.
- Wdrożenia reguł oraz funkcji są ograniczone do Zdrowia; poza tym zakresem reguły
  i istniejące harmonogramy pozostają bez zmian.

## Weryfikacja

- 327/327 testów jednostkowych.
- 18/18 testów reguł w emulatorach, w tym 3 testy dokładnych artefaktów wydania:
  prywatność wobec innego rodzica, dorosłego właściciela bez udostępnienia i obcej
  rodziny; zakaz fałszowania zgody i powiązania pliku.
- 4/4 scenariusze Chromium na rzeczywistych lokalnych emulatorach Auth,
  Firestore i Storage: PDF/JPG, przerwanie zapisu i ponowienie, odrzucenie wysyłki
  i ponowienie, wynik PDF bez wydarzenia w kalendarzu, blokada zapisu.
- Lokalne testy logiki obejmują zgody dorosłych, cofnięcie dostępu, walidację
  plików, atomowe powiązanie załącznika, sprzątanie szkiców i ochronę gotowych plików.
- Końcowy zestaw serwera i kontraktów harmonogramów na Node 22: 52/52.
- Budowanie i prepare/check Functions: poprawne. Kontrakt harmonogramów uzupełniono
  o nową, niezależną funkcję sprzątania.
- Na jednorazowym syntetycznym pliku bez danych osobowych w Firebase potwierdzono
  usunięcie tokenu publicznego pobierania: stary URL zmienił odpowiedź z 200 na 403.
  Aktywny obiekt testowy został uprzątnięty. Nie wysyłano dokumentów medycznych.

Pierwsze równoległe testy reguł kolidowały, nadpisując wspólną bazę demo.
Końcowy przebieg był sekwencyjny i zakończył się powodzeniem.

## Brak danych wymagający uzupełnienia

Wszystkie trzy profile oznaczone jako dzieci nie mają dat urodzenia. Poproszono
użytkownika o dane; nie zmieniano ich na podstawie domysłów. Do czasu uzupełnienia
serwer prawidłowo odmawia rodzicowi nowych dokumentów takiej osoby i wskazuje
przyczynę. Właściciel konta zachowuje dostęp do swoich dokumentów. Pozostałe
funkcje modułu nie wymagają zgadywania wieku i mogą być uruchomione oddzielnie.

Nie zmieniano istniejących wizyt, leków, kontaktów, dokumentów ani zgód na potrzeby
testów. Nie uruchomiono migracji ani rozbudowy backupów.

## Potwierdzenie wydania

- Produkcja https://nasza-rodzina-web.vercel.app/#Zdrowie — READY, bez błędu aliasu.
- Wdrożenie `dpl_F2uJmV1VoSuGSV5u1MvEvXMHzCbJ`, kod
  `87eeb795a8a095be5a0254ad78305dfc61fb0900`.
- Potwierdzono zgodność aktywnych reguł z artefaktami, READY obu indeksów,
  ACTIVE obu funkcji oraz ENABLED harmonogramów (08:00 i 15. minuta godziny,
  Europe/Warsaw). Istniejąca funkcja leków pozostała bez zmian.
- W istniejącej sesji rodzica potwierdzono brak komunikatu Podgląd 2.0,
  aktywny zapis formularza wizyty oraz poprawny odczyt panelu upoważnień.
  Nie wysyłano formularzy produkcyjnych ani nie nadawano testowych zgód.
- Krótka kontrola logów wykazała ostrzeżenia zależności Node 24 `DEP0169`
  dotyczące `url.parse()`, bez zaobserwowanego błędu działania Zdrowia.
- Automatyczna kontrola odrzuciła ręczne uruchomienie konserwacji ze względu
  na możliwe usuwanie wygasłych szkiców. Nie obchodzono odrzucenia; gotowość
  potwierdzono bezpiecznym odczytem konfiguracji. Ręczne usuwanie nie było
  warunkiem wdrożenia i nie zostało wykonane.
- Brak dat urodzenia dzieci pozostaje otwarty do odpowiedzi użytkownika;
  nie deklarujemy pełnego dostępu rodzica do ich dokumentów przed uzupełnieniem.
- Ten dopisek dokumentacyjny powstał po wydaniu i nie zmienia kodu produkcji.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for explicit document ACLs, authenticated immutable uploads and server-only consent changes. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
