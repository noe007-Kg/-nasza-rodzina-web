/** Evidence classification only. Never imports a production write service. */
const row=(check,title,action)=>({check,title,action});
export const DIAGNOSTIC_CATALOG=Object.freeze({
  PLAN_NOT_VERIFIED:row('migration-plan','Przypisanie dokumentów','Rozwiąż wskazaną przyczynę; zgoda nie zastępuje brakującego UID ani nie usuwa konfliktu.'),
  FULL_BACKUP_NOT_VERIFIED:row('complete-backup','Pełna kopia','Wymagana rzeczywista zaszyfrowana kopia tego planu: AEAD, manifest, hashe, kompletność i powiązanie wersji.'),
  RESTORE_NOT_VERIFIED:row('restore','Odtworzenie','Wymagane wykonane odtworzenie właściwego archiwum w świeżym lokalnym demo, zgodne liczniki i kod zakończenia 0.'),
  ROLLBACK_REHEARSAL_NOT_VERIFIED:row('rollback-rehearsal','Rollback','Wymagana próba wielopolowego planu i cofnięcia w demo, porównanie pól oraz odmowa nieaktualnej wersji.'),
  PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED:row('production-rules-firestore','Reguły Firestore','Rozróżnij brak odczytu od potwierdzonej różnicy. Przygotuj skoordynowany plan przejścia, bez publikowania reguł teraz.'),
  PRODUCTION_STORAGE_RULES_NOT_VERIFIED:row('production-rules-storage','Reguły Storage','Jak dla Firestore; sprawdź właściwy magazyn. Nie publikuj reguł w ramach diagnostyki.'),
  CAPTURE_CHANGED_OR_NOT_RECHECKED:row('capture-consistency','Spójność kopii','Wymagany pełny ponowny odczyt bazy, wersji plików i metadanych Auth. Zgodne skany nadal nie są atomową migawką.'),
  PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED:row('eu-primary-storage','Lokalizacja w UE','Odczytaj lokalizacje bazy i magazynu. Nie przenoś danych ani nie twórz magazynu.'),
  EXTERNAL_FILES_NOT_FULLY_CAPTURED:row('external-files','Zewnętrzne zdjęcia i dokumenty','Wymagane pokrycie referencji rzeczywistymi bajtami i hashami, z allowlistą domen i ochroną SSRF.'),
  OWNER_HOUSEHOLD_REVIEW_REQUIRED:row('household-confirmation','Potwierdzenie gospodarstwa','Właściciel potwierdza pięć rzeczywistych UID i jedno gospodarstwo; imię ani rola nie są samodzielnym dowodem.'),
  LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED:row('household-isolation','Starsze moduły','Starszy Czat i shoppingItems nadal wymagają izolacji. Nie włączaj wielu niezależnych gospodarstw.'),
  PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW:row('private-download-tokens','Tokeny pobierania','Odróżnij niekompletny skan od wykrytych tokenów. Ich zmiana wymaga osobnego zatwierdzenia; narzędzie jej nie wykonuje.'),
  AUTH_AND_PROVIDER_KEY_RECOVERY_NOT_VERIFIED:row('account-and-key-recovery','Odzyskanie kont i kluczy','Właściciel musi zapewnić osobną procedurę odzyskania kont i zachowania kluczy. Nie przesyłaj wartości ani nie odczytuj Secret Manager.'),
  SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED:row('backup-custody','Niezależna kopia i piecza','Potrzebna zweryfikowana druga kopia poza Cloud Shell oraz osobne przechowywanie klucza. Inny plik lokalny tego nie dowodzi.'),
});
const own=(value,key)=>Object.hasOwn(value||{},key);
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const problemCodes=new Set(['EXISTING_FAMILY_CONFLICT','FOREIGN_OR_INVALID_UID_REFERENCE','MEMBER_ALREADY_ASSIGNED_OR_INVALID',
  'MEMBER_IDENTITY_MISMATCH','PERSON_KEY_COLLISION_WITH_FOREIGN_MEMBER','REVIEWED_RECORD_VERSION_CHANGED']);
export function sourceDiagnosticCodes(previous) {
  const codes=previous?.readiness?.blockers;
  if(!Array.isArray(codes)||codes.length>1000)return {valid:false,known:[],unknownCount:0,reportedCount:null};
  const known=[...new Set(codes.filter(code=>typeof code==='string'&&own(DIAGNOSTIC_CATALOG,code)))];
  return {valid:true,known,unknownCount:codes.filter(code=>typeof code!=='string'||!own(DIAGNOSTIC_CATALOG,code)).length,reportedCount:codes.length};
}

