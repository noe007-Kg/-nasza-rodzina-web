#!/usr/bin/env node
/** Production reads only. The only database writes are an existing loopback demo restore. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateHouseholdConfig } from './lib/household-migration-plan.mjs';
import { prepareHouseholdOwnerReview } from './lib/household-owner-review.mjs';
import { inspectReviewBackup } from './lib/household-review-backup.mjs';
import { assessHouseholdReadiness } from './lib/household-readiness-policy.mjs';
import { verifyProductionRules, readProductionLocations } from './lib/household-production-evidence.mjs';
import { runAutomaticRestore } from './household-preflight.mjs';
import { canonicalJson, backupDigest } from './lib/household-backup-archive.mjs';
import { assertHouseholdEnvironment } from './prepare-household-migration.mjs';
import { readPrivateBytes, readPrivateJson, securePrivateDirectory, writePrivateFile, safeControlError, controlFailure as fail } from './lib/household-private-files.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const encode = value => JSON.stringify(value,null,2)+'\n';
const quote = value => `'${value.replace(/'/g,"'\\''")}'`;
export function parseOwnerReviewArguments(args) {
  const options = {};
  for (let i=0;i<args.length;i++) {
    const key=args[i].slice(2);
    if (['--help','--interactive'].includes(args[i]) && !Object.hasOwn(options,key)) options[key]=true;
    else if (['config','preflight','output','decisions','key-file','backup-directory','second-copy'].includes(key)
      && args[i].startsWith('--') && !Object.hasOwn(options,key) && args[i+1] && !args[i+1].startsWith('--')) options[key]=args[++i];
    else fail('OWNER_REVIEW_ARGUMENT_INVALID');
  }
  if (!options.help && ['config','preflight','output'].some(key=>!options[key])) fail('OWNER_REVIEW_ARGUMENT_REQUIRED');
  if(options.interactive && options.decisions) fail('OWNER_REVIEW_DECISION_MODE_CONFLICT');
  return options;
}
async function optionalJson(file) {try {return await readPrivateJson(file);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
async function optionalBytes(file,limit) {try{return await readPrivateBytes(file,limit);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}

export async function readOwnerReviewTokens(bucket) {
  let pageToken, count=0, pages=0, privateTokenCount=0, productTokenCount=0;
  const seen=new Set(),pageTokens=new Set();
  try {
    do {
      if(++pages>1000)fail('TOKEN_SCAN_INCOMPLETE');
      const [items,next]=await bucket.getFiles({autoPaginate:false,maxResults:500,
        fields:'items(name,generation,metageneration,metadata(firebaseStorageDownloadTokens)),nextPageToken',...(pageToken?{pageToken}:{})});
      for(const item of items) {
        const value=Object.hasOwn(item,'generation')?item:item.metadata;
        if(!value||typeof value.name!=='string'||seen.has(value.name)||++count>10000)fail('TOKEN_SCAN_INCOMPLETE');
        seen.add(value.name);
        if(typeof value.metadata?.firebaseStorageDownloadTokens==='string'&&value.metadata.firebaseStorageDownloadTokens.trim()) {
          if(value.name.startsWith('quick-products/'))productTokenCount++;else privateTokenCount++;
        }
      }
      if(next?.pageToken && (typeof next.pageToken!=='string'||pageTokens.has(next.pageToken)))fail('TOKEN_SCAN_INCOMPLETE');
      if(next?.pageToken)pageTokens.add(next.pageToken);
      pageToken=next?.pageToken;
    }while(pageToken);
    return {scanVerified:true,privateTokenCount,productTokenCount};
  } catch {return {scanVerified:false,privateTokenCount:null,productTokenCount:null,code:'TOKEN_SCAN_NOT_VERIFIED'};}
}

/** Only the existing metadata allowlist is read. No document bodies or session envelopes are requested. */
export async function readOwnerReviewSource(config) {
  assertHouseholdEnvironment(config,{});
  const [{applicationDefault,initializeApp,deleteApp},{getFirestore},{getAuth},{getStorage},{GoogleAuth},{collectHouseholdInventory}]=await Promise.all([
    import('firebase-admin/app'),import('firebase-admin/firestore'),import('firebase-admin/auth'),import('firebase-admin/storage'),
    import('google-auth-library'),import('./lib/household-migration-inventory.mjs')]);
  const app=initializeApp({credential:applicationDefault(),projectId:config.projectId,storageBucket:config.bucket},`household-review-${randomUUID()}`);
  try {
    const auth=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
    const request=options=>auth.request({...options,maxContentLength:64*1024*1024,maxRedirects:0,timeout:30000});
    const results=await Promise.allSettled([
      collectHouseholdInventory({db:getFirestore(app),auth:getAuth(app),bucket:getStorage(app).bucket(config.bucket)},config),
      verifyProductionRules({request,projectId:config.projectId,bucket:config.bucket,
        localFirestoreRules:await readFile(path.join(repository,'firestore.rules'),'utf8'),
        localStorageRules:await readFile(path.join(repository,'storage.rules'),'utf8')}),
      readProductionLocations({request,projectId:config.projectId,bucket:config.bucket}),
      readOwnerReviewTokens(getStorage(app).bucket(config.bucket)),
    ]);
    if(results[0].status!=='fulfilled')fail('OWNER_REVIEW_SOURCE_NOT_VERIFIED');
    return {inventory:results[0].value,rules:results[1].status==='fulfilled'?results[1].value:{},
      locations:results[2].status==='fulfilled'?results[2].value:{},
      tokens:results[3].status==='fulfilled'?results[3].value:{scanVerified:false}};
  } finally {await deleteApp(app);}
}

