#!/usr/bin/env node
/** One-command diagnostics. No production mutations, secret reads or apply mode. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {access,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {validateHouseholdConfig} from './lib/household-migration-plan.mjs';
import {readPrivateJson,readPrivateBytes,securePrivateDirectory,writePrivateFile,controlFailure as fail} from './lib/household-private-files.mjs';
import {canonicalJson,backupDigest} from './lib/household-backup-archive.mjs';
import {assessHouseholdReadiness} from './lib/household-readiness-policy.mjs';
import {buildHouseholdDiagnosticSummary,renderHouseholdDiagnostics} from './lib/household-diagnostics.mjs';
import {runOwnerReview,readOwnerReviewSource} from './review-household-migration.mjs';
import {runHouseholdPreflight,parsePreflightArguments} from './household-preflight.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url));
const encode=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>backupDigest(canonicalJson(value));
export function parseDiagnosticArguments(args) {
  const options={};
  for(let i=0;i<args.length;i++) {
    const key=args[i].slice(2);
    if(['--help','--interactive'].includes(args[i])&&!Object.hasOwn(options,key))options[key]=true;
    else if(['config','review','output','preflight','decisions','external-domains-file','app-origin','archive','second-copy'].includes(key)
      &&args[i].startsWith('--')&&!Object.hasOwn(options,key)&&args[i+1]&&!args[i+1].startsWith('--'))options[key]=args[++i];
    else fail('DIAGNOSTIC_ARGUMENT_INVALID');
  }
  if(!options.help&&(!options.config||!options.review))fail('DIAGNOSTIC_CONFIG_AND_REVIEW_REQUIRED');
  if(options.interactive&&options.decisions)fail('DIAGNOSTIC_DECISION_MODE_CONFLICT');
  if(Boolean(options.archive)!==Boolean(options['second-copy']))fail('DIAGNOSTIC_ARCHIVE_PAIR_REQUIRED');
  if(options['app-origin'])parsePreflightArguments(['--config','private-config','--output','private-output','--app-origin',options['app-origin']]);
  return options;
}

export async function compareDiagnosticArchives(first,second) {
  const result={comparisonPerformed:false,bytesMatch:false,distinctFiles:false,authenticationVerified:false,
    independentLocationVerified:false,boundToCurrentPlan:false};
  if(!first||!second)return result;
  try {
    const [a,b,left,right]=await Promise.all([lstat(first),lstat(second),readPrivateBytes(first),readPrivateBytes(second)]);
    if(!left.subarray(0,5).equals(Buffer.from('NRHB1'))||!right.subarray(0,5).equals(Buffer.from('NRHB1')))return result;
    return {...result,comparisonPerformed:true,bytesMatch:backupDigest(left)===backupDigest(right),
      distinctFiles:!(a.dev===b.dev&&a.ino===b.ino)};
  } catch{return result;}
}

export async function readDiagnosticEnvironment() {
  const [major,minor]=process.versions.node.split('.').map(Number);
  let java21=false,restoreCliAvailable=false;
  await Promise.allSettled([
    promisify(execFile)('java',['-version'],{timeout:10000,maxBuffer:16384}).then(({stdout,stderr})=>{
      const version=/(?:openjdk|java)(?:\s+version)?\s+"?(\d+)/i.exec(stdout+'\n'+stderr);
      java21=Number(version?.[1])>=21;
    }),
    access(path.join(repository,'node_modules/firebase-tools/lib/bin/firebase.js')).then(()=>{restoreCliAvailable=true;}),
  ]);
  return {node22:major===22&&minor>=12,java21,restoreCliAvailable};
}

/** Rebind household confirmation only; this is never approval of a new plan. */
export function confirmedHouseholdStillValid(config,context) {
  if(!context?.plan||!context.inventory||context.plan.blockers?.length!==0||context.plan.summary?.membersVerified!==5
    ||context.plan.projectId!==config.projectId||context.plan.bucket!==config.bucket||context.plan.familyId!==config.familyId)return false;
  const rows=new Map(Object.values(context.inventory.collections||{}).flat().map(row=>[row.path,row]));
  for(const member of config.members) {
    const data=rows.get(`members/${member.uid}`)?.data;
    if(!data||data.name!==member.expectedName||data.role!==member.expectedRole||data.canLogin!==member.expectedCanLogin
      ||data.active!==true||data.archived===true||data.disabled===true
      ||member.expectedPersonKey!==undefined&&data.personKey!==member.expectedPersonKey)return false;
    const accounts=context.inventory.auth.filter(row=>row.uid===member.uid);
    if(accounts.length!==1||member.expectedCanLogin&&(accounts[0].exists!==true||accounts[0].disabled!==false))return false;
  }
  for(const receipt of config.reviewedRecordVersions||[])if(sha(rows.get(receipt.path)?.updateTime||null)!==sha(receipt.updateTime))return false;
  return true;
}

