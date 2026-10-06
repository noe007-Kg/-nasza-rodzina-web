# Konto, Google i członkowie rodziny

Zmiany są przygotowane w kodzie. Nie wykonano konfiguracji konsoli, wysyłania wiadomości produkcyjnych, tworzenia produkcyjnych kont, publikacji reguł ani wdrożenia.

## Jeden UID, dwie metody logowania

Użytkownik najpierw loguje się dotychczasowym e-mailem i hasłem. W **Ustawienia → Konto i logowanie → Połącz Google** aplikacja wywołuje Firebase `linkWithPopup` na aktualnym użytkowniku. Nie używa `signInWithPopup` do tworzenia nowego konta. `members/{UID}`, dane i uprawnienia zachowują dotychczasowy UID.

Na ekranie logowania Google Identity Services przekazuje krótkotrwałe potwierdzenie tożsamości do `/api/account/google-login`. Backend weryfikuje podpis, odbiorcę OAuth, ważność i zweryfikowany e-mail przez `google-auth-library`. Następnie wyszukuje **wyłącznie już połączony `google.com` provider UID**, sprawdza aktywność Firebase Auth i aktywny profil rodziny, a następnie wydaje Firebase custom token dla tego samego UID. Nie wyszukuje konta po adresie e-mail i nie tworzy użytkowników/profili przy logowaniu Google.

Niepołączone konto Google dostaje informację, żeby najpierw zalogować się dotychczasową metodą i połączyć Google w Ustawieniach. Konflikty `account-exists-with-different-credential` oraz `credential-already-in-use` nie przełączają kont i nie przenoszą danych między UID. Nie można odłączyć ostatniej metody logowania: należy wcześniej dodać hasło.

Wszelkie tokeny są przekazywane wyłącznie pomiędzy Google/Firebase a uwierzytelnionym przepływem aplikacji. Kod nie zapisuje ich w Firestore, własnym localStorage ani repozytorium. Standardową sesją Firebase zarządza dotychczasowy Firebase SDK. Endpointy mają `Cache-Control: no-store`, kontrolę origin i odpowiedzi bez wewnętrznych błędów/sekretów.

## Konfiguracja po akceptacji użytkownika

1. W istniejącym projekcie **Firebase Console → Authentication → Sign-in method** włącz **Google**, wybierz e-mail wsparcia i zachowaj włączone dotychczasowe logowanie **Email/Password**.
2. W **Authentication → Settings → Authorized domains** dodaj docelową domenę aplikacji na Vercel / własną domenę. Zachowaj dotychczasową domenę Firebase Auth; kod nie wymaga zmiany `authDomain`.
3. W **Google Cloud Console → APIs & Services → Credentials** znajdź webowy OAuth Client ID tego samego projektu (można użyć klienta webowego utworzonego przez Firebase dla Google). Ustaw **Authorized JavaScript origins** na dokładny adres aplikacji z `https://` i bez ścieżki, np. własną domenę produkcyjną. Dla testów lokalnych OAuth można osobno dodać `http://localhost:5173`.
4. Zachowaj autoryzowany redirect URI Firebase: `https://<dotychczasowy-authDomain>/__/auth/handler`. Google Identity Services na ekranie logowania używa callback JavaScript, a łączenie konta używa istniejącego handlera Firebase.
5. Skonfiguruj ekran zgody OAuth zgodnie z istniejącym projektem. Przy aplikacji OAuth w trybie testowym dodaj rodzinę jako dozwolonych użytkowników testowych.
6. W Vercel dodaj wartości poniżej i dopiero po akceptacji wykonaj wdrożenie. Frontendową wartość Vite należy ustawić przed buildem.

| Zmienna | Gdzie | Wartość |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Build / frontend Vercel | Webowy OAuth Client ID zakończony `.apps.googleusercontent.com` — publiczna konfiguracja, nie sekret |
| `GOOGLE_CLIENT_ID` | Backend Vercel | **Dokładnie ten sam** webowy OAuth Client ID, używany jako dozwolony odbiorca JWT |

Backend korzysta z istniejących `FIREBASE_PROJECT_ID` oraz jednej z dotychczasowych zmiennych z kluczem Admin (`FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_SERVICE_ACCOUNT_BASE64`). Nie trzeba dodawać drugiego klucza Admin. `EDUVULCAN_SITE_ORIGIN` pozostaje dotychczasową kontrolą origin współdzieloną z serwerowym uwierzytelnianiem. **Nie rotować `EDUVULCAN_ENCRYPTION_KEY_BASE64`.**

Dla kont/logowania nie są potrzebne zmiany Firestore Rules ani Storage Rules. Zarządzanie `members` pozostaje zabronione bezpośrednio z przeglądarki; `/api/account/members` korzysta z autoryzowanego Admin SDK. Pakiet nowych funkcji Vercel musi obejmować `api/account/*.mjs` i `server/**` (konfiguracja przygotowana w projekcie).

