import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healthUploadError, validateHealthFile } from '../src/features/health-upload';
import { assertHealthWriteAccess, sameVisitAttachment, saveVisitAttachment, type VisitAttachmentSession } from '../src/health/visit-attachment';
import { emptyHealthDocument } from '../src/health/document-model';

const session = (): VisitAttachmentSession => ({ uid: 'fixture-parent', ownerProfileId: 'fixture-child', recordId: 'fixture-visit', documentId: 'fixture-document',
  file: { name: 'fixture.pdf', type: 'application/pdf', size: 20 } as File, privateToParents: false, uploaded: false });

test('failed transfer retries the same prepared path and stable visit/document IDs', async () => {
  const selected = session(); let preparations = 0, uploads = 0, saves = 0;
  const paths: string[] = [];
  const services = { prepare: async () => { preparations++; return { storagePath: 'healthDocuments/fixture' }; },
    upload: async (_file: File, path: string) => { paths.push(path); if (++uploads === 1) throw new Error('interrupted'); },
    finalize: async () => { saves++; } };
  await assert.rejects(saveVisitAttachment(selected, emptyHealthDocument(), {}, false, services, () => {}), /interrupted/);
  assert.equal(selected.uploaded, false);
  await saveVisitAttachment(selected, emptyHealthDocument(), {}, false, services, () => {});
  assert.equal(preparations, 1); assert.equal(uploads, 2); assert.equal(saves, 1);
  assert.deepEqual(paths, ['healthDocuments/fixture', 'healthDocuments/fixture']);
});

test('an unconfirmed final save retries only the save without repeating an already completed upload', async () => {
  const selected = session(); let uploads = 0, saves = 0;
  const services = { prepare: async () => ({ storagePath: 'healthDocuments/fixture' }), upload: async () => { uploads++; },
    finalize: async () => { if (++saves === 1) throw new Error('save response lost'); } };
  await assert.rejects(saveVisitAttachment(selected, emptyHealthDocument(), {}, false, services, () => {}));
  assert.equal(selected.uploaded, true);
  await saveVisitAttachment(selected, emptyHealthDocument(), {}, false, services, () => {});
  assert.equal(uploads, 1); assert.equal(saves, 2);
});

test('a lost Storage completion response is recovered by an authorized read-only probe without overwriting the stored object', async () => {
  const selected = session(); let uploads = 0, probes = 0, saves = 0;
  const services = { prepare: async () => ({ storagePath: 'healthDocuments/fixture' }),
    upload: async () => { uploads++; throw new Error('completion response lost'); },
    probe: async () => { probes++; return true; }, finalize: async () => { saves++; } };
  await assert.rejects(saveVisitAttachment(selected, emptyHealthDocument(), {}, false, services, () => {}));
  await saveVisitAttachment(selected, emptyHealthDocument(), {}, false, services, () => {});
  assert.equal(uploads, 1); assert.equal(probes, 1); assert.equal(saves, 1);
});

test('changing patient, privacy, UID or selected file cannot reuse the old authorization ticket', () => {
  const selected = session();
  assert.equal(sameVisitAttachment(selected, selected), true);
  for (const change of [{ uid: 'other' }, { ownerProfileId: 'other' }, { recordId: 'other' }, { privateToParents: true }, { file: { ...selected.file } as File }]) {
    assert.equal(sameVisitAttachment(selected, { ...selected, ...change }), false);
  }
});

test('safe error diagnostics preserve a useful Storage code without revealing SDK path, URL or token', () => {
  const failure = { code: 'storage/unauthorized', message: 'https://private/path?token=hidden' };
  const diagnostic = healthUploadError(failure);
  assert.equal(diagnostic.code, 'storage/unauthorized');
  assert.match(diagnostic.message, /uprawnienia/);
  assert.equal(JSON.stringify(diagnostic).includes('token'), false);
  assert.equal(JSON.stringify(diagnostic).includes('https'), false);
  assert.throws(() => validateHealthFile({ size: 0, type: 'application/pdf' }));
});

test('server Preview/read-only status blocks every upload and Firestore write even when the build flag is absent', async () => {
  let uploads = 0, writes = 0;
  const attempt = async (writesEnabled?: boolean) => {
    await assertHealthWriteAccess(async () => ({ writesEnabled }));
    uploads++; writes++;
  };
  await assert.rejects(attempt(false), /Preview/);
  await assert.rejects(attempt(undefined), /Preview/);
  assert.equal(uploads, 0); assert.equal(writes, 0);
  await attempt(true);
  assert.equal(uploads, 1); assert.equal(writes, 1);
});