function freshReadiness(review,context,config) {
  const digest=sha(context.plan);
  if(context.planDigest!==digest)fail('DIAGNOSTIC_RUNTIME_PLAN_BINDING_FAILED');
  const householdConfirmed=review.summary.householdConfirmed&&confirmedHouseholdStillValid(config,context);
  const readiness=assessHouseholdReadiness({
    plan:context.plan,planDigest:digest,backup:context.captureComplete?context.backup:{...context.backup,complete:false},
    restore:context.restore,rules:context.rules,locations:context.locations,consistency:context.consistency,
    externalFiles:context.captureComplete?context.externalFiles:undefined,tokens:context.tokens,
    household:{ownerReviewed:householdConfirmed,boundPlanDigest:digest},
    isolation:{fullMultiHouseholdVerified:false},recovery:{},custody:{},
  });
  const counts={};for(const row of context.plan.blockers||[])counts[row.code]=(counts[row.code]||0)+1;
  return {...review,readiness,summary:{...review.summary,householdConfirmed,blockers:counts,
    currentCounts:{...review.summary.currentCounts,fieldChanges:context.plan.changes.length},
    unresolvedPresentationCount:(context.plan.blockers||[]).filter(row=>row.code==='ISOLATION_PRESENTATION_OWNER_REVIEW_REQUIRED').length}};
}

