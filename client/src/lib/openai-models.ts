const SNAPSHOT_DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;
const GPT_NUMERIC_ALIAS = /^gpt-\d+(?:\.\d+)?-\d+$/i;

function stripSnapshotDate(modelId: string): string {
  return modelId.replace(SNAPSHOT_DATE_SUFFIX, '');
}

export function getOpenAiModelFamilyKey(modelId: string): string {
  const normalized = stripSnapshotDate(modelId.trim().toLowerCase());
  const flagshipSnapshot = normalized.match(/^(gpt-\d+(?:\.\d+)?)-pro$/i);
  if (flagshipSnapshot) return flagshipSnapshot[1];
  return normalized;
}

function getOpenAiModelPreference(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  if (GPT_NUMERIC_ALIAS.test(normalized)) return 0;
  if (!SNAPSHOT_DATE_SUFFIX.test(normalized)) return 1;
  return 2;
}

function compareOpenAiModelIds(a: string, b: string): number {
  const preferenceDelta = getOpenAiModelPreference(a) - getOpenAiModelPreference(b);
  if (preferenceDelta !== 0) return preferenceDelta;

  const lengthDelta = a.length - b.length;
  if (lengthDelta !== 0) return lengthDelta;

  return a.localeCompare(b);
}

export function normalizeOpenAiModelIds(modelIds: string[]): string[] {
  const grouped = new Map<string, string[]>();

  for (const rawId of modelIds) {
    const modelId = rawId.trim();
    if (!modelId) continue;

    const familyKey = getOpenAiModelFamilyKey(modelId);
    const existing = grouped.get(familyKey);
    if (existing) {
      existing.push(modelId);
    } else {
      grouped.set(familyKey, [modelId]);
    }
  }

  return [...grouped.values()]
    .map((ids) => [...new Set(ids)].sort(compareOpenAiModelIds)[0])
    .sort((a, b) => a.localeCompare(b));
}

export function canonicalizeOpenAiModelId(modelId: string, availableModelIds: string[]): string {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return '';

  const familyKey = getOpenAiModelFamilyKey(normalizedModelId);
  const familyCandidates = availableModelIds
    .map((id) => id.trim())
    .filter((id) => id && getOpenAiModelFamilyKey(id) === familyKey);

  if (familyCandidates.length === 0) return normalizedModelId;
  return [...new Set(familyCandidates)].sort(compareOpenAiModelIds)[0];
}
