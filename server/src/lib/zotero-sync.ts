import { randomBytes } from 'node:crypto';
import { supabase } from './supabase.js';
import {
  decryptZoteroSecret,
  type EncryptedSecret,
  ZoteroApiError,
  zoteroJson,
} from './zotero-client.js';

export type ZoteroCreator = {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
};

export type ZoteroApiItem = {
  key: string;
  version: number;
  bib?: string;
  citation?: string;
  data: Record<string, unknown> & {
    key?: string;
    version?: number;
    itemType?: string;
    title?: string;
    parentItem?: string;
  };
};

export type ZoteroCollection = {
  key: string;
  version: number;
  data: {
    key?: string;
    version?: number;
    name?: string;
    parentCollection?: string | false;
    relations?: Record<string, unknown>;
  };
  meta?: { numCollections?: number; numItems?: number };
};

export type ZoteroConnection = {
  userId: string;
  zoteroUserId: string;
  username: string | null;
  connectionMethod: 'oauth' | 'api_key';
  apiKey: string;
  permissions: Record<string, unknown>;
  selectedCollectionKeys: string[];
  syncAll: boolean;
  lastLibraryVersion: number;
  lastFulltextVersion: number;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  backoffUntil: string | null;
};

export type ZoteroSyncConflict = {
  id: string;
  sourceId: string;
  itemKey: string;
  fields: Record<string, { base: unknown; local: unknown; remote: unknown }>;
  remoteVersion: number;
  createdAt: string;
};

type SourceRecord = Record<string, unknown> & {
  id: string;
  citeKey?: string;
  title?: string;
  credit?: string;
  venue?: string;
  year?: string;
  locator?: string;
  citation?: string;
  abstract?: string;
  notes?: string;
  tags?: string[];
  sourceKind?: string;
  type?: string;
};

type ZoteroLinkRow = {
  user_id: string;
  source_id: string;
  library_type: 'user' | 'group';
  library_id: string;
  item_key: string;
  item_version: number;
  item_type: string;
  collection_keys: string[] | null;
  baseline_data: unknown;
  sync_status: string;
  last_error: string | null;
  last_synced_at: string | null;
};

export type CanonicalSource = {
  title: string;
  creators: ZoteroCreator[];
  credit: string;
  date: string;
  year: string;
  venue: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  place: string;
  doi: string;
  isbn: string;
  issn: string;
  language: string;
  rights: string;
  locator: string;
  abstract: string;
  tags: string[];
  collectionKeys: string[];
};

type ZoteroChildData = {
  notes: Array<Record<string, unknown>>;
  attachments: Array<Record<string, unknown>>;
  annotations: Array<Record<string, unknown>>;
};

const CANONICAL_FIELDS: Array<keyof CanonicalSource> = [
  'title', 'creators', 'credit', 'date', 'year', 'venue', 'volume', 'issue', 'pages',
  'publisher', 'place', 'doi', 'isbn', 'issn', 'language', 'rights', 'locator',
  'abstract', 'tags', 'collectionKeys',
];

const ZOTERO_STYLE_BY_FORMAT: Record<string, string> = {
  apa: 'apa',
  chicago: 'chicago-author-date',
  ieee: 'ieee',
  informs: 'informs-journal-on-computing',
  asme: 'american-society-of-mechanical-engineers',
  aiaa: 'american-institute-of-aeronautics-and-astronautics',
  ams: 'american-meteorological-society',
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(stringValue).filter(Boolean))];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function equal(left: unknown, right: unknown) {
  return stable(left) === stable(right);
}