export function buildHouseholdDiagnosticSummary({previous,current,source={},freshEvidence=null,fullPreflightAttempted=false,
  executionFailure=false,environment={}}) {
  const prior=sourceDiagnosticCodes(previous),checks=current?.readiness?.checks||[];
  const find=id=>checks.find(item=>item.id===id), planBlocks=current?.summary?.blockers||{};
  const technical=Object.keys(planBlocks).some(code=>problemCodes.has(code));
  const rows=Object.entries(DIAGNOSTIC_CATALOG).map(([code,rule])=>{
    const verified=find(rule.check)?.status==='verified';
    let kind='missing-evidence';
    if(verified)kind='verified';
    else if(code==='OWNER_HOUSEHOLD_REVIEW_REQUIRED'||code==='AUTH_AND_PROVIDER_KEY_RECOVERY_NOT_VERIFIED'
      ||code==='SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED')kind='owner-confirmation-required';
    else if(code==='LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED')kind='confirmed-code-limitation';
    else if(code==='PLAN_NOT_VERIFIED')kind=technical?'confirmed-data-conflict':
      current?.summary?.unresolvedPresentationCount>0?'owner-confirmation-required':'missing-evidence';
    else if(code.startsWith('PRODUCTION_')) {
      const service=code.includes('FIRESTORE')?'firestore':'storage';
      if(source.rules?.[service]?.status==='mismatch')kind='confirmed-configuration-difference';
      else if(source.rules?.[service]?.status==='changed')kind='confirmed-concurrent-change';
    } else if(code==='PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED'&&['firestore','storage'].some(service=>
      source.locations?.[service]?.verified===true&&source.locations[service].europeanUnion===false))kind='confirmed-non-eu-location';
    else if(code==='PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW'&&source.tokens?.scanVerified===true
      &&(source.tokens.privateTokenCount>0||source.tokens.productTokenCount>0))kind='confirmed-token-presence';
    else if(code==='CAPTURE_CHANGED_OR_NOT_RECHECKED'&&freshEvidence?.consistency
      &&Object.values(freshEvidence.consistency).some(item=>item?.checked===true&&item.stable===false))kind='confirmed-concurrent-change';
    return {code,check:rule.check,title:rule.title,kind,verified,previouslyBlocked:prior.known.includes(code),action:rule.action};
  });
  const unknown=Array.from({length:prior.unknownCount},(_,index)=>({code:`UNRECOGNIZED_BLOCKER_${index+1}`,
    kind:'unclassified-requires-review',verified:false,previouslyBlocked:true,
    action:'Nieznany kod zachowano jako blokadę. Przeglądaj go wyłącznie w prywatnym raporcie; nie kopiuj surowej wartości do publicznego podsumowania.'}));
  if(!prior.valid)unknown.push({code:'SOURCE_REVIEW_CODES_NOT_VERIFIED',kind:'unclassified-requires-review',verified:false,
    previouslyBlocked:false,action:'Nie potwierdzono formatu listy blokad w wejściowym prywatnym raporcie. Sprawdź wskazany plik.'});
  const knownPlanCodes=new Set(['ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED',...problemCodes]);
  const planIssues=Object.entries(planBlocks).map(([code,n],index)=>({
    code:knownPlanCodes.has(code)?code:`UNCLASSIFIED_PLAN_ISSUE_${index+1}`,count:count(n),
    kind:code==='ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED'?'owner-confirmation-required':problemCodes.has(code)?'confirmed-data-conflict':'unclassified-requires-review'}));
  return {schemaVersion:1,mode:'read-only-final-diagnostics',canApply:false,migrationExecutable:false,productionWritesPerformed:0,
    readyForMigration:false,sourceCodesVerifiedLocally:prior.valid,sourceBlockerCount:prior.reportedCount,
    originalFieldChanges:count(previous?.summary?.currentCounts?.fieldChanges),
    currentFieldChanges:count(current?.summary?.currentCounts?.fieldChanges),
    remainingOwnerDecisions:count(current?.summary?.unresolvedPresentationCount),
    fullPreflightAttempted,executionFailure,environment:{node22:environment.node22===true,java21:environment.java21===true,restoreCliAvailable:environment.restoreCliAvailable===true},
    checks:[...rows,...unknown],planIssues,verifiedChecks:rows.filter(item=>item.verified).length,
    remainingChecks:rows.filter(item=>!item.verified).length+unknown.length,
    sourceReviewCountsAreNotSecurityEvidence:true,captureIsAtomic:false,
    secretManagerValuesRead:false,secretValuesIncludedInReport:false,providerEncryptionKeyRead:false,
    note:'Zgoda na gospodarstwo i pojedynczy rekord nie jest zgodą na migrację, wdrożenie ani zmianę sekretów.'};
}

const kindLabel={verified:'SPRAWDZONE', 'missing-evidence':'BRAK DOWODU','owner-confirmation-required':'WYMAGA POTWIERDZENIA WŁAŚCICIELA',
  'confirmed-code-limitation':'POTWIERDZONE OGRANICZENIE KODU','confirmed-data-conflict':'POTWIERDZONY KONFLIKT DANYCH',
  'confirmed-configuration-difference':'POTWIERDZONA RÓŻNICA KONFIGURACJI','confirmed-concurrent-change':'WYKRYTA ZMIANA',
  'confirmed-token-presence':'WYKRYTO OBIEKTY Z TOKENAMI','confirmed-non-eu-location':'LOKALIZACJA POZA UE',
  'unclassified-requires-review':'WYMAGA INDYWIDUALNEJ ANALIZY'};
