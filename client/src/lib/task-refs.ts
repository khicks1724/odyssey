export interface TaskReference {
  id: string;
  title: string;
}

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const TASK_REFERENCE_PATTERNS = [
  new RegExp(`\\[task_id:(${UUID_PATTERN})\\]`, 'g'),
  new RegExp(`\\btask\\s+(${UUID_PATTERN})\\b`, 'gi'),
  new RegExp(`\\b(?:task_id:|goal_id:|goalId:|ID:)?(${UUID_PATTERN})\\b`, 'g'),
];

export function replaceTaskIdsWithTitles(text: string, tasks: TaskReference[] | null | undefined): string {
  if (!text || !tasks?.length) return text;

  const taskTitleById = new Map(
    tasks
      .filter((task) => typeof task.id === 'string' && typeof task.title === 'string' && task.id && task.title.trim())
      .map((task) => [task.id.toLowerCase(), task.title.trim()]),
  );
  if (taskTitleById.size === 0) return text;

  let sanitized = text;
  for (const pattern of TASK_REFERENCE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, rawTaskId: string) => {
      const replacement = taskTitleById.get(rawTaskId.toLowerCase());
      return replacement || match;
    });
  }

  return sanitized;
}
