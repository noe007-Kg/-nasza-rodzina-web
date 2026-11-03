// Run only after the production endpoint and INPOST_CRON_SECRET are deployed.
// Usage: node scripts/deploy-inpost-scheduler.cjs <private-secret-file>
const fs=require('node:fs');
const {getGlobalDefaultAccount,setActiveAccount}=require('firebase-tools/lib/auth');
const {Client}=require('firebase-tools/lib/apiv2');
(async()=>{
  const secret=fs.readFileSync(process.argv[2],'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(secret))throw Error('Invalid scheduler secret');
  const url='https://nasza-rodzina-web.vercel.app/api/family-parcels-cron';
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`}});
  if(!response.ok)throw Error(`Production scheduler endpoint returned ${response.status}`);
  setActiveAccount({},getGlobalDefaultAccount());
  const api=new Client({urlPrefix:'https://cloudscheduler.googleapis.com',apiVersion:'v1'});
  const parent='projects/nasza-rodzina/locations/europe-west1';
  const name=parent+'/jobs/family-inpost-status';
  let exists=false;try{await api.get('/'+name);exists=true;}catch(e){if(e.status!==404)throw e;}
  const job={name,description:'Family parcels: dispatch due checks (3h active / 24h empty); no phone discovery.',
    schedule:'*/15 * * * *',timeZone:'Europe/Warsaw',attemptDeadline:'60s',retryConfig:{retryCount:0},
    httpTarget:{uri:url,httpMethod:'POST',headers:{Authorization:`Bearer ${secret}`}}};
  if(exists)await api.patch('/'+name,job,{queryParams:{updateMask:'description,schedule,timeZone,attemptDeadline,retryConfig,httpTarget'}});
  else await api.post('/'+parent+'/jobs',job);
  const result=(await api.get('/'+name)).body;
  console.log(JSON.stringify({scheduler:result.name,state:result.state,dispatch:result.schedule,activeIntervalHours:3,emptyIntervalHours:24,productionEndpointVerified:true}));
})().catch(e=>{console.error('Scheduler configuration failed:',e.status||'',e.message);process.exitCode=1;});