## E-mail i hasło

Zmiana e-maila używa `verifyBeforeUpdateEmail`: najpierw ponowne uwierzytelnienie, potem wiadomość na nowy adres. Adres aktualizuje się dopiero po otwarciu linku potwierdzającego; UID i `members/{UID}` się nie zmieniają. Użytkownik mający hasło podaje aktualne hasło. Konto Google bez hasła potwierdza tożsamość w oknie Google. Zmiana/dodanie hasła używa `updatePassword` na tym samym koncie po ponownym uwierzytelnieniu. „Przypomnij hasło” nadal korzysta z dotychczasowego `sendPasswordResetEmail`.

## Zarządzanie rodziną

Aktywny rodzic może dodawać profile z logowaniem lub bez logowania. Nowa osoba bez logowania otrzymuje ID profilu, `canLogin:false` i stabilny `personKey`. Nowe konto z logowaniem jest tworzone dopiero na jawną akcję rodzica; początkowo wyłączone, a dostęp zostaje aktywowany po zapisaniu profilu. Kod nie tworzy ani nie zwraca haseł; standardowy reset Firebase wysyłany przez istniejący klient SDK pozwala ustawić pierwsze hasło.

Jeżeli e-mail wskazuje już istniejące, aktywne konto Firebase bez profilu rodziny, jawne dodanie go przez rodzica wykorzystuje jego istniejący UID i nie zmienia hasła/providerów. E-mail istniejącego członka rodziny oraz drugi profil tej samej osoby są odrzucane. Edycja zachowuje `personKey`, imię, zdjęcie, datę urodzenia i pozostałe pola.

„Usuń członka” wymaga potwierdzenia i **archiwizuje** profil (`active:false`, `canLogin:false`, `archived:true`). Nie usuwa Auth, dokumentu członka, historii, wiadomości ani plików. Cofnięcie aktywności/logowania unieważnia refresh tokeny; reguły natychmiast wymagają aktywnego profilu. Rodzic nie może odebrać dostępu własnemu kontu. Transakcja ponownie sprawdza aktualną rolę rodzica i zachowanie aktywnego rodzica w rodzinie. Wspólna sesja eduVULCAN nie jest usuwana.

Istniejący profil bez konta Authentication można aktywować w panelu: **Edytuj → Dostęp do logowania → E-mail do logowania**. Backend tworzy konto Firebase z **tym samym UID** po jawnym żądaniu uprawnionego rodzica; istniejąca historia nie zmienia właściciela. Adres należący do innego UID zostaje odrzucony. Jeśli konto Auth z tym UID już istnieje, nie jest ponownie tworzone ani aktualizowane podanym adresem. Po sukcesie zwykły reset Firebase wysyła wiadomość pozwalającą ustawić hasło. Przy przerwanym tworzeniu nowego konta pozostaje ono wyłączone lub bez aktywnego dostępu; administrator może dokończyć konfigurację. Kod nie kasuje kont podczas automatycznego „sprzątania”.

## Testy i ograniczenia

Nowe testy backendowe kontrolują Google provider UID, odmowę automatycznego tworzenia kont, nieaktywnych członków, konflikty UID, kontrolę origin, ukrycie sekretów oraz bezpieczeństwo operacji rodzica. Aktywacja profilu bez logowania jest dodatkowo sprawdzana dla brakującego/błędnego e-maila, odebrania rodzicowi uprawnień przed zapisem i podczas transakcji, awarii transakcji Firestore, awarii aktywacji Auth oraz awarii końcowego zapisu dostępu. W tych scenariuszach nie zostaje aktywowany nieuprawniony profil ani usunięta istniejąca historia. Istniejące wyłączone konto Auth wymaga weryfikacji administracyjnej i nie jest automatycznie włączane.

Testy przeglądarkowe używają wyłącznie lokalnego Firebase Auth/Firestore: rzeczywisty SDK sprawdza reset, weryfikację nowego e-maila, łączenie/odłączanie providerów i zachowanie UID. Tożsamość Google w emulatorze jest syntetyczna; produkcyjny endpoint nie akceptuje tego trybu i weryfikuje prawdziwy podpis Google.

Nie wykonano prawdziwego logowania Google produkcyjnym kontem rodziny. Okna OAuth, ekran zgody i autoryzowane domeny trzeba sprawdzić po konfiguracji Google/Firebase. Safari może wymagać zezwolenia na okno logowania; kod obsługuje zablokowane lub zamknięte okno bez tworzenia konta i bez utraty istniejącej sesji. Przeglądarki blokujące skrypt Google nadal umożliwiają dotychczasowe logowanie e-mailem i hasłem.
