import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { zoteroSyncTestables } = await import('./zotero-sync.js');

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Base title',
    creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace' }],
    credit: 'Ada Lovelace',
    date: '2025',
    year: '2025',
    venue: 'Base venue',
    volume: '',
    issue: '',
    pages: '',
    publisher: '',
    place: '',
    doi: '',
    isbn: '',
    issn: '',
    language: '',
    rights: '',
    locator: 'https://example.test/source',
    abstract: '',
    tags: [],
    collectionKeys: [],
    ...overrides,
  };
}

test('ordinary URLs are not exported as DOI values', () => {
  const value = zoteroSyncTestables.canonicalFromSource({
    id: 'source-1',
    title: 'Example',
    locator: 'https://example.test/article',
  });
  assert.equal(value.doi, '');
  assert.equal(value.locator, 'https://example.test/article');
});

test('DOI URLs are normalized while retaining their usable locator', () => {
  const value = zoteroSyncTestables.canonicalFromSource({
    id: 'source-2',
    title: 'Example',
    locator: 'https://doi.org/10.1234/example.7',
  });
  assert.equal(value.doi, '10.1234/example.7');
  assert.equal(value.locator, 'https://doi.org/10.1234/example.7');
});

test('three-way merge combines non-overlapping Odyssey and Zotero edits', () => {
  const base = canonical();
  const local = canonical({ title: 'Odyssey title' });
  const remote = canonical({ venue: 'Zotero venue' });
  const result = zoteroSyncTestables.mergeCanonical(base, local, remote);
  assert.equal(result.merged.title, 'Odyssey title');
  assert.equal(result.merged.venue, 'Zotero venue');
  assert.deepEqual(result.outgoing, ['title']);
  assert.deepEqual(result.conflicts, {});
});

test('three-way merge reports only same-field divergent edits', () => {
  const base = canonical();
  const local = canonical({ title: 'Odyssey title' });
  const remote = canonical({ title: 'Zotero title' });
  const result = zoteroSyncTestables.mergeCanonical(base, local, remote);
  assert.deepEqual(result.conflicts.title, {
    base: 'Base title',
    local: 'Odyssey title',
    remote: 'Zotero title',
  });
});

test('standalone Zotero attachments are importable library sources', () => {
  const item = {
    key: 'PDF12345',
    version: 7,
    data: {
      itemType: 'attachment',
      title: 'Standalone research paper',
      filename: 'paper.pdf',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  };
  assert.equal(zoteroSyncTestables.isImportableLibraryItem(item), true);
  assert.deepEqual(zoteroSyncTestables.childrenForItem(item, {
    notes: [],
    attachments: [],
    annotations: [],
  }).attachments, [{
    key: 'PDF12345',
    version: 7,
    title: 'Standalone research paper',
    filename: 'paper.pdf',
    contentType: 'application/pdf',
    linkMode: 'imported_file',
    url: '',
    md5: '',
    mtime: null,
    standalone: true,
  }]);
});

test('child attachments, notes, and annotations are not independent sources', () => {
  for (const data of [
    { itemType: 'attachment', parentItem: 'PARENT01' },
    { itemType: 'note' },
    { itemType: 'annotation' },
  ]) {
    assert.equal(zoteroSyncTestables.isImportableLibraryItem({
      key: 'CHILD001',
      version: 1,
      data,
    }), false);
  }
});
