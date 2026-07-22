export type CommitDiffStatus = 'added' | 'deleted' | 'renamed' | 'modified' | 'copied' | 'unknown';

export interface CommitDiffFileInput {
  oldPath: string;
  newPath: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string | null;
  binary?: boolean;
  truncated?: boolean;
}

export interface CommitDiffFile {
  oldPath: string;
  newPath: string;
  status: CommitDiffStatus;
  additions: number;
  deletions: number;
  patch: string | null;
  binary: boolean;
  truncated: boolean;
}

interface CommitDiffTotals {
  reportedFileCount?: number;
  additions?: number;
  deletions?: number;
  truncated?: boolean;
}

const MAX_DIFF_FILES = 100;
const MAX_PATCH_CHARS_PER_FILE = 160_000;
const MAX_TOTAL_PATCH_CHARS = 750_000;

function normalizeStatus(status: string | undefined): CommitDiffStatus {
  switch (status?.toLowerCase()) {
    case 'added':
    case 'deleted':
    case 'renamed':
    case 'modified':
    case 'copied':
      return status.toLowerCase() as CommitDiffStatus;
    case 'removed':
      return 'deleted';
    case 'changed':
      return 'modified';
    default:
      return 'unknown';
  }
}

function countPatchChanges(patch: string | null | undefined): { additions: number; deletions: number } {
  if (!patch) return { additions: 0, deletions: 0 };

  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function truncatePatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) return patch;
  const clipped = patch.slice(0, Math.max(0, maxChars));
  const finalLineBreak = clipped.lastIndexOf('\n');
  return `${finalLineBreak > 0 ? clipped.slice(0, finalLineBreak) : clipped}\n… diff truncated by Odyssey …`;
}

export function buildCommitDiffPayload(files: CommitDiffFileInput[], totals: CommitDiffTotals = {}) {
  let remainingPatchChars = MAX_TOTAL_PATCH_CHARS;

  const normalizedFiles: CommitDiffFile[] = files.slice(0, MAX_DIFF_FILES).map((file) => {
    const originalPatch = typeof file.patch === 'string' && file.patch.length > 0 ? file.patch : null;
    const patchCounts = countPatchChanges(originalPatch);
    const allowedChars = Math.min(MAX_PATCH_CHARS_PER_FILE, remainingPatchChars);
    const patch = originalPatch && allowedChars > 0 ? truncatePatch(originalPatch, allowedChars) : null;
    const wasTruncated = Boolean(file.truncated)
      || Boolean(originalPatch && (!patch || allowedChars < originalPatch.length));

    if (patch) remainingPatchChars = Math.max(0, remainingPatchChars - patch.length);

    return {
      oldPath: file.oldPath,
      newPath: file.newPath,
      status: normalizeStatus(file.status),
      additions: Number.isFinite(file.additions) ? Math.max(0, file.additions ?? 0) : patchCounts.additions,
      deletions: Number.isFinite(file.deletions) ? Math.max(0, file.deletions ?? 0) : patchCounts.deletions,
      patch,
      binary: Boolean(file.binary),
      truncated: wasTruncated,
    };
  });

  const computedAdditions = files.reduce((sum, file) => {
    if (Number.isFinite(file.additions)) return sum + Math.max(0, file.additions ?? 0);
    return sum + countPatchChanges(file.patch).additions;
  }, 0);
  const computedDeletions = files.reduce((sum, file) => {
    if (Number.isFinite(file.deletions)) return sum + Math.max(0, file.deletions ?? 0);
    return sum + countPatchChanges(file.patch).deletions;
  }, 0);
  const reportedFileCount = Math.max(totals.reportedFileCount ?? files.length, files.length);

  return {
    files: normalizedFiles,
    stats: {
      files: reportedFileCount,
      additions: Number.isFinite(totals.additions) ? Math.max(0, totals.additions ?? 0) : computedAdditions,
      deletions: Number.isFinite(totals.deletions) ? Math.max(0, totals.deletions ?? 0) : computedDeletions,
    },
    truncated: Boolean(totals.truncated)
      || reportedFileCount > normalizedFiles.length
      || normalizedFiles.some((file) => file.truncated),
  };
}