export function renderHouseholdDiagnostics(summary) {
  return ['# Zbiorcza diagnostyka przygotowania migracji','',
    'GOTOWE DO MIGRACJI: NIE. Zapisów produkcyjnych: 0. Migracja i deployment nie są dostępne.','',
    `Blokady raportu wejściowego: ${summary.sourceBlockerCount??'niezweryfikowane'}. Plan wejściowy: ${summary.originalFieldChanges??'niezweryfikowany'} zmian pól.`,
    `Plan bieżący: ${summary.currentFieldChanges??'niezweryfikowany'} zmian pól. Pozostałe decyzje właściciela: ${summary.remainingOwnerDecisions??'niezweryfikowane'}.`,
    `Kontrole sprawdzone: ${summary.verifiedChecks}; pozostałe: ${summary.remainingChecks}. Próba pełnego preflight: ${summary.fullPreflightAttempted?'TAK — wynik według dowodów poniżej':'NIE'}.`,'',
    '| Kod | Blokował poprzednio | Wynik | Co dalej |','| --- | --- | --- | --- |',
    ...summary.checks.map(item=>`| ${item.code} | ${item.previouslyBlocked?'TAK':'—'} | ${kindLabel[item.kind]} | ${item.action} |`),'',
    '## Środowisko i przebieg','',
    `Node.js 22: ${summary.environment.node22?'sprawdzono':'nie potwierdzono'}. Java 21+: ${summary.environment.java21?'sprawdzono':'nie potwierdzono'}. Lokalny Firebase CLI: ${summary.environment.restoreCliAvailable?'dostępny':'nie potwierdzono'}.`,
    `Przerwane lub nieukończone kontrole: ${summary.executionFailure?'TAK — nie przyznano brakujących zaliczeń':'nie zgłoszono'}.`,
    ...(summary.automationNotes||[]).map(code=>`- ${code}`),'',
    '## Przyczyny dotyczące przypisań','',
    ...summary.planIssues.map(item=>`- ${item.code}: ${item.count??'liczba niezweryfikowana'}; ${kindLabel[item.kind]}.`),
    ...(summary.planIssues.length?[]:['Brak wykazanych konfliktów planu albo odczyt źródła nie został ukończony — rozstrzyga kontrola PLAN_NOT_VERIFIED.']),
    '', '## Rozstrzygnięcie niejednoznacznej pozycji','',
    'Nie przypisuj automatycznie ownerUid. Sprawdź lokalny odnośnik R001, kolekcję i wersję w prywatnym pliku decyzji. Zatwierdź przynależność do gospodarstwa tylko po sprawdzeniu pochodzenia. Brak pewności pozostawia pending/reject i blokadę.',
    '', '## Wymagane dowody','',
    '- Kopia: rzeczywiste bajty zaszyfrowanego archiwum, sprawdzenie AEAD, hashe binariów i dokumentów, pełne pokrycie referencji i dokładny plan/wersje/pięć UID.',
    '- Odtworzenie: wykonanie na świeżym lokalnym demo z właściwego archiwum, zgodne dane i liczniki, bezpieczeństwo celu oraz kod procesu 0. Sam JSON verified=true nie wystarcza.',
    '- Rollback: próba planu i cofnięcia wszystkich zmienionych pól w demo oraz odmowa nieaktualnego pokwitowania. Nie wykonuje się rollbacku produkcyjnego.',
    `- Porównanie wskazanych archiwów: ${summary.archiveCopies?.comparisonPerformed?'wykonano; '+(summary.archiveCopies.bytesMatch?'bajty zgodne':'bajty różne')+'; '+(summary.archiveCopies.distinctFiles?'różne pliki':'ten sam plik lub hardlink'):'nie wykonano / brak pełnych danych'}. Samo porównanie bajtów nie potwierdza AEAD, kompletności, aktualnego planu ani niezależnego miejsca przechowywania.`,
    '- Świeży pełny skan bazy, Storage i Auth daje dowód zgodności odczytów w danym czasie; nie daje atomowej migawki ani gwarancji braku późniejszych zmian.',
    '', '## Niezbędne czynności właściciela','',
    'Potwierdź rzeczywiste gospodarstwo i rozpoznany dokument; zapewnij niezależną drugą kopię poza Cloud Shell i oddzielną pieczę nad kluczem oraz sprawdzoną procedurę odzyskania kont i sekretów. Nie wpisuj wartości kluczy ani tokenów w raporcie.',
    '', 'Narzędzie nie odczytuje wartości Secret Manager ani klucza szyfrowania eduVULCAN. Klucz nowej kopii jest obsługiwany wyłącznie wewnętrznie przez istniejący preflight i nie trafia do raportu. Nie zmieniono reguł, sekretów, tokenów ani danych produkcyjnych.',''].join('\n');
}