export async function askOwnerReview(request,summary,ask) {
  const decisions=structuredClone(request);
  decisions.householdReviewed=(await ask('Potwierdź w prywatnej konfiguracji pięć rzeczywistych UID, role i jedno gospodarstwo. Wpisz POTWIERDZAM (samo imię nie wystarcza): ')).trim()==='POTWIERDZAM';
  if(!decisions.householdReviewed)return decisions;
  for(const row of decisions.records) {
    const display=summary.ambiguous.find(item=>item.reference===row.reviewId);
    const answer=(await ask(`${row.reviewId}: ${display.label}; odnośnik ${display.documentReference}. Sprawdź odpowiadającą ścieżkę w prywatnym pliku decyzji. Czy dokument należy do tego gospodarstwa? Wpisz TAK / NIE; Enter = brak decyzji: `)).trim();
    row.decision=answer==='TAK'?'approve':answer==='NIE'?'reject':'pending';
  }
  return decisions;
}

export function renderReviewProposal(summary) {
  return ['# Propozycja do przeglądu właściciela','',
    'Tylko przygotowanie. Nie wykonano zapisów produkcyjnych. Potwierdzenie nie oznacza zgody na migrację ani deployment.','',
    `Zmian pól: ${summary.currentCounts.fieldChanges}; dokumentów: ${summary.currentCounts.documentChanges}.`,
    `Raport wejściowy odpowiada odczytowi: ${summary.sourceReportCurrent?'TAK':'NIE — zestawienie zostało odświeżone'}.`,'',
    '| Profil | Rola | Odcisk UID | Zgodność |','| --- | --- | --- | --- |',
    ...summary.profiles.map(row=>`| ${row.label} | ${row.role} | ${row.identityReference} | ${row.verified?'TAK':'NIE'} |`),'',
    'Porównaj profile z rzeczywistymi UID w prywatnej konfiguracji. Zgodność imion nie jest dowodem wspólnego gospodarstwa.','',
    '| Odnośnik | Kolekcja | Pola | Autor/właściciel UID | Dotyczy profilu | Podstawa |','| --- | --- | --- | --- | --- | --- |',
    ...summary.assignments.map(row=>`| ${row.reference} | ${row.collection} | ${row.fields.join(', ')} | ${row.owners.join(', ')||'gospodarstwo'} | ${row.subjectProfiles.join(', ')||'gospodarstwo'} | ${row.verification} |`),'',
    '## Tylko te pozycje wymagają indywidualnej decyzji','',
    ...summary.ambiguous.map(row=>`- ${row.reference}: ${row.label}; odnośnik ${row.documentReference}. Dokładna ścieżka: prywatny plik decisions-template.private.json.`),
    ...(summary.ambiguous.length?[]:['Brak pozycji wymagających dopasowania ręcznego.']),
    '', 'Nie ma tu treści wiadomości, tytułów dokumentów medycznych, adresów URL ani tokenów. Nie potwierdzaj nierozpoznanego dokumentu.',''].join('\n');
}

