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

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for explicit document ACLs, authenticated immutable uploads and server-only consent changes. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