function stripHtml(value: unknown) {
  return stringValue(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeCreators(value: unknown): ZoteroCreator[] {
  if (!Array.isArray(value)) return [];
  const creators: ZoteroCreator[] = [];
  for (const creator of value) {
      const data = asObject(creator);
      const creatorType = stringValue(data.creatorType) || 'author';
      const name = stringValue(data.name);
      const firstName = stringValue(data.firstName);
      const lastName = stringValue(data.lastName);
      if (name) creators.push({ creatorType, name });
      else if (firstName || lastName) creators.push({ creatorType, firstName, lastName });
  }
  return creators;
}

function creatorsToCredit(creators: ZoteroCreator[]) {
  return creators
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('; ');
}

function creatorsFromCredit(value: string): ZoteroCreator[] {
  return value
    .split(/\s*;\s*|\s+and\s+|\s*&\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((name) => {
      if (/\b(agency|department|office|committee|commission|command|center|university|institute|laboratory|government|corporation|company|press)\b/i.test(name)) {
        return { creatorType: 'author', name };
      }
      const words = name.replace(/^([^,]+),\s*(.+)$/, '$2 $1').split(/\s+/).filter(Boolean);
      return {
        creatorType: 'author',
        firstName: words.slice(0, -1).join(' '),
        lastName: words.at(-1) ?? '',
      };
    });
}

function itemVenue(data: Record<string, unknown>) {
  const fields = [
    'publicationTitle', 'proceedingsTitle', 'bookTitle', 'websiteTitle', 'repository',
    'institution', 'university', 'publisher', 'conferenceName', 'libraryCatalog',
  ];
  return fields.map((field) => stringValue(data[field])).find(Boolean) ?? '';
}

function sourceClassification(itemType: string) {
  switch (itemType) {
    case 'journalArticle': return { sourceKind: 'journal_article', type: 'paper' };
    case 'conferencePaper': return { sourceKind: 'conference_paper', type: 'paper' };
    case 'book': return { sourceKind: 'book', type: 'book' };
    case 'bookSection': return { sourceKind: 'book_chapter', type: 'book' };
    case 'report': return { sourceKind: 'government_report', type: 'report' };
    case 'thesis': return { sourceKind: 'thesis_dissertation', type: 'paper' };
    case 'dataset': return { sourceKind: 'dataset', type: 'dataset' };
    case 'manuscript': return { sourceKind: 'interview_notes', type: 'notes' };
    case 'document': return { sourceKind: 'archive_record', type: 'document' };
    case 'webpage': return { sourceKind: 'web_article', type: 'link' };
    case 'computerProgram': return { sourceKind: 'documentation', type: 'link' };
    case 'attachment': return { sourceKind: 'archive_record', type: 'document' };
    default: return { sourceKind: 'archive_record', type: 'document' };
  }
}

function isStandaloneAttachment(item: ZoteroApiItem) {
  return stringValue(item.data.itemType) === 'attachment' && !stringValue(item.data.parentItem);
}

function isImportableLibraryItem(item: ZoteroApiItem) {
  const itemType = stringValue(item.data.itemType);
  if (itemType === 'attachment') return isStandaloneAttachment(item);
  return itemType !== 'note' && itemType !== 'annotation';
}

function attachmentFromItem(item: ZoteroApiItem) {
  return {
    key: item.key,
    version: item.version,
    title: stringValue(item.data.title),
    filename: stringValue(item.data.filename),
    contentType: stringValue(item.data.contentType),
    linkMode: stringValue(item.data.linkMode),
    url: stringValue(item.data.url),
    md5: stringValue(item.data.md5),
    mtime: item.data.mtime ?? null,
    standalone: true,
  };
}

function childrenForItem(item: ZoteroApiItem, children: ZoteroChildData): ZoteroChildData {
  if (!isStandaloneAttachment(item)) return children;
  return {
    ...children,
    attachments: [
      attachmentFromItem(item),
      ...children.attachments.filter((attachment) => stringValue(attachment.key) !== item.key),
    ],
  };
}

function zoteroItemTypeForSource(source: SourceRecord) {
  switch (stringValue(source.sourceKind)) {
    case 'journal_article': return 'journalArticle';
    case 'conference_paper': return 'conferencePaper';
    case 'book': return 'book';
    case 'book_chapter': return 'bookSection';
    case 'government_report': return 'report';
    case 'thesis_dissertation': return 'thesis';
    case 'dataset': return 'dataset';
    case 'interview_notes': return 'manuscript';
    case 'web_article': return 'webpage';
    case 'documentation': return 'computerProgram';
    default: return 'document';
  }
}

function normalizeDoi(value: string) {
  return value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
}

function doiFromLocator(value: string) {
  const locator = value.trim();
  return /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*|10\.\d{4,9}\/)/i.test(locator)
    ? normalizeDoi(locator)
    : '';
}

function canonicalFromRemote(data: Record<string, unknown>): CanonicalSource {
  const creators = normalizeCreators(data.creators);
  const date = stringValue(data.date);
  const doi = normalizeDoi(stringValue(data.DOI));
  const url = stringValue(data.url);
  const tags = Array.isArray(data.tags)
    ? data.tags.map((tag) => stringValue(asObject(tag).tag)).filter(Boolean)
    : [];
  return {
    title: stringValue(data.title),
    creators,
    credit: creatorsToCredit(creators),
    date,
    year: date.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? '',
    venue: itemVenue(data),
    volume: stringValue(data.volume),
    issue: stringValue(data.issue),
    pages: stringValue(data.pages),
    publisher: stringValue(data.publisher),
    place: stringValue(data.place),
    doi,
    isbn: stringValue(data.ISBN),
    issn: stringValue(data.ISSN),
    language: stringValue(data.language),
    rights: stringValue(data.rights),
    locator: doi ? `https://doi.org/${doi}` : url,
    abstract: stringValue(data.abstractNote),
    tags: [...new Set(tags)],
    collectionKeys: stringArray(data.collections),
  };
}

function canonicalFromSource(source: SourceRecord): CanonicalSource {
  const structuredCreators = normalizeCreators(source.creators);
  const credit = stringValue(source.credit) || creatorsToCredit(structuredCreators);
  const creators = credit && credit !== creatorsToCredit(structuredCreators)
    ? creatorsFromCredit(credit)
    : structuredCreators;
  const date = stringValue(source.date) || stringValue(source.year);
  const doi = normalizeDoi(stringValue(source.doi)) || doiFromLocator(stringValue(source.locator));
  return {
    title: stringValue(source.title),
    creators,
    credit: credit || creatorsToCredit(creators),
    date,
    year: stringValue(source.year) || date.match(/\b(?:19|20)\d{2}\b/)?.[0] || '',
    venue: stringValue(source.venue),
    volume: stringValue(source.volume),
    issue: stringValue(source.issue),
    pages: stringValue(source.pages),
    publisher: stringValue(source.publisher),
    place: stringValue(source.place),
    doi,
    isbn: stringValue(source.isbn),
    issn: stringValue(source.issn),
    language: stringValue(source.language),
    rights: stringValue(source.rights),
    locator: stringValue(source.locator),
    abstract: stringValue(source.abstract),
    tags: stringArray(source.tags),
    collectionKeys: stringArray(source.zoteroCollectionKeys),
  };
}

function applyCanonicalToSource(source: SourceRecord, canonical: CanonicalSource): SourceRecord {
  return {
    ...source,
    title: canonical.title,
    creators: canonical.creators,
    credit: canonical.credit || creatorsToCredit(canonical.creators),
    date: canonical.date,
    year: canonical.year,
    venue: canonical.venue,
    volume: canonical.volume,
    issue: canonical.issue,
    pages: canonical.pages,
    publisher: canonical.publisher,
    place: canonical.place,
    doi: canonical.doi,
    isbn: canonical.isbn,
    issn: canonical.issn,
    language: canonical.language,
    rights: canonical.rights,
    locator: canonical.locator,
    abstract: canonical.abstract,
    tags: canonical.tags,
    zoteroCollectionKeys: canonical.collectionKeys,
  };
}

function venueField(itemType: string) {
  switch (itemType) {
    case 'journalArticle': return 'publicationTitle';
    case 'conferencePaper': return 'proceedingsTitle';
    case 'bookSection': return 'bookTitle';
    case 'webpage': return 'websiteTitle';
    case 'dataset': return 'repository';
    case 'report': return 'institution';
    case 'thesis': return 'university';
    default: return 'publisher';
  }
}

function patchFromCanonical(
  canonical: CanonicalSource,
  remoteData: Record<string, unknown>,
  changedFields: Array<keyof CanonicalSource>,
) {
  const patch: Record<string, unknown> = {};
  const changed = new Set(changedFields);
  if (changed.has('title')) patch.title = canonical.title;
  if (stringValue(remoteData.itemType) === 'attachment') {
    if (changed.has('locator')) patch.url = canonical.locator;
    if (changed.has('collectionKeys')) patch.collections = canonical.collectionKeys;
    if (changed.has('tags')) {
      const automaticTags = Array.isArray(remoteData.tags)
        ? remoteData.tags
          .map((tag) => asObject(tag))
          .filter((tag) => tag.type === 1 && stringValue(tag.tag))
        : [];
      const automaticNames = new Set(automaticTags.map((tag) => stringValue(tag.tag)));
      patch.tags = [
        ...automaticTags,
        ...canonical.tags.filter((tag) => !automaticNames.has(tag)).map((tag) => ({ tag, type: 0 })),
      ];
    }
    return patch;
  }
  if (changed.has('creators') || changed.has('credit')) patch.creators = canonical.creators;
  if (changed.has('date') || changed.has('year')) patch.date = canonical.date || canonical.year;
  if (changed.has('venue')) patch[venueField(stringValue(remoteData.itemType))] = canonical.venue;
  if (changed.has('volume')) patch.volume = canonical.volume;
  if (changed.has('issue')) patch.issue = canonical.issue;
  if (changed.has('pages')) patch.pages = canonical.pages;
  if (changed.has('publisher')) patch.publisher = canonical.publisher;
  if (changed.has('place')) patch.place = canonical.place;
  if (changed.has('doi')) patch.DOI = canonical.doi;
  if (changed.has('isbn')) patch.ISBN = canonical.isbn;
  if (changed.has('issn')) patch.ISSN = canonical.issn;
  if (changed.has('language')) patch.language = canonical.language;
  if (changed.has('rights')) patch.rights = canonical.rights;
  if (changed.has('locator') && !canonical.doi) patch.url = canonical.locator;
  if (changed.has('abstract')) patch.abstractNote = canonical.abstract;
  if (changed.has('collectionKeys')) patch.collections = canonical.collectionKeys;
  if (changed.has('tags')) {
    const automaticTags = Array.isArray(remoteData.tags)
      ? remoteData.tags
        .map((tag) => asObject(tag))
        .filter((tag) => tag.type === 1 && stringValue(tag.tag))
      : [];
    const automaticNames = new Set(automaticTags.map((tag) => stringValue(tag.tag)));
    patch.tags = [
      ...automaticTags,
      ...canonical.tags.filter((tag) => !automaticNames.has(tag)).map((tag) => ({ tag, type: 0 })),
    ];
  }
  return patch;
}

function mergeCanonical(base: CanonicalSource, local: CanonicalSource, remote: CanonicalSource) {
  const merged = { ...local };
  const outgoing: Array<keyof CanonicalSource> = [];
  const conflicts: Record<string, { base: unknown; local: unknown; remote: unknown }> = {};
  for (const field of CANONICAL_FIELDS) {
    const localChanged = !equal(local[field], base[field]);
    const remoteChanged = !equal(remote[field], base[field]);
    if (localChanged && remoteChanged && !equal(local[field], remote[field])) {
      conflicts[field] = { base: base[field], local: local[field], remote: remote[field] };
      continue;
    }
    if (remoteChanged) merged[field] = remote[field] as never;
    if (localChanged && !remoteChanged) outgoing.push(field);
  }
  return { merged, outgoing, conflicts };
}

export const zoteroSyncTestables = {
  canonicalFromSource,
  childrenForItem,
  isImportableLibraryItem,
  mergeCanonical,
};

function slug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function defaultCiteKey(canonical: CanonicalSource, usedKeys: Set<string>) {
  const creator = canonical.creators[0];
  const author = slug(creator?.lastName || creator?.name || canonical.credit.split(/\s+/).at(-1) || 'source');
  const title = slug(canonical.title).split('_').find((word) => word.length >= 3) || 'source';
  const base = [author || 'source', canonical.year || 'nd', title].join('_');
  let candidate = base;
  let suffix = 2;
  while (usedKeys.has(candidate)) candidate = `${base}_${suffix++}`;
  usedKeys.add(candidate);
  return candidate;
}

function zoteroLinkPayload(link: Partial<ZoteroLinkRow> & { item_key: string; item_version: number; item_type: string; library_id: string }) {
  return {
    libraryType: link.library_type ?? 'user',
    libraryId: link.library_id,
    itemKey: link.item_key,
    itemVersion: link.item_version,
    itemType: link.item_type,
    collectionKeys: link.collection_keys ?? [],
    syncStatus: link.sync_status ?? 'synced',
    lastError: link.last_error ?? null,
    lastSyncedAt: link.last_synced_at ?? new Date().toISOString(),
  };
}

function parseBaseline(value: unknown, remote: CanonicalSource, raw: Record<string, unknown>) {
  const baseline = asObject(value);
  const canonical = asObject(baseline.canonical);
  return {
    canonical: Object.keys(canonical).length > 0 ? canonical as CanonicalSource : remote,
    raw: Object.keys(asObject(baseline.raw)).length > 0 ? asObject(baseline.raw) : raw,
  };
}

async function citationStyleForUser(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('thesis_page_snapshot')
    .eq('id', userId)
    .maybeSingle();
  const snapshot = asObject(data?.thesis_page_snapshot);
  const details = asObject(snapshot.thesisDetails);
  return ZOTERO_STYLE_BY_FORMAT[stringValue(details.citationFormat)] ?? 'apa';
}

export async function getZoteroConnection(userId: string): Promise<ZoteroConnection | null> {
  const { data, error } = await supabase
    .from('user_zotero_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    userId,
    zoteroUserId: String(data.zotero_user_id),
    username: data.zotero_username ?? null,
    connectionMethod: data.connection_method === 'api_key' ? 'api_key' : 'oauth',
    apiKey: decryptZoteroSecret({
      encrypted: data.encrypted_api_key,
      iv: data.iv,
      authTag: data.auth_tag,
    } satisfies EncryptedSecret),
    permissions: asObject(data.permissions),
    selectedCollectionKeys: stringArray(data.selected_collection_keys),
    syncAll: Boolean(data.sync_all),
    lastLibraryVersion: Number(data.last_library_version ?? 0),
    lastFulltextVersion: Number(data.last_fulltext_version ?? 0),
    lastSyncAt: data.last_sync_at ?? null,
    lastSyncStatus: data.last_sync_status ?? 'idle',
    lastSyncError: data.last_sync_error ?? null,
    backoffUntil: data.backoff_until ?? null,
  };
}

export async function listThesisSources(userId: string): Promise<SourceRecord[]> {
  const [{ data: sourceRows, error: sourceError }, { data: linkRows, error: linkError }] = await Promise.all([
    supabase.from('thesis_sources').select('id,data,revision,updated_at').eq('user_id', userId).order('created_at'),
    supabase.from('thesis_zotero_item_links').select('*').eq('user_id', userId),
  ]);
  if (sourceError) throw sourceError;
  if (linkError) throw linkError;
  const links = new Map((linkRows ?? []).map((row) => [row.source_id, row as ZoteroLinkRow]));
  return (sourceRows ?? []).map((row) => {
    const source = { ...asObject(row.data), id: row.id } as SourceRecord;
    const link = links.get(row.id);
    if (link) return { ...source, zoteroLink: zoteroLinkPayload(link), revision: Number(row.revision ?? 1) };
    delete source.zoteroLink;
    return { ...source, revision: Number(row.revision ?? 1) };
  });
}

export async function saveThesisSourceRecord(userId: string, source: SourceRecord) {
  const clean = { ...source };
  delete clean.revision;
  const { error } = await supabase.from('thesis_sources').upsert({
    user_id: userId,
    id: source.id,
    data: clean,
  }, { onConflict: 'user_id,id' });
  if (error) throw error;
}

const saveSource = saveThesisSourceRecord;

export async function persistThesisSourceSnapshot(userId: string, sources: SourceRecord[]) {
  const { data: existingRows, error: readError } = await supabase
    .from('thesis_sources')
    .select('id,data')
    .eq('user_id', userId);
  if (readError) throw readError;
  const existing = new Map((existingRows ?? []).map((row) => [row.id, asObject(row.data)]));
  if (sources.length > 0) {
    const changedRows = sources.flatMap((source) => {
      const clean = { ...source };
      delete clean.revision;
      return equal(clean, existing.get(source.id))
        ? []
        : [{ user_id: userId, id: source.id, data: clean }];
    });
    if (changedRows.length > 0) {
      const { error } = await supabase.from('thesis_sources').upsert(changedRows, { onConflict: 'user_id,id' });
      if (error) throw error;
    }
  }
  const nextIds = new Set(sources.map((source) => source.id));
  const removedIds = [...existing.keys()].filter((id) => !nextIds.has(id));
  if (removedIds.length > 0) {
    const { error } = await supabase.from('thesis_sources').delete().eq('user_id', userId).in('id', removedIds);
    if (error) throw error;
  }

  const { data: links } = await supabase
    .from('thesis_zotero_item_links')
    .select('source_id')
    .eq('user_id', userId);
  const linked = new Set((links ?? []).map((link) => link.source_id));
  const changedLinked = sources.filter((source) => (
    linked.has(source.id) && !equal(canonicalFromSource(source), canonicalFromSource({
      ...existing.get(source.id),
      id: source.id,
    } as SourceRecord))
  ));
  if (changedLinked.length > 0) {
    const changedSourceIds = changedLinked.map((source) => source.id);
    await supabase.from('thesis_zotero_item_links').update({
      sync_status: 'local_pending',
      last_error: null,
    }).eq('user_id', userId).in('source_id', changedSourceIds);
    await supabase.from('zotero_sync_outbox').insert(changedLinked.map((source) => ({
      user_id: userId,
      source_id: source.id,
      operation: 'sync_source',
      payload: {},
    })));
  }
}

async function fetchZoteroChildren(connection: ZoteroConnection, itemKey: string): Promise<ZoteroChildData> {
  const result = await zoteroJson<ZoteroApiItem[]>(
    connection.apiKey,
    `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(itemKey)}/children?limit=100`,
  );
  const notes: Array<Record<string, unknown>> = [];
  const attachments: Array<Record<string, unknown>> = [];
  const annotations: Array<Record<string, unknown>> = [];
  for (const item of result.data) {
    const data = item.data;
    if (data.itemType === 'note') {
      notes.push({
        key: item.key,
        version: item.version,
        html: stringValue(data.note),
        text: stripHtml(data.note),
        tags: Array.isArray(data.tags) ? data.tags : [],
      });
    } else if (data.itemType === 'attachment') {
      attachments.push({
        key: item.key,
        version: item.version,
        title: stringValue(data.title),
        filename: stringValue(data.filename),
        contentType: stringValue(data.contentType),
        linkMode: stringValue(data.linkMode),
        url: stringValue(data.url),
        md5: stringValue(data.md5),
        mtime: data.mtime ?? null,
      });
    } else if (data.itemType === 'annotation') {
      annotations.push({
        key: item.key,
        version: item.version,
        text: stringValue(data.annotationText),
        comment: stringValue(data.annotationComment),
        pageLabel: stringValue(data.annotationPageLabel),
        color: stringValue(data.annotationColor),
        sortIndex: stringValue(data.annotationSortIndex),
        position: data.annotationPosition ?? null,
        parentItem: stringValue(data.parentItem),
      });
    }
  }
  const attachmentKeys = attachments.map((attachment) => stringValue(attachment.key)).filter(Boolean);
  const annotationResults: ZoteroApiItem[][] = [];
  for (let index = 0; index < attachmentKeys.length; index += 5) {
    const batch = attachmentKeys.slice(index, index + 5);
    annotationResults.push(...await Promise.all(batch.map(async (attachmentKey) => {
      const result = await zoteroJson<ZoteroApiItem[]>(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(attachmentKey)}/children?limit=100`,
      );
      return result.data;
    })));
  }
  for (const item of annotationResults.flat()) {
    const data = item.data;
    if (data.itemType !== 'annotation') continue;
    annotations.push({
      key: item.key,
      version: item.version,
      text: stringValue(data.annotationText),
      comment: stringValue(data.annotationComment),
      pageLabel: stringValue(data.annotationPageLabel),
      color: stringValue(data.annotationColor),
      sortIndex: stringValue(data.annotationSortIndex),
      position: data.annotationPosition ?? null,
      parentItem: stringValue(data.parentItem),
    });
  }
  return { notes, attachments, annotations };
}

export async function getZoteroItemChildren(userId: string, itemKey: string) {
  const connection = await getZoteroConnection(userId);
  if (!connection) throw new Error('Zotero is not connected');
  return fetchZoteroChildren(connection, itemKey);
}

async function updateConnectionStatus(
  userId: string,
  status: 'syncing' | 'ok' | 'error' | 'backoff',
  values: Record<string, unknown> = {},
) {
  await supabase.from('user_zotero_connections').update({
    last_sync_status: status,
    last_sync_error: status === 'error' ? stringValue(values.last_sync_error) : null,
    ...values,
  }).eq('user_id', userId);
}

async function fetchItems(connection: ZoteroConnection, itemKeys: string[], style: string) {
  const items: ZoteroApiItem[] = [];
  let libraryVersion = connection.lastLibraryVersion;
  for (let index = 0; index < itemKeys.length; index += 50) {
    const keys = itemKeys.slice(index, index + 50);
    const params = new URLSearchParams({
      itemKey: keys.join(','),
      include: 'data,bib,citation',
      style,
      limit: '100',
    });
    const result = await zoteroJson<ZoteroApiItem[]>(
      connection.apiKey,
      `/users/${encodeURIComponent(connection.zoteroUserId)}/items?${params.toString()}`,
    );
    items.push(...result.data);
    libraryVersion = Math.max(libraryVersion, result.libraryVersion ?? 0);
  }
  return { items, libraryVersion };
}

async function sourceAndLinks(userId: string) {
  const [{ data: sourceRows, error: sourceError }, { data: linkRows, error: linkError }] = await Promise.all([
    supabase.from('thesis_sources').select('id,data').eq('user_id', userId),
    supabase.from('thesis_zotero_item_links').select('*').eq('user_id', userId),
  ]);
  if (sourceError) throw sourceError;
  if (linkError) throw linkError;
  return {
    sources: new Map((sourceRows ?? []).map((row) => [row.id, { ...asObject(row.data), id: row.id } as SourceRecord])),
    linksByItem: new Map((linkRows ?? []).map((row) => [row.item_key, row as ZoteroLinkRow])),
    links: (linkRows ?? []) as ZoteroLinkRow[],
  };
}

async function createImportedSource(
  userId: string,
  connection: ZoteroConnection,
  item: ZoteroApiItem,
  children: ZoteroChildData,
  usedCiteKeys: Set<string>,
  existingSourceId?: string,
) {
  const normalizedChildren = childrenForItem(item, children);
  const canonical = canonicalFromRemote(item.data);
  const classification = sourceClassification(stringValue(item.data.itemType));
  const sourceId = existingSourceId ?? `zotero-${item.key.toLowerCase()}`;
  const current = existingSourceId
    ? (await listThesisSources(userId)).find((source) => source.id === existingSourceId)
    : null;
  const source = applyCanonicalToSource({
    ...(current ?? {}),
    id: sourceId,
    citeKey: current?.citeKey || defaultCiteKey(canonical, usedCiteKeys),
    type: classification.type,
    acquisitionMethod: current?.acquisitionMethod || 'manual',
    sourceKind: classification.sourceKind,
    status: current?.status || 'tagged',
    role: current?.role || 'secondary',
    verification: current?.verification || 'provisional',
    chapterTarget: current?.chapterTarget || 'literature_review',
    citation: stripHtml(item.bib),
    notes: current?.notes || '',
    addedOn: current?.addedOn || new Date().toISOString().slice(0, 10),
    attachmentName: current?.attachmentName || '',
    attachmentStoragePath: current?.attachmentStoragePath || '',
    attachmentMimeType: current?.attachmentMimeType || '',
    attachmentUploadedAt: current?.attachmentUploadedAt || '',
    zoteroNotes: normalizedChildren.notes,
    zoteroAttachments: normalizedChildren.attachments,
    zoteroAnnotations: normalizedChildren.annotations,
  } as SourceRecord, canonical);
  const now = new Date().toISOString();
  const link: ZoteroLinkRow = {
    user_id: userId,
    source_id: sourceId,
    library_type: 'user',
    library_id: connection.zoteroUserId,
    item_key: item.key,
    item_version: item.version,
    item_type: stringValue(item.data.itemType) || 'document',
    collection_keys: canonical.collectionKeys,
    baseline_data: { canonical, raw: item.data },
    sync_status: 'synced',
    last_error: null,
    last_synced_at: now,
  };
  source.zoteroLink = zoteroLinkPayload(link);
  await saveSource(userId, source);
  const { error } = await supabase.from('thesis_zotero_item_links').upsert({
    ...link,
    updated_at: now,
  }, { onConflict: 'user_id,source_id' });
  if (error) throw error;
  return source;
}

async function saveConflict(
  userId: string,
  link: ZoteroLinkRow,
  conflicts: Record<string, { base: unknown; local: unknown; remote: unknown }>,
  item: ZoteroApiItem,
  remoteCanonical: CanonicalSource,
  children: ZoteroChildData,
) {
  await supabase
    .from('zotero_sync_conflicts')
    .delete()
    .eq('user_id', userId)
    .eq('source_id', link.source_id)
    .is('resolved_at', null);
  const { error } = await supabase.from('zotero_sync_conflicts').insert({
    user_id: userId,
    source_id: link.source_id,
    item_key: item.key,
    remote_version: item.version,
    fields: {
      conflicts,
      remoteCanonical,
      remoteRaw: item.data,
      remoteChildren: children,
      remoteCitation: stripHtml(item.bib),
    },
  });
  if (error) throw error;
  await supabase.from('thesis_zotero_item_links').update({
    sync_status: 'conflict',
    item_version: item.version,
    last_error: 'Resolve conflicting Zotero and Odyssey changes.',
  }).eq('user_id', userId).eq('source_id', link.source_id);
}

async function syncExistingItem(
  userId: string,
  connection: ZoteroConnection,
  link: ZoteroLinkRow,
  source: SourceRecord,
  item: ZoteroApiItem,
  children: ZoteroChildData,
) {
  const local = canonicalFromSource(source);
  const rawRemote = canonicalFromRemote(item.data);
  // Standalone attachments have a much smaller Zotero schema than regular
  // bibliography items. Keep Odyssey-only citation metadata local while still
  // synchronizing the fields Zotero attachments actually support.
  const remote = isStandaloneAttachment(item)
    ? {
      ...local,
      title: rawRemote.title,
      locator: rawRemote.locator,
      tags: rawRemote.tags,
      collectionKeys: rawRemote.collectionKeys,
    }
    : rawRemote;
  const normalizedChildren = childrenForItem(item, children);
  const baseline = parseBaseline(link.baseline_data, remote, item.data);
  const merge = mergeCanonical(baseline.canonical, local, remote);
  let mergedSource = applyCanonicalToSource(source, merge.merged);
  mergedSource = {
    ...mergedSource,
    citation: stripHtml(item.bib) || stringValue(source.citation),
    zoteroNotes: normalizedChildren.notes,
    zoteroAttachments: normalizedChildren.attachments,
    zoteroAnnotations: normalizedChildren.annotations,
  };
  if (Object.keys(merge.conflicts).length > 0) {
    mergedSource.zoteroLink = zoteroLinkPayload({
      ...link,
      item_version: item.version,
      collection_keys: remote.collectionKeys,
      sync_status: 'conflict',
      last_error: 'Resolve conflicting Zotero and Odyssey changes.',
    });
    await saveSource(userId, mergedSource);
    await saveConflict(userId, link, merge.conflicts, item, remote, normalizedChildren);
    return { conflict: true, libraryVersion: item.version };
  }

  let itemVersion = item.version;
  let raw = item.data;
  if (merge.outgoing.length > 0) {
    const patch = patchFromCanonical(merge.merged, item.data, merge.outgoing);
    const result = await zoteroJson<null>(
      connection.apiKey,
      `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(item.key)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Unmodified-Since-Version': String(item.version),
        },
        body: JSON.stringify(patch),
      },
    );
    itemVersion = result.libraryVersion ?? item.version;
    raw = { ...item.data, ...patch, version: itemVersion };
  }

  const now = new Date().toISOString();
  mergedSource.zoteroLink = zoteroLinkPayload({
    ...link,
    item_version: itemVersion,
    collection_keys: merge.merged.collectionKeys,
    sync_status: 'synced',
    last_error: null,
    last_synced_at: now,
  });
  await saveSource(userId, mergedSource);
  const { error } = await supabase.from('thesis_zotero_item_links').update({
    item_version: itemVersion,
    item_type: stringValue(item.data.itemType) || link.item_type,
    collection_keys: merge.merged.collectionKeys,
    baseline_data: { canonical: merge.merged, raw },
    sync_status: 'synced',
    last_error: null,
    last_synced_at: now,
  }).eq('user_id', userId).eq('source_id', link.source_id);
  if (error) throw error;
  return { conflict: false, libraryVersion: itemVersion };
}

async function syncItemWithRetry(
  userId: string,
  connection: ZoteroConnection,
  item: ZoteroApiItem,
  sources: Map<string, SourceRecord>,
  linksByItem: Map<string, ZoteroLinkRow>,
  usedCiteKeys: Set<string>,
  style: string,
) {
  let currentItem = item;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const children = await fetchZoteroChildren(connection, currentItem.key);
    const link = linksByItem.get(currentItem.key);
    if (!link) {
      const source = await createImportedSource(userId, connection, currentItem, children, usedCiteKeys);
      sources.set(source.id, source);
      return { conflict: false, libraryVersion: currentItem.version };
    }
    const source = sources.get(link.source_id);
    if (!source) return { conflict: false, libraryVersion: currentItem.version };
    try {
      return await syncExistingItem(userId, connection, link, source, currentItem, children);
    } catch (error) {
      if (!(error instanceof ZoteroApiError) || error.status !== 412 || attempt > 0) throw error;
      const refreshed = await fetchItems(connection, [currentItem.key], style);
      const nextItem = refreshed.items[0];
      if (!nextItem) throw error;
      currentItem = nextItem;
    }
  }
  return { conflict: false, libraryVersion: currentItem.version };
}

async function versionMapForPath(connection: ZoteroConnection, path: string) {
  const result = await zoteroJson<Record<string, number>>(connection.apiKey, path);
  return {
    versions: result.data,
    libraryVersion: result.libraryVersion ?? connection.lastLibraryVersion,
    backoffSeconds: result.backoffSeconds,
  };
}

function itemVersionsPath(connection: ZoteroConnection, collectionKey?: string) {
  const prefix = `/users/${encodeURIComponent(connection.zoteroUserId)}`;
  const base = collectionKey
    ? `${prefix}/collections/${encodeURIComponent(collectionKey)}/items/top`
    : `${prefix}/items/top`;
  const params = new URLSearchParams({
    format: 'versions',
    since: String(connection.lastLibraryVersion),
    includeTrashed: '1',
  });
  return `${base}?${params.toString()}`;
}

type ZoteroSyncResult = {
  ok: true;
  conflictCount: number;
  lastLibraryVersion: number;
  lastSyncAt: string;
  sources: SourceRecord[];
};

type ZoteroSyncOptions = {
  forceItemKeys?: string[];
  selectedCollectionKeys?: string[];
  syncAll?: boolean;
  refreshCitations?: boolean;
};

const activeSyncs = new Map<string, Promise<ZoteroSyncResult>>();
const queuedSyncs = new Map<string, Promise<ZoteroSyncResult>>();
const queuedSyncOptions = new Map<string, ZoteroSyncOptions>();

async function performZoteroSyncInternal(userId: string, options: ZoteroSyncOptions = {}) {
  let connection = await getZoteroConnection(userId);
  if (!connection) throw new Error('Zotero is not connected');
  if (connection.backoffUntil && new Date(connection.backoffUntil).getTime() > Date.now()) {
    throw new ZoteroApiError(429, `Zotero requested a backoff until ${connection.backoffUntil}`);
  }
  if (options.selectedCollectionKeys || typeof options.syncAll === 'boolean') {
    const selected = options.selectedCollectionKeys ?? connection.selectedCollectionKeys;
    const syncAll = options.syncAll ?? connection.syncAll;
    const { error } = await supabase.from('user_zotero_connections').update({
      selected_collection_keys: selected,
      sync_all: syncAll,
      last_library_version: 0,
    }).eq('user_id', userId);
    if (error) throw error;
    connection = { ...connection, selectedCollectionKeys: selected, syncAll, lastLibraryVersion: 0 };
  }
  await updateConnectionStatus(userId, 'syncing');

  try {
    const { sources, linksByItem, links } = await sourceAndLinks(userId);
    const usedCiteKeys = new Set([...sources.values()].map((source) => stringValue(source.citeKey)).filter(Boolean));
    const versions = new Map<string, number>();
    let latestVersion = connection.lastLibraryVersion;
    let backoffSeconds: number | null = null;
    const scopePaths = connection.syncAll
      ? [itemVersionsPath(connection)]
      : connection.selectedCollectionKeys.map((key) => itemVersionsPath(connection, key));
    for (const path of scopePaths) {
      const result = await versionMapForPath(connection, path);
      for (const [key, version] of Object.entries(result.versions)) versions.set(key, version);
      latestVersion = Math.max(latestVersion, result.libraryVersion);
      backoffSeconds = Math.max(backoffSeconds ?? 0, result.backoffSeconds ?? 0) || null;
    }

    for (let index = 0; index < links.length; index += 50) {
      const batch = links.slice(index, index + 50);
      if (batch.length === 0) continue;
      const params = new URLSearchParams({
        format: 'versions',
        itemKey: batch.map((link) => link.item_key).join(','),
      });
      const result = await versionMapForPath(
        connection,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items?${params.toString()}`,
      );
      for (const [key, version] of Object.entries(result.versions)) versions.set(key, version);
      latestVersion = Math.max(latestVersion, result.libraryVersion);
      backoffSeconds = Math.max(backoffSeconds ?? 0, result.backoffSeconds ?? 0) || null;
    }

    const force = new Set(options.forceItemKeys ?? []);
    const changedKeys = [...versions.entries()]
      .filter(([key, version]) => {
        const link = linksByItem.get(key);
        return options.refreshCitations || force.has(key) || !link || link.item_version !== version || link.sync_status === 'local_pending';
      })
      .map(([key]) => key);
    for (const key of force) if (!changedKeys.includes(key)) changedKeys.push(key);
    const style = await citationStyleForUser(userId);
    const fetched = await fetchItems(connection, changedKeys, style);
    latestVersion = Math.max(latestVersion, fetched.libraryVersion);
    let conflictCount = 0;
    for (const item of fetched.items) {
      if (!isImportableLibraryItem(item)) continue;
      const result = await syncItemWithRetry(userId, connection, item, sources, linksByItem, usedCiteKeys, style);
      latestVersion = Math.max(latestVersion, result.libraryVersion);
      if (result.conflict) conflictCount += 1;
    }

    if (connection.lastLibraryVersion > 0) {
      const deleted = await zoteroJson<Record<string, string[]>>(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/deleted?since=${connection.lastLibraryVersion}`,
      );
      latestVersion = Math.max(latestVersion, deleted.libraryVersion ?? 0);
      const deletedKeys = new Set(stringArray(deleted.data.items));
      for (const itemKey of deletedKeys) {
        const link = linksByItem.get(itemKey);
        if (!link) continue;
        const source = sources.get(link.source_id);
        if (source) {
          source.zoteroLink = zoteroLinkPayload({
            ...link,
            sync_status: 'removed_remote',
            last_error: 'This item was removed from Zotero.',
          });
          await saveSource(userId, source);
        }
        await supabase.from('thesis_zotero_item_links').update({
          sync_status: 'removed_remote',
          last_error: 'This item was removed from Zotero.',
        }).eq('user_id', userId).eq('source_id', link.source_id);
      }
    }

    const now = new Date().toISOString();
    await updateConnectionStatus(userId, backoffSeconds ? 'backoff' : 'ok', {
      last_library_version: latestVersion,
      last_sync_at: now,
      backoff_until: backoffSeconds ? new Date(Date.now() + backoffSeconds * 1000).toISOString() : null,
    });
    await supabase.from('zotero_sync_outbox').delete().eq('user_id', userId);
    return {
      ok: true as const,
      conflictCount,
      lastLibraryVersion: latestVersion,
      lastSyncAt: now,
      sources: await listThesisSources(userId),
    };
  } catch (error) {
    const retryAfter = error instanceof ZoteroApiError ? error.retryAfterSeconds : null;
    await updateConnectionStatus(userId, retryAfter ? 'backoff' : 'error', {
      last_sync_error: error instanceof Error ? error.message : 'Zotero sync failed',
      ...(retryAfter ? { backoff_until: new Date(Date.now() + retryAfter * 1000).toISOString() } : {}),
    });
    throw error;
  }
}

export function performZoteroSync(userId: string, options: ZoteroSyncOptions = {}): Promise<ZoteroSyncResult> {
  const current = activeSyncs.get(userId);
  if (current) {
    // A stream event can arrive after the active run read its version map.
    // Merge concurrent callers into one follow-up pass instead of dropping
    // later notifications or starting a chain of redundant runs.
    const previousOptions = queuedSyncOptions.get(userId) ?? {};
    queuedSyncOptions.set(userId, {
      forceItemKeys: [...new Set([...(previousOptions.forceItemKeys ?? []), ...(options.forceItemKeys ?? [])])],
      selectedCollectionKeys: options.selectedCollectionKeys ?? previousOptions.selectedCollectionKeys,
      syncAll: typeof options.syncAll === 'boolean' ? options.syncAll : previousOptions.syncAll,
      refreshCitations: Boolean(previousOptions.refreshCitations || options.refreshCitations),
    });
    const queued = queuedSyncs.get(userId);
    if (queued) return queued;
    const runFollowUp = () => {
      const followUpOptions = queuedSyncOptions.get(userId) ?? {};
      queuedSyncOptions.delete(userId);
      queuedSyncs.delete(userId);
      return performZoteroSync(userId, followUpOptions);
    };
    const followUp = current.then(runFollowUp, runFollowUp);
    queuedSyncs.set(userId, followUp);
    return followUp;
  }
  const sync = performZoteroSyncInternal(userId, options).finally(() => {
    if (activeSyncs.get(userId) === sync) activeSyncs.delete(userId);
  });
  activeSyncs.set(userId, sync);
  return sync;
}

export async function importZoteroItems(userId: string, itemKeys: string[]) {
  const connection = await getZoteroConnection(userId);
  if (!connection) throw new Error('Zotero is not connected');
  const style = await citationStyleForUser(userId);
  const requestedKeys = [...new Set(itemKeys)].slice(0, 200);
  const fetched = await fetchItems(connection, requestedKeys, style);
  const importableItems = fetched.items.filter(isImportableLibraryItem);
  if (importableItems.length === 0) {
    throw new Error('None of the selected Zotero items can be imported. Select a library item or a standalone file, rather than a note, annotation, or child attachment.');
  }
  const { sources, linksByItem } = await sourceAndLinks(userId);
  const usedCiteKeys = new Set([...sources.values()].map((source) => stringValue(source.citeKey)).filter(Boolean));
  for (const item of importableItems) {
    await syncItemWithRetry(userId, connection, item, sources, linksByItem, usedCiteKeys, style);
  }
  return {
    sources: await listThesisSources(userId),
    importedCount: importableItems.length,
    skippedCount: Math.max(0, requestedKeys.length - importableItems.length),
  };
}

export async function exportThesisSourceToZotero(userId: string, sourceId: string) {
  const connection = await getZoteroConnection(userId);
  if (!connection) throw new Error('Zotero is not connected');
  const sources = await listThesisSources(userId);
  const source = sources.find((item) => item.id === sourceId);
  if (!source) throw new Error('Thesis source not found');
  const existingLink = asObject(source.zoteroLink);
  if (stringValue(existingLink.itemKey)) return source;
  const itemType = zoteroItemTypeForSource(source);
  const template = await zoteroJson<Record<string, unknown>>(
    connection.apiKey,
    `/items/new?itemType=${encodeURIComponent(itemType)}`,
  );
  const canonical = canonicalFromSource(source);
  const patch = patchFromCanonical(canonical, { ...template.data, itemType }, CANONICAL_FIELDS);
  const writeToken = randomBytes(16).toString('hex');
  const created = await zoteroJson<{ success?: Record<string, string>; failed?: Record<string, unknown> }>(
    connection.apiKey,
    `/users/${encodeURIComponent(connection.zoteroUserId)}/items`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': writeToken },
      body: JSON.stringify([{ ...template.data, ...patch, itemType }]),
    },
  );
  const itemKey = created.data.success?.['0'];
  if (!itemKey) throw new Error('Zotero did not create the source item');
  const style = await citationStyleForUser(userId);
  const fetched = await fetchItems(connection, [itemKey], style);
  const item = fetched.items[0];
  if (!item) throw new Error('The new Zotero item could not be loaded');
  const children = await fetchZoteroChildren(connection, item.key);
  await createImportedSource(userId, connection, item, children, new Set(), sourceId);
  return (await listThesisSources(userId)).find((entry) => entry.id === sourceId) ?? source;
}

export async function listZoteroConflicts(userId: string): Promise<ZoteroSyncConflict[]> {
  const { data, error } = await supabase
    .from('zotero_sync_conflicts')
    .select('id,source_id,item_key,fields,remote_version,created_at')
    .eq('user_id', userId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const payload = asObject(row.fields);
    return {
      id: row.id,
      sourceId: row.source_id,
      itemKey: row.item_key,
      fields: asObject(payload.conflicts) as ZoteroSyncConflict['fields'],
      remoteVersion: Number(row.remote_version),
      createdAt: row.created_at,
    };
  });
}

