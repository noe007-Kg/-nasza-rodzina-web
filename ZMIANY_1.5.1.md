# Nasza Rodzina 1.5.1 — poprawka wspólnego połączenia eduVULCAN

Aktywny rodzic nie jest już odrzucany z powodu różnicy pomiędzy pełną wyświetlaną nazwą i krótkim kluczem osoby. Backend sprawdza token Firebase oraz `role: parent`, `active: true` i `canLogin: true` w profilu danego UID. Nazwa rodzica, login do eduVULCAN i nazwisko ucznia nie są kryteriami nadawania uprawnień.

Rodzina korzysta z jednego połączenia `_eduConnections/family`. Konto eduVULCAN Dominiki może dostarczać dane jawnie wybranego Nikodema/SP4; Sebastian i Dominika, zalogowani na osobnych kontach Naszej Rodziny z rolą `parent`, widzą wspólne dane i status oraz mogą synchronizować lub rozłączyć sesję. Nie trzeba łączyć tego samego dziennika oddzielnie na obu kontach aplikacji.

## Zachowanie panelu

- **Połącz konto**: login/e-mail, hasło i przycisk **Połącz**.
- **Sprawdź stan połączenia**: odczytuje wspólny stan bez pobierania ocen i planu.
- **Synchronizuj teraz**: aktualizuje dane wybranego profilu; blokady i limit 5 minut są wspólne dla rodziców.
- **Rozłącz**: usuwa wspólną zaszyfrowaną sesję po potwierdzeniu, pozostawiając pobrane wpisy.
- Status pokazuje wybranego ucznia i ostatnią udaną synchronizację. Wybór SP4 jest jawny; pierwszego profilu ani przedszkola nie wybiera się automatycznie.

Hasło służy wyłącznie do logowania. Sesja/cookies są zaszyfrowane AES-256-GCM na serwerze, a klucz pozostaje w Vercel. Dokumenty sesji są niedostępne przez reguły klienta. Po aktualizacji z 1.5.0 połącz dziennik raz ponownie; wcześniejsze dane szkolne pozostają zachowane.

## Osobne połączenie ucznia

Serwer rozdziela wspólny zakres `family` i przyszły zakres `student`, którego identyfikator wynika ze zweryfikowanego UID. Zakres ucznia wymaga szkolnej tożsamości zatwierdzonej przez rodzica i nie pozwala wybierać cudzych dzieci. Formularz dziecka nie jest obecnie włączony. Pobieranie wiadomości w zakresie ucznia jest wyłączone, dopóki adapter nie potwierdzi roli właściciela skrzynki w eduVULCAN. Przygotowane reguły przyszłej skrzynki ucznia dopuszczają wyłącznie tego ucznia, bez dostępu rodziców i rodzeństwa.

## Wdrożenie

**Brak nowych Environment Variables.** Wykorzystujemy dotychczasowy klucz Firebase Admin, klucz szyfrowania i ustawienia serwera. Nie dodajemy do konfiguracji loginów, haseł, kodów aktywacyjnych ani UID rodziców.

Instrukcja oraz dokładna lista zmienionych plików: [AKTUALIZACJA_1.5.1.md](AKTUALIZACJA_1.5.1.md). Wyniki sprawdzeń: [RAPORT_TESTOW.md](RAPORT_TESTOW.md). Nie wykonano `git push` ani wdrożenia i nie sprawdzono logowania na rzeczywistym koncie rodziny. Wygląd pozostałych modułów pozostaje zachowany.