export async function runHouseholdDiagnostics(options,deps={}) {
  const input=await lstat(options.review);if(input.isSymbolicLink())fail('DIAGNOSTIC_REVIEW_SYMLINK_FORBIDDEN');
  const directory=input.isDirectory()?path.resolve(options.review):path.dirname(path.resolve(options.review));
  const previous=await readPrivateJson(input.isDirectory()?path.join(directory,'review-summary.json'):options.review);
  const config=validateHouseholdConfig(await readPrivateJson(options.config));
  const output=await securePrivateDirectory(options.output||path.join(path.dirname(directory),`diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`));
  if(!options.output)(deps.notify||console.log)(`Utworzono prywatny katalog techniczny ${path.basename(output)} obok katalogu wejściowego --review.`);
  const environment=await(deps.environment||readDiagnosticEnvironment)();
  const sourcePlan=options.preflight||path.join(directory,'candidate-plan.private.json');
  // Stage one must never search old directories for encryption keys or secrets.
  // A fresh full preflight below handles its own new local backup internally.
  const noSecrets=await securePrivateDirectory(path.join(output,'metadata-only'));
  let current=null,source={},freshEvidence=null,fullPreflightAttempted=false,executionFailure=false;
  const automationNotes=[];
  const archiveCopies=await compareDiagnosticArchives(options.archive,options['second-copy']);
  if(options.interactive)(deps.notify||console.log)('Przed potwierdzeniem sprawdź owner-review/owner-review.md i decisions-template.private.json w prywatnym katalogu wyniku. Nie przesyłaj tych plików do rozmowy ani GitHub.');
  try {
    current=await(deps.review||runOwnerReview)({config:options.config,preflight:sourcePlan,
      output:path.join(output,'owner-review'),'backup-directory':noSecrets,
      ...(options.interactive?{interactive:true}:{}),...(options.decisions?{decisions:options.decisions}:{})},
    {readSource:async selected=>{source=await(deps.readSource||(config=>readOwnerReviewSource(config,{allowPartial:true})))(selected);return source;},
      ...(deps.ask?{ask:deps.ask}:{}),notify:()=>{}});
    if(current.summary.householdConfirmed&&current.summary.unresolvedPresentationCount===0
      &&Object.keys(current.summary.blockers).length===0&&environment.node22) {
      const reviewedConfigFile=path.join(output,'owner-review','reviewed-config.private.json');
      const reviewedConfig=validateHouseholdConfig(await readPrivateJson(reviewedConfigFile));
      fullPreflightAttempted=true;
      let callbacks=0;
      await(deps.preflight||runHouseholdPreflight)({config:reviewedConfigFile,output:path.join(output,'complete-preflight'),
        ...(options['external-domains-file']?{'external-domains-file':options['external-domains-file']}:{}),
        ...(options['app-origin']?{'app-origin':options['app-origin']}:{})},
      {onEvidence:async context=>{
        if(++callbacks!==1)fail('DIAGNOSTIC_RUNTIME_EVIDENCE_INVALID');
        if(context) {
          current=freshReadiness(current,context,reviewedConfig);
          freshEvidence=context;
          source={...source,rules:context.rules,locations:context.locations,tokens:context.tokens};
        }
      }});
      if(callbacks!==1||!freshEvidence){executionFailure=true;automationNotes.push('FULL_PREFLIGHT_EVIDENCE_NOT_AVAILABLE');}
    } else automationNotes.push(!environment.node22?'NODE22_REQUIRED_FOR_FULL_PREFLIGHT':'OWNER_OR_DATA_REVIEW_NOT_COMPLETE');
  } catch {executionFailure=true;automationNotes.push('READ_ONLY_DIAGNOSTIC_STAGE_NOT_COMPLETED');}
  // Independent successful GET checks survive an unavailable inventory. Neither
  // identity, ownership, plan completeness nor any backup can be inferred here.
  if(!current)current={readiness:assessHouseholdReadiness({rules:source.rules,locations:source.locations,tokens:source.tokens})};
  const summary=buildHouseholdDiagnosticSummary({previous,current,source,freshEvidence,fullPreflightAttempted,executionFailure,environment});
  summary.archiveCopies=archiveCopies;
  summary.automationNotes=automationNotes;
  if(!environment.java21)summary.automationNotes.push('JAVA21_NOT_VERIFIED');
  if(!environment.restoreCliAvailable)summary.automationNotes.push('RESTORE_CLI_NOT_AVAILABLE');
  await writePrivateFile(path.join(output,'diagnostic-summary.json'),encode(summary));
  await writePrivateFile(path.join(output,'report.md'),renderHouseholdDiagnostics(summary));
  return summary;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options=parseDiagnosticArguments(process.argv.slice(2));
    if(options.help)console.log('npm run household:diagnose -- --config PRIVATE_CONFIG --review PREVIOUS_PRIVATE_REVIEW [--output NEW_PRIVATE_DIRECTORY] [--interactive | --decisions PRIVATE_DECISIONS] [--preflight PRIVATE_ORIGINAL_PLAN] [--external-domains-file PRIVATE_ALLOWLIST] [--app-origin HTTPS_ORIGIN] [--archive PRIVATE_ARCHIVE --second-copy PRIVATE_ARCHIVE]. Bez zapisów produkcyjnych i Secret Manager. Pełny preflight oraz lokalne demo tylko po rozstrzygnięciu właściciela i blokad planu.');
    else {const result=await runHouseholdDiagnostics(options);console.log(renderHouseholdDiagnostics(result));}
  } catch {console.error('DIAGNOSTIC_INPUT_OR_LOCAL_OUTPUT_NOT_VERIFIED. Zapisów produkcyjnych: 0. GOTOWE DO MIGRACJI: NIE. Sprawdź prywatne ścieżki, uprawnienia i format raportu.');process.exitCode=2;}
}
