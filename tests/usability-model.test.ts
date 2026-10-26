import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rewardImageDimensions} from '../src/features/reward-image';
import {schoolHomeEntries} from '../src/features/school-home';
import type {CalendarSchoolDisplayRecord} from '../src/useCalendarSchoolSources';
test('reward photos retain orientation and aspect ratio without upscaling',()=>{
  assert.deepEqual(rewardImageDimensions(4000,3000),{width:1600,height:1200});
  assert.deepEqual(rewardImageDimensions(1200,4000),{width:480,height:1600});
  assert.deepEqual(rewardImageDimensions(600,400),{width:600,height:400});
  assert.throws(()=>rewardImageDimensions(0,300)); assert.throws(()=>rewardImageDimensions(20000,20000));
});
const row=(id:string,type='grade',createdAt?:Date):CalendarSchoolDisplayRecord=>({id,type:type as 'grade',person:'Nikodem',title:'5',subject:'Matematyka',date:'',createdAt});
test('school preview prioritizes new records, excludes timetables and never invents added dates',()=>{
  const result=schoolHomeEntries([row('old','grade',new Date('2026-10-20T09:00:00Z')),row('fresh','homework',new Date('2026-10-21T09:00:00Z')),row('latest','test',new Date('2026-10-22T09:00:00Z')),row('lesson','lesson'),row('undated','message')],r=>r.id==='fresh');
  assert.deepEqual(result.map(r=>r.id),['fresh','latest','old','undated']);
  assert.equal(result[0].isNew,true); assert.match(result[0].dateLabel,/Dodano/);
  assert.equal(result[3].dateLabel,'Data niepodana');
  assert.equal(result[0].title,'Matematyka: 5');
});
