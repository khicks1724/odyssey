import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ??= 'test-service-key';

const {
  buildThesisSourceSearchQuery,
  chunkZoteroFulltext,
  zoteroFulltextTestables,
} = await import('./zotero-fulltext.js');

test('full-text chunks retain overlap without dropping document content', () => {
  const text = Array.from({ length: 80 }, (_, index) => (
    `Sentence ${index} describes RF simulation validation evidence and measured behavior.`
  )).join(' ');
  const chunks = chunkZoteroFulltext(text, 500, 80);

  assert.ok(chunks.length > 2);
  assert.match(chunks[0], /Sentence 0/);
  assert.match(chunks.at(-1) ?? '', /Sentence 79/);
  for (let index = 1; index < chunks.length; index += 1) {
    const priorWords = new Set(chunks[index - 1].split(/\s+/).slice(-20));
    assert.ok(chunks[index].split(/\s+/).slice(0, 20).some((word) => priorWords.has(word)));
  }
});

test('source search keeps meaningful terms and removes generic chat wording', () => {
  assert.equal(
    buildThesisSourceSearchQuery('Tell me about the RF simulation validation documents I added using Zotero'),
    '"rf" OR "simulation" OR "validation"',
  );
});

test('credential-like sources are flagged before they can enter AI context', () => {
  const byTitle = zoteroFulltextTestables.detectSensitiveFulltext(
    { id: 'source-1', title: 'GenAI API Key' },
    [],
    'Configuration notes',
  );
  const byContent = zoteroFulltextTestables.detectSensitiveFulltext(
    { id: 'source-2', title: 'Integration notes' },
    [],
    'api_key = sk-exampleCredentialValue123456',
  );

  assert.equal(byTitle.sensitive, true);
  assert.equal(byContent.sensitive, true);
});