export async function resolveZoteroConflict(
  userId: string,
  conflictId: string,
  resolutions: Record<string, 'local' | 'remote' | { value: unknown }>,
) {
  const { data: row, error } = await supabase
    .from('zotero_sync_conflicts')
    .select('*')
    .eq('id', conflictId)
    .eq('user_id', userId)
    .is('resolved_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('Zotero conflict not found');
  const sources = await listThesisSources(userId);
  const source = sources.find((item) => item.id === row.source_id);
  if (!source) throw new Error('The linked thesis source no longer exists');
  const payload = asObject(row.fields);
  const remoteCanonical = asObject(payload.remoteCanonical) as CanonicalSource;
  const conflicts = asObject(payload.conflicts);
  // The saved source already contains every non-overlapping merge. Start there
  // so resolving one field cannot discard unrelated Odyssey edits.
  const resolved = canonicalFromSource(source);
  for (const [field, values] of Object.entries(conflicts)) {
    const choice = resolutions[field];
    const options = asObject(values);
    if (choice === 'local') resolved[field as keyof CanonicalSource] = options.local as never;
    else if (choice === 'remote') resolved[field as keyof CanonicalSource] = options.remote as never;
    else if (choice && typeof choice === 'object' && 'value' in choice) {
      resolved[field as keyof CanonicalSource] = choice.value as never;
    } else {
      throw new Error(`A resolution is required for ${field}`);
    }
  }
  const nextSource = applyCanonicalToSource(source, resolved);
  nextSource.citation = stringValue(payload.remoteCitation) || stringValue(source.citation);
  const children = asObject(payload.remoteChildren);
  nextSource.zoteroNotes = Array.isArray(children.notes) ? children.notes : [];
  nextSource.zoteroAttachments = Array.isArray(children.attachments) ? children.attachments : [];
  nextSource.zoteroAnnotations = Array.isArray(children.annotations) ? children.annotations : [];
  await saveSource(userId, nextSource);
  const { error: linkError } = await supabase.from('thesis_zotero_item_links').update({
    item_version: row.remote_version,
    baseline_data: { canonical: remoteCanonical, raw: asObject(payload.remoteRaw) },
    sync_status: 'local_pending',
    last_error: null,
  }).eq('user_id', userId).eq('source_id', row.source_id);
  if (linkError) throw linkError;
  await supabase.from('zotero_sync_conflicts').update({ resolved_at: new Date().toISOString() }).eq('id', conflictId);
  await supabase.from('zotero_sync_outbox').insert({
    user_id: userId,
    source_id: row.source_id,
    operation: 'sync_source',
    payload: {},
  });
  return performZoteroSync(userId, { forceItemKeys: [row.item_key] });
}

export async function unlinkZoteroSource(userId: string, sourceId: string) {
  const sources = await listThesisSources(userId);
  const source = sources.find((item) => item.id === sourceId);
  if (!source) throw new Error('Thesis source not found');
  const next = { ...source };
  delete next.zoteroLink;
  delete next.zoteroNotes;
  delete next.zoteroAttachments;
  delete next.zoteroAnnotations;
  await supabase.from('thesis_zotero_item_links').delete().eq('user_id', userId).eq('source_id', sourceId);
  await saveSource(userId, next);
  return next;
}

type SyncLogger = {
  info: (value: unknown, message?: string) => void;
  warn: (value: unknown, message?: string) => void;
};

let backgroundStarted = false;

export function startZoteroBackgroundSync(logger: SyncLogger) {
  if (backgroundStarted) return;
  backgroundStarted = true;

  const processPending = async () => {
    const { data } = await supabase
      .from('zotero_sync_outbox')
      .select('user_id,attempts')
      .lte('available_at', new Date().toISOString())
      .limit(100);
    const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
    for (const userId of userIds) {
      try {
        await performZoteroSync(userId);
      } catch (error) {
        logger.warn({ userId, error: error instanceof Error ? error.message : 'Unknown error' }, 'Zotero outbox sync failed');
        const attempts = Math.max(0, ...(data ?? []).filter((row) => row.user_id === userId).map((row) => Number(row.attempts ?? 0))) + 1;
        await supabase.from('zotero_sync_outbox').update({
          attempts,
          available_at: new Date(Date.now() + Math.min(15 * 60_000, 15_000 * (2 ** Math.min(attempts, 6)))).toISOString(),
          last_error: error instanceof Error ? error.message : 'Zotero sync failed',
        }).eq('user_id', userId);
      }
    }
  };

  const periodic = async () => {
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data } = await supabase
      .from('user_zotero_connections')
      .select('user_id')
      .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
      .limit(100);
    for (const row of data ?? []) {
      void performZoteroSync(row.user_id).catch((error) => {
        logger.warn({ userId: row.user_id, error: error instanceof Error ? error.message : 'Unknown error' }, 'Periodic Zotero sync failed');
      });
    }
  };

  const outboxTimer = setInterval(() => { void processPending(); }, 15_000);
  const periodicTimer = setInterval(() => { void periodic(); }, 5 * 60_000);
  outboxTimer.unref();
  periodicTimer.unref();
  void processPending();

  const WebSocketConstructor = globalThis.WebSocket;
  if (!WebSocketConstructor) {
    logger.warn({}, 'Node WebSocket is unavailable; Zotero will use periodic sync only');
    return;
  }

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let socket: WebSocket | null = null;
  const connect = () => {
    socket = new WebSocketConstructor('wss://stream.zotero.org');
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { event?: string; topic?: string; retry?: number };
        if (message.event === 'connected') {
          void supabase.from('user_zotero_connections').select('*').then(({ data }) => {
            const subscriptions = (data ?? []).map((row) => ({
              apiKey: decryptZoteroSecret({
                encrypted: row.encrypted_api_key,
                iv: row.iv,
                authTag: row.auth_tag,
              }),
              topics: [`/users/${row.zotero_user_id}`],
            }));
            if (subscriptions.length > 0 && socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ action: 'createSubscriptions', subscriptions }));
            }
            void periodic();
          });
        } else if (message.event === 'topicUpdated' && message.topic?.startsWith('/users/')) {
          const zoteroUserId = message.topic.slice('/users/'.length);
          void supabase.from('user_zotero_connections').select('user_id').eq('zotero_user_id', zoteroUserId).then(({ data }) => {
            for (const row of data ?? []) {
              void performZoteroSync(row.user_id).catch((error) => {
                logger.warn({ userId: row.user_id, error: error instanceof Error ? error.message : 'Unknown error' }, 'Stream-triggered Zotero sync failed');
              });
            }
          });
        }
      } catch {
        // Ignore malformed streaming messages and continue listening.
      }
    });
    socket.addEventListener('close', () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 10_000);
      reconnectTimer.unref();
    });
    socket.addEventListener('error', () => socket?.close());
  };
  connect();
  logger.info({}, 'Zotero background and streaming sync started');
}
