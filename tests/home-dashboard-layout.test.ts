import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOME_LAYOUT, homeLayoutCacheKey, moveHomeTile, reconcileHomeLayout } from '../src/features/home-dashboard-layout';
test('reconciliation keeps saved order and size, appends future tiles, removes retired and repeated IDs',()=>{
  const result=reconcileHomeLayout([{id:'parcels',size:'small'},{id:'old',size:'large'},{id:'parcels',size:'large'}]);
  assert.equal(result.length,6);assert.deepEqual(result[0],{id:'parcels',size:'small'});assert.equal(result[1].id,'family');
  assert.deepEqual(reconcileHomeLayout(null),DEFAULT_HOME_LAYOUT);assert.notEqual(homeLayoutCacheKey('one'),homeLayoutCacheKey('two'));
});
test('moving a tile preserves sizes and does not mutate the saved layout',()=>{
  const original=DEFAULT_HOME_LAYOUT.map(t=>({...t}));const next=moveHomeTile(original,'parcels','family');
  assert.equal(next[0].id,'parcels');assert.equal(next[0].size,'small');assert.deepEqual(original,DEFAULT_HOME_LAYOUT);
});