const messages={
  PLAN_NOT_VERIFIED:'Pozostały blokady przypisania dokumentów; potwierdzenie nie może ich ominąć.',
  FULL_BACKUP_NOT_VERIFIED:'Brak sprawdzonej pełnej kopii dokładnie tego planu. Uruchom pełny preflight z przygotowaną konfiguracją.',
  RESTORE_NOT_VERIFIED:'Brak ponownie wykonanego poprawnego odtworzenia tej kopii w osobnym projekcie demo.',
  ROLLBACK_REHEARSAL_NOT_VERIFIED:'Brak poprawnej próby rollbacku i odmowy nadpisania równoczesnej zmiany.',
  PRODUCTION_FIRESTORE_RULES_NOT_VERIFIED:'Reguły Firestore są niedostępne albo różnią się od kandydata. Wymagany plan skoordynowanego przejścia; teraz ich nie wdrażaj.',
  PRODUCTION_STORAGE_RULES_NOT_VERIFIED:'Reguły Storage są niedostępne albo różnią się od kandydata. Wymagany plan skoordynowanego przejścia; teraz ich nie wdrażaj.',
  CAPTURE_CHANGED_OR_NOT_RECHECKED:'Kopia nie jest atomową migawką. Potrzebny świeży pełny preflight i późniejsze zatwierdzone okno bez zapisów.',
  PRIMARY_DATA_EU_LOCATION_NOT_VERIFIED:'Nie potwierdzono lokalizacji bazy i magazynu w UE.',
  EXTERNAL_FILES_NOT_FULLY_CAPTURED:'Nie potwierdzono binarnej kopii wszystkich zewnętrznych zdjęć i dokumentów.',
  OWNER_HOUSEHOLD_REVIEW_REQUIRED:'Właściciel musi potwierdzić pięć rzeczywistych UID i wspólne gospodarstwo.',
  LEGACY_HOUSEHOLD_ISOLATION_NOT_VERIFIED:'Starszy Czat i zwykłe shoppingItems nadal wymagają izolacji. Nie włączaj obsługi niezależnych gospodarstw.',
  PRIVATE_DOWNLOAD_TOKENS_REQUIRE_REVIEW:'Pełny skan tokenów jest niezweryfikowany albo wykryto tokeny. Wymagany osobno zatwierdzony plan; narzędzie ich nie usuwa.',
  AUTH_AND_PROVIDER_KEY_RECOVERY_NOT_VERIFIED:'Hasła Auth i klucze dostawców nie są częścią kopii. Potrzebne osobne potwierdzenie procedury odzyskania.',
  SECOND_BACKUP_COPY_AND_SEPARATE_KEY_NOT_VERIFIED:'Potrzebna druga rzeczywiście sprawdzona kopia poza Cloud Shell i osobne przechowywanie klucza.',
};
export function classifyOwnerWarnings(summary,readiness) {
  const gates={
    OPERATOR_ATTESTATION_IS_NOT_INDEPENDENT_HOUSEHOLD_PROOF:['household-confirmation'],
    LEGACY_NON_FINANCIAL_RULES_ARE_NOT_FULL_MULTI_HOUSEHOLD_ISOLATION:['household-isolation'],
    NO_SECRET_SESSION_OR_PROVIDER_CONTENT_INSPECTED:['account-and-key-recovery'],
    STORAGE_DOWNLOAD_TOKEN_REVOCATION_NOT_PERFORMED:['private-download-tokens'],
    STORAGE_BEARER_URL_PRESENT:['private-download-tokens'],
    METADATA_SNAPSHOT_NOT_ATOMIC:['capture-consistency'],
    DEPLOYED_RULES_NOT_VERIFIED:['production-rules-firestore','production-rules-storage'],
    FULL_DOCUMENT_AND_BINARY_BACKUP_NOT_CAPTURED:['complete-backup','restore'],
    NON_STORAGE_FILE_SOURCE_NOT_FETCHED:['external-files'],
    STORAGE_UNREFERENCED_PRESENTATION_FILE:['complete-backup'],
  };
  return Object.entries(summary.warnings).map(([code,count])=>{
    const linked=gates[code];
    const missing=linked?.filter(id=>readiness.checks.find(row=>row.id===id)?.status!=='verified');
    return {code,count,blocking:!linked||missing.length>0,
      status:!linked?'requires-individual-review':missing.length?'missing-evidence':'evidence-checked-with-scope-limitations',
      relatedChecks:linked||[],
      note:code==='OPERATOR_ATTESTATION_IS_NOT_INDEPENDENT_HOUSEHOLD_PROOF'?'Potwierdzenie operatora nie jest niezależnym dowodem gospodarstwa.':null};
  });
}
export function renderOwnerReview(result,nextCommand) {
  const {summary,readiness,backupCheck}=result;
  const lines=['# Przegląd przygotowania migracji','', 'GOTOWE DO MIGRACJI: NIE. Tryb wykonania migracji: niedostępny. Zapisów produkcyjnych: 0.','',
    `Proponowane zmiany pól: ${summary.currentCounts.fieldChanges}; dokumenty: ${summary.currentCounts.documentChanges}.`,
    `Pierwotny raport odpowiada świeżemu odczytowi: ${summary.sourceReportCurrent?'TAK':'NIE — przygotowano nowy przegląd, stare decyzje nie obowiązują'}.`,
    `Automatycznie sprawdzone dokumenty: ${summary.automaticallyVerifiedDocuments}. Niejednoznaczne pozycje: ${summary.ambiguous.length}; pozostało do rozstrzygnięcia: ${summary.unresolvedPresentationCount}.`,
    '', '| Profil | Rola | Odcisk UID | Zgodność UID/profil/Auth |','| --- | --- | --- | --- |',
    ...summary.profiles.map(row=>`| ${row.label} | ${row.role} | ${row.identityReference} | ${row.verified?'TAK':'NIE'} |`),
    '', 'Imiona nie są dowodem wspólnego gospodarstwa. Potwierdzenie właściciela nie jest niezależnym dowodem relacji rodzinnych.','',
    '## Zmiany pól','',...Object.entries(summary.currentCounts.fields).map(([field,count])=>`- ${field}: ${count}`),
    '', '## Pozycje wymagające decyzji','',...summary.ambiguous.map(row=>`- ${row.reference}: ${row.label}; odnośnik ${row.documentReference}; decyzja: ${row.decision}.`),
    ...(summary.ambiguous.length?[]:['Brak pozycji wymagających dopasowania ręcznego.']),
    '', 'Pełne zestawienie zatwierdzeń: review-summary.json. Ścieżki do lokalnego odnalezienia dokumentu są wyłącznie w decisions-template.private.json. Nie ma tam nazw plików z treści dokumentów ani tokenów.','',
    '## Kopia i odtworzenie','',
    `Integralność rzeczywistych bajtów kopii: ${backupCheck.backup?.bodyIntegrityVerified?'TAK':'NIE ZWERYFIKOWANO'}.`,
    `Kompletność i powiązanie kopii z tym planem: ${backupCheck.verified?'TAK':'NIE ZWERYFIKOWANO'}.`,
    `Ponownie wykonane odtworzenie: ${readiness.checks.find(row=>row.id==='restore')?.status==='verified'?'PASS (wyłącznie lokalne demo)':'NIE ZWERYFIKOWANO'}.`,
    ...(backupCheck.codes||[]).map(code=>`- ${code}`),
    'Plik JSON z verified=true nie zastępuje sprawdzenia archiwum ani wykonania próby. Brak magazynu/403/404 nie oznacza braku plików.','',
    '## Co blokuje dalszy etap','', ...readiness.blockers.map(code=>`- ${code}: ${messages[code]||'Wymagany przegląd dowodów; blokada pozostaje aktywna.'}`),
    ...Object.keys(summary.blockers).map(code=>`- ${code} (${summary.blockers[code]}): konfliktu nie można rozwiązać samym potwierdzeniem gospodarstwa.`),
    '', '## Ostrzeżenia i zakres dowodów','',
    ...(result.warningReview||classifyOwnerWarnings(summary,readiness)).map(row=>`- ${row.code}: ${row.count}; ${row.blocking?'BLOKUJE: brak dowodu lub wymagana decyzja':'DOWÓD SPRAWDZONY w opisanym zakresie'}${row.note?'; '+row.note:''}.`),
    '- Narzędzie sprawdza bieżące metadane i reguły; nie wykonuje ponownego pełnego skanu zawartości całej bazy. Kopia wymaga świeżego pełnego preflight.',
    '- Całościowa izolacja wielu gospodarstw, odzyskanie kont/kluczy i niezależna lokalizacja drugiej kopii nadal wymagają osobnych dowodów.',
    '- Nie odwołano tokenów, nie zmieniono uprawnień, nie usunięto plików i nie wykonano migracji ani deploymentu.','',
    '## Następna czynność','', nextCommand || 'Najpierw rozwiąż wskazane konflikty danych. Nie wdrażaj reguł ani częściowego przypisania profili.',''];
  return lines.join('\n');
}

