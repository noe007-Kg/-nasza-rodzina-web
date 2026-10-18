#!/usr/bin/env bash
# Read-only Cloud Shell launcher. Never deploy, migrate or enable production writes.
set +x
set -Eeuo pipefail
umask 077

readonly NR_PROJECT='nasza-rodzina'
readonly NR_SOURCE='f6187f3f6cedd094b3c811c7dfeab00723302d4d'
readonly NR_RELEASE='f46f197b344f6d7a951d2f38fef3ff4d34b35631'
readonly NR_REPOSITORY='https://github.com/noe007-Kg/-nasza-rodzina-web.git'

stop() { printf 'Kontrola zatrzymana: %s\nZapisów produkcyjnych: 0. Wdrożenia nie wykonano.\n' "$1" >&2; exit 1; }
if (( $# > 0 )); then
  stop 'Uruchom bez parametrów. Ten skrypt wykonuje kontrolę, kopię i próbę odtworzenia w emulatorach.'
fi
for nr_command in node npm java gcloud git df awk mktemp; do
  command -v "$nr_command" >/dev/null 2>&1 || stop "Brakuje narzędzia: $nr_command. Uruchom w Google Cloud Shell z Node.js 22.12+ i Java 21+."
done
for nr_emulator in FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST FIREBASE_STORAGE_EMULATOR_HOST STORAGE_EMULATOR_HOST; do
  [[ -z "${!nr_emulator:-}" ]] || stop 'Ustawiono adres emulatora. Otwórz czystą sesję Cloud Shell; kontrola musi odczytać rzeczywisty projekt.'
done

nr_node_version="$(node -p 'process.versions.node' 2>/dev/null)" || stop 'Nie można sprawdzić Node.js.'
[[ "$nr_node_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || stop 'Nie rozpoznano wersji Node.js.'
nr_node_major="${BASH_REMATCH[1]}"; nr_node_minor="${BASH_REMATCH[2]}"
if ! (( (nr_node_major == 22 && nr_node_minor >= 12) || nr_node_major == 24 )); then
  stop 'Wymagany Node.js 22.12+ lub 24. W Cloud Shell wybierz Node.js 22 (np. nvm install 22 && nvm use 22), a następnie ponów polecenie.'
fi
nr_java_version="$(java -version 2>&1)" || stop 'Nie można uruchomić Java.'
nr_java_major="$(awk -F'"' '/version/ { split($2, v, "."); print v[1]; exit }' <<< "$nr_java_version")"
[[ "$nr_java_major" =~ ^[0-9]+$ ]] && (( nr_java_major >= 21 )) || stop 'Próba odtworzenia wymaga Java 21 lub nowszej. Wybierz Java 21 w Cloud Shell i ponów polecenie.'
nr_free_kib="$(df -Pk /tmp | awk 'NR==2 {print $4}')" || stop 'Nie można sprawdzić wolnego miejsca w /tmp.'
[[ "$nr_free_kib" =~ ^[0-9]+$ ]] && (( nr_free_kib >= 4194304 )) || stop 'Potrzebne co najmniej 4 GiB wolnego miejsca w /tmp na zależności, emulatory i kopię. Nie usunięto żadnych plików.'

printf '1/4 Sprawdzam autoryzację projektu nasza-rodzina.\n'
nr_project="$(gcloud projects describe "$NR_PROJECT" --format='value(projectId)' 2>/dev/null)" || stop 'Brak dostępu do projektu nasza-rodzina. Autoryzuj Cloud Shell swoim kontem właściciela.'
[[ "$nr_project" == "$NR_PROJECT" ]] || stop 'Odpowiedź wskazuje inny projekt. Nie uruchomiono kontroli danych.'
gcloud auth application-default print-access-token >/dev/null 2>&1 || stop 'Brak autoryzacji ADC. Uruchom gcloud auth application-default login w tym terminalu; kod logowania wpisz wyłącznie w terminalu, a następnie ponów polecenie.'

NR_RUN_DIR="$(mktemp -d /tmp/nr-tasks-check.XXXXXXXX)" || stop 'Nie można utworzyć prywatnego katalogu w /tmp.'
readonly NR_RUN_DIR
nr_setup_log="$NR_RUN_DIR/setup.log"
printf '2/4 Pobieram przypiętą wersję narzędzia i reguły planowanego wydania.\n'
git init --quiet "$NR_RUN_DIR/repo" >"$nr_setup_log" 2>&1 || stop 'Nie można przygotować tymczasowego repozytorium.'
git -C "$NR_RUN_DIR/repo" remote add origin "$NR_REPOSITORY" >>"$nr_setup_log" 2>&1 || stop 'Nie można ustawić źródła narzędzia.'
git -C "$NR_RUN_DIR/repo" fetch --quiet --depth 1 origin "$NR_SOURCE" "$NR_RELEASE" >>"$nr_setup_log" 2>&1 || stop "Nie można pobrać wersji narzędzia. Prywatny dziennik: $nr_setup_log (nie przesyłaj jego treści)."
git -C "$NR_RUN_DIR/repo" checkout --quiet --detach "$NR_SOURCE" >>"$nr_setup_log" 2>&1 || stop 'Nie można wybrać przypiętej wersji narzędzia.'
nr_actual_source="$(git -C "$NR_RUN_DIR/repo" rev-parse HEAD 2>/dev/null)" || stop 'Nie można zweryfikować wersji narzędzia.'
[[ "$nr_actual_source" == "$NR_SOURCE" ]] || stop 'Wersja pobranego narzędzia nie zgadza się z zatwierdzonym commitem.'
git -C "$NR_RUN_DIR/repo" cat-file -e "$NR_RELEASE^{commit}" >>"$nr_setup_log" 2>&1 || stop 'Brakuje reguł właściwego wydania aplikacji.'

printf '3/4 Instaluję lokalne zależności. Pierwsze uruchomienie może potrwać kilka minut.\n'
cd "$NR_RUN_DIR/repo"
npm --cache "$NR_RUN_DIR/npm-cache" ci --ignore-scripts --no-audit --no-fund >>"$nr_setup_log" 2>&1 || stop "Instalacja zależności nie powiodła się. Prywatny dziennik: $nr_setup_log (nie przesyłaj jego treści)."

printf '4/4 Odczytuję dane, tworzę zaszyfrowaną kopię i próbuję odtworzenia lokalnie.\n'
printf 'Wynik i kopia pozostają w prywatnym katalogu: %s/private\n' "$NR_RUN_DIR"
nr_exit=0
FIREBASE_EMULATORS_PATH="$NR_RUN_DIR/emulators" node scripts/tasks-release-preflight.mjs --backup --output "$NR_RUN_DIR/private" || nr_exit=$?
if (( nr_exit != 0 && nr_exit != 2 )) || [[ ! -s "$NR_RUN_DIR/private/tasks-release-summary.json" ]]; then
  stop "Kontrola nie zakończyła raportu. Zachowano katalog $NR_RUN_DIR; nie włączaj zapisów."
fi
printf '\nKontrola zakończona. Pozostałe blokady są wypisane powyżej; nie oznacza to gotowości do wdrożenia.\n'
printf 'Przekaż tylko podsumowanie z terminala. Nie przesyłaj archiwum, klucza ani prywatnych dzienników.\n'
printf 'Zachowaj archiwum i klucz oddzielnie poza /tmp oraz drugą kopię: /tmp jest tymczasowy.\n'
printf 'Nie wdrożono aplikacji. Nie zmieniono reguł ani danych produkcyjnych.\n'
# Preserve the diagnostic blocked status; never convert it into release success.
exit "$nr_exit"
