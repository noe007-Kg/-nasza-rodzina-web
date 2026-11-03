import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTracking, projectShipxParcel, POLL_MS } from '../server/inpost-provider.mjs';

const number = '600000658493991742009752';
const parcel = { tracking_number:number, status:'ready_to_pickup', updated_at:'2026-11-03T10:01:00Z',
  tracking_details:[{status:'ready_to_pickup',datetime:'2026-11-03T10:00:00Z'},{status:'out_for_delivery',datetime:'2026-11-03T08:00:00Z'}],
  custom_attributes:{target_machine_detail:{name:'KOL01A'}} };
test('public tracking needs no credentials and exposes only projected status data',async()=>{
  const result = await fetchTracking([number],{env:{},fetcher:async(url,options)=>{
    assert.equal(String(url),`https://api-shipx-pl.easypack24.net/v1/tracking/${number}`);
    assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.redirect,'error');
    return Response.json({...parcel,receiver:{phone:'private'},pickup_code:'private'});
  }});
  assert.deepEqual(result,{updates:{[number]:{statusCode:'ready_to_pickup',status:'Czeka w paczkomacie lub punkcie odbioru',active:true,updatedAt:'2026-11-03T10:00:00.000Z',locker:'KOL01A'}}});
});
test('missing, invalid, failed and rate limited parcels preserve successful results',async()=>{
  const other='600000658493991742009753';
  for(const status of [404,429,503]) {
    const result=await fetchTracking([number,other],{env:{},fetcher:async url=>String(url).endsWith(number)?Response.json(parcel):new Response('',{status,headers:{'retry-after':'3600'}})});
    assert.equal(result.updates[number].statusCode,'ready_to_pickup');
    assert.equal(result.updates[other],undefined);
    assert.equal(result.unavailable,status===404?'not-found':status===429?'rate-limit':'provider');
    assert.equal(result.retryMs,3600000);
  }
  const invalid=await fetchTracking([number],{env:{},fetcher:async()=>Response.json({...parcel,tracking_number:other})});
  assert.equal(invalid.unavailable,'provider');assert.deepEqual(invalid.updates,{});
  const failed=await fetchTracking([number],{env:{},fetcher:async()=>{throw Error('timeout');}});
  assert.equal(failed.unavailable,'provider');
});
test('terminal states, unknown status and malformed timestamps',()=>{
  for(const status of ['delivered','returned_to_sender','canceled']) assert.equal(projectShipxParcel({...parcel,status}).active,false);
  assert.equal(projectShipxParcel({...parcel,status:'new_future_status'}).active,true);
  assert.equal(projectShipxParcel({...parcel,tracking_details:[],updated_at:'bad'}),null);
  assert.equal(projectShipxParcel(null),null);
});
test('bounded concurrency, strict inputs, deduplication and rate limit backoff',async()=>{
  const numbers=Array.from({length:20},(_,i)=>String(i).padStart(24,'0'));
  let inFlight=0,maximum=0,calls=0;
  await fetchTracking([...numbers,numbers[0]],{env:{},fetcher:async url=>{
    calls++;inFlight++;maximum=Math.max(maximum,inFlight);
    await new Promise(resolve=>setTimeout(resolve,1));inFlight--;
    return Response.json({...parcel,tracking_number:String(url).split('/').at(-1)});
  }});
  assert.equal(calls,20);assert.equal(maximum,5);
  await assert.rejects(fetchTracking([number+'/evil'],{env:{}}));
  await assert.rejects(fetchTracking([...numbers,'9'.repeat(24)],{env:{}}));
  calls=0;
  const result=await fetchTracking(numbers,{env:{},fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'600'}});}});
  assert.equal(calls,5);assert.equal(result.retryMs,POLL_MS);
});