export async function runOwnerReview(options,deps={}) {
  const config=validateHouseholdConfig(await readPrivateJson(options.config));
  const info=await lstat(options.preflight);
  if(info.isSymbolicLink())fail('PREFLIGHT_INPUT_SYMLINK_FORBIDDEN');
  const directory=info.isDirectory()?path.resolve(options.preflight):path.dirname(path.resolve(options.preflight));
  const sourcePlan=await readPrivateJson(info.isDirectory()?path.join(directory,'plan.private.json'):options.preflight);
  const output=await securePrivateDirectory(options.output);
  const source=await (deps.readSource||readOwnerReviewSource)(config);
  let review=prepareHouseholdOwnerReview(config,sourcePlan,source.inventory,options.decisions?await readPrivateJson(options.decisions):undefined);
  await writePrivateFile(path.join(output,'decisions-template.private.json'),encode(review.request));
  await writePrivateFile(path.join(output,'owner-review.md'),renderReviewProposal(review.summary));
  if(options.interactive) {
    let readline;
    const ask=deps.ask|| (process.stdin.isTTY&&process.stdout.isTTY ? await (async()=>{
      const {createInterface}=await import('node:readline/promises');readline=createInterface({input:process.stdin,output:process.stdout});
      return text=>readline.question(text);
    })() : null);
    if(!ask)fail('OWNER_REVIEW_INTERACTIVE_TTY_REQUIRED');
    try {
      console.log(`Przygotowano mapę ${review.summary.profiles.length} profili. Przed decyzją sprawdź lokalnie owner-review.md oraz decisions-template.private.json w ${output}. Nie przesyłaj tych plików do rozmowy ani GitHub.`);
      const decisions=await askOwnerReview(review.request,review.summary,ask);
      await writePrivateFile(path.join(output,'owner-decisions.private.json'),encode(decisions));
      review=prepareHouseholdOwnerReview(config,sourcePlan,source.inventory,decisions);
    } finally {readline?.close();}
  }
  const backupDir=path.resolve(options['backup-directory']||directory);
  let key,backupCheck,restore={verified:false};
  try {
    const archive=await optionalBytes(path.join(backupDir,'household-backup.nrb'));
    const keyFile=options['key-file']?path.resolve(options['key-file']):path.join(backupDir,'backup.key');
    key=archive?await optionalBytes(keyFile,32):undefined;
    const proof=await optionalJson(path.join(backupDir,'control-proof.private.json'));
    const decisionChanged=review.reviewedConfig&&canonicalJson(review.reviewedConfig.reviewedRecordPaths)!==canonicalJson(config.reviewedRecordPaths);
    backupCheck=inspectReviewBackup({archive,key,config:review.reviewedConfig||{...config,familyId:sourcePlan.familyId},
      plan:review.summary.sourceReportCurrent&&!decisionChanged?sourcePlan:review.plan,proof});
    if(backupCheck.verified) {
      try {restore=await (deps.restore||runAutomaticRestore)(output,path.join(backupDir,'household-backup.nrb'),keyFile,backupCheck.payload);}
      catch {restore={verified:false,code:'RESTORE_EXECUTION_NOT_VERIFIED'};}
    }
    let secondCopyMatches=false;
    if(options['second-copy']&&archive) {
      const [firstInfo,secondInfo]=await Promise.all([lstat(path.join(backupDir,'household-backup.nrb')),lstat(options['second-copy'])]);
      secondCopyMatches=!(firstInfo.dev===secondInfo.dev&&firstInfo.ino===secondInfo.ino)
        && backupDigest(await readPrivateBytes(options['second-copy']))===backupDigest(archive);
    }
    const readiness=assessHouseholdReadiness({plan:review.plan,planDigest:backupDigest(canonicalJson(review.plan)),
      backup:backupCheck.verified?backupCheck.backup:{...backupCheck.backup,complete:false},restore,rules:source.rules,locations:source.locations,
      // Metadata-only recheck cannot prove full backup contents stayed stable.
      consistency:{},externalFiles:backupCheck.verified?backupCheck.payload.externalFiles:undefined,
      tokens:source.tokens,
      household:{ownerReviewed:review.summary.householdConfirmed,boundPlanDigest:backupDigest(canonicalJson(review.plan))},
      isolation:{fullMultiHouseholdVerified:false},custody:{secondCopyVerified:false},recovery:{}});
    const {payload,...safeBackup}=backupCheck;
    const result={summary:review.summary,readiness,warningReview:classifyOwnerWarnings(review.summary,readiness),backupCheck:safeBackup,restore,secondCopyBytesMatch:secondCopyMatches,
      independentBackupLocationVerified:false,productionWritesPerformed:0,canApply:false,migrationExecutable:false};
    const nextDecisionFile=options.interactive?path.join(output,'owner-decisions.private.json')
      :options.decisions?path.resolve(options.decisions):path.join(output,'decisions-template.private.json');
    const carriedOptions=['backup-directory','key-file','second-copy'].filter(key=>options[key])
      .map(key=>` --${key} ${quote(path.resolve(options[key]))}`).join('');
    const decisionCommand=`node scripts/review-household-migration.mjs --config ${quote(path.resolve(options.config))} --preflight ${quote(path.resolve(options.preflight))} --output ${quote(output+'-potwierdzone')} --decisions ${quote(nextDecisionFile)}${carriedOptions}`;
    const preflightCommand=`npm run household:preflight -- --config ${quote(path.join(output,'reviewed-config.private.json'))} --output ${quote(output+'-pelna-kopia')}`;
    let next;
    if(!review.summary.householdConfirmed || review.summary.unresolvedPresentationCount) next=`Sprawdź prywatny plik decyzji. Potwierdź gospodarstwo i wyłącznie rozpoznane dokumenty (approve); pozostałe zostaw pending/reject. Następnie uruchom:\n\n\`\`\`bash\n${decisionCommand}\n\`\`\``;
    else if(!review.plan.blockers.length) {
      await writePrivateFile(path.join(output,'reviewed-config.private.json'),encode(review.reviewedConfig));
      next=`Przygotowano nową konfigurację bez nadpisania oryginału. Wykonaj świeży pełny preflight (tylko odczyt produkcji; odtworzenie lokalnie w demo):\n\n\`\`\`bash\n${preflightCommand}\n\`\`\`\n\nPotem przekaż do oceny wyłącznie liczniki i kody blokad. Migracja wymaga osobnego zatwierdzenia.`;
    }
    await writePrivateFile(path.join(output,'review-summary.json'),encode(result));
    await writePrivateFile(path.join(output,'candidate-plan.private.json'),encode(review.plan));
    await writePrivateFile(path.join(output,'report.md'),renderOwnerReview(result,next));
    return result;
  } finally {key?.fill(0);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options=parseOwnerReviewArguments(process.argv.slice(2));
    if(options.help)console.log('npm run household:review -- --config PRIVATE_CONFIG --preflight PRIVATE_EVIDENCE_DIRECTORY --output NEW_PRIVATE_DIRECTORY [--interactive | --decisions PRIVATE_DECISIONS] [--backup-directory PRIVATE_DIRECTORY] [--key-file PRIVATE_BACKUP_KEY] [--second-copy PRIVATE_ARCHIVE]. Odczyt produkcji; ewentualna próba odtworzenia tylko w lokalnym demo. Brak apply/deploy/delete.');
    else {const result=await runOwnerReview(options);console.log(`Przegląd przygotowany. Zmian pól: ${result.summary.currentCounts.fieldChanges}; pozycji do rozstrzygnięcia: ${result.summary.unresolvedPresentationCount}; blokad dowodów: ${result.readiness.blockers.length}. Zapisów produkcyjnych: 0. GOTOWE DO MIGRACJI: NIE. Instrukcja: report.md w prywatnym --output.`);}
  } catch(error){console.error(`Przegląd przerwany (${safeControlError(error)}). Zapisów produkcyjnych: 0.`);process.exitCode=2;}
}
