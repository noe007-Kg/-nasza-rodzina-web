import test from 'node:test';
import assert from 'node:assert/strict';
import { musicParameterFile, DEPLOY_ARGUMENTS } from '../scripts/deploy-music-school-job.mjs';
test('release targets only the new production function, never rules or all functions', () => {
  assert.deepEqual([...DEPLOY_ARGUMENTS], ['-y', 'firebase-tools@latest', 'deploy', '--project', 'nasza-rodzina', '--only', 'functions:nasza-rodzina:musicSchoolPublicHourly']);
});
test('parameter editing preserves unrelated values and rejects ambiguous duplicates', () => {
  assert.equal(musicParameterFile(null), 'MUSIC_SCHOOL_ENABLED=true\n');
  assert.equal(musicParameterFile('OTHER=false\nMUSIC_SCHOOL_ENABLED=false\n'), 'OTHER=false\nMUSIC_SCHOOL_ENABLED=true\n');
  assert.equal(musicParameterFile('OTHER=false'), 'OTHER=false\nMUSIC_SCHOOL_ENABLED=true\n');
  assert.throws(() => musicParameterFile('MUSIC_SCHOOL_ENABLED=false\nMUSIC_SCHOOL_ENABLED=true'), /DUPLICATE_MUSIC_PARAMETER/);
});
