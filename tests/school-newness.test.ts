import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schoolRecordIsNew} from '../src/school/newness';
test('history and uninitialized users produce no false new alerts', () => {
  const row = {id:'stable', source:'eduvulcan', createdAt:new Date(100)};
  assert.equal(schoolRecordIsNew(row, null, new Set()), false);
  assert.equal(schoolRecordIsNew(row, 200, new Set()), false);
});
test('stable identity survives repeat sync; seen state is personal', () => {
  const row = {id:'stable', source:'eduvulcan', createdAt:new Date(300)};
  assert.equal(schoolRecordIsNew(row, 200, new Set()), true);
  assert.equal(schoolRecordIsNew({...row}, 200, new Set(['stable'])), false);
  assert.equal(schoolRecordIsNew(row, 200, new Set()), true);
});
test('manual or undated source records are never advertised as new imports', () => {
  assert.equal(schoolRecordIsNew({id:'manual', createdAt:new Date(300)}, 200, new Set()), false);
  assert.equal(schoolRecordIsNew({id:'missing', source:'eduvulcan'}, 200, new Set()), false);
});
test('first-import timestamps retain sub-millisecond ordering',()=>{
 assert.equal(schoolRecordIsNew({id:'precise',source:'eduvulcan',createdAt:new Date(200),importedAt:200.9},200.5,new Set()),true);
});
