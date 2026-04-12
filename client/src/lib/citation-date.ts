const MONTHS = [
  { index: 0, full: 'January', short: 'Jan.' },
  { index: 1, full: 'February', short: 'Feb.' },
  { index: 2, full: 'March', short: 'Mar.' },
  { index: 3, full: 'April', short: 'Apr.' },
  { index: 4, full: 'May', short: 'May' },
  { index: 5, full: 'June', short: 'Jun.' },
  { index: 6, full: 'July', short: 'Jul.' },
  { index: 7, full: 'August', short: 'Aug.' },
  { index: 8, full: 'September', short: 'Sep.' },
  { index: 9, full: 'October', short: 'Oct.' },
  { index: 10, full: 'November', short: 'Nov.' },
  { index: 11, full: 'December', short: 'Dec.' },
] as const;

const MONTH_INDEX_BY_NAME = new Map<string, number>([
  ['jan', 0],
  ['january', 0],
  ['feb', 1],
  ['february', 1],
  ['mar', 2],
  ['march', 2],
  ['apr', 3],
  ['april', 3],
  ['may', 4],
  ['jun', 5],
  ['june', 5],
  ['jul', 6],
  ['july', 6],
  ['aug', 7],
  ['august', 7],
  ['sep', 8],
  ['sept', 8],
  ['september', 8],
  ['oct', 9],
  ['october', 9],
  ['nov', 10],
  ['november', 10],
  ['dec', 11],
  ['december', 11],
]);

type DateParts = {
  year: string;
  month: number | null;
  day: number | null;
};

function cleanRawDateInput(raw: string) {
  return raw
    .replace(/[|•·]/g, ' ')
    .replace(/[()[\]{}<>]/g, ' ')
    .replace(/[“”"']/g, ' ')
    .replace(/[^\w\s,./:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDateParts(raw: string): DateParts | null {
  const cleaned = cleanRawDateInput(raw);
  if (!cleaned) return null;

  const monthNameMatch = cleaned.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?[\s,/-]*(\d{1,2})?(?:st|nd|rd|th)?[\s,/-]*(\d{4})\b/i);
  if (monthNameMatch) {
    const monthKey = monthNameMatch[1].toLowerCase().replace(/\.$/, '');
    const month = MONTH_INDEX_BY_NAME.get(monthKey);
    if (month !== undefined) {
      const day = monthNameMatch[2] ? Number.parseInt(monthNameMatch[2], 10) : null;
      return {
        year: monthNameMatch[3],
        month,
        day: day && day >= 1 && day <= 31 ? day : null,
      };
    }
  }

  const numericMatch = cleaned.match(/\b(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})\b/);
  if (numericMatch) {
    const first = Number.parseInt(numericMatch[1], 10);
    const second = Number.parseInt(numericMatch[2], 10);
    const third = Number.parseInt(numericMatch[3], 10);

    if (numericMatch[1].length === 4) {
      return {
        year: String(first),
        month: second >= 1 && second <= 12 ? second - 1 : null,
        day: third >= 1 && third <= 31 ? third : null,
      };
    }

    if (numericMatch[3].length === 4) {
      return {
        year: String(third),
        month: first >= 1 && first <= 12 ? first - 1 : null,
        day: second >= 1 && second <= 31 ? second : null,
      };
    }
  }

  const monthYearMatch = cleaned.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?[\s,/-]+(\d{4})\b/i);
  if (monthYearMatch) {
    const monthKey = monthYearMatch[1].toLowerCase().replace(/\.$/, '');
    const month = MONTH_INDEX_BY_NAME.get(monthKey);
    if (month !== undefined) {
      return {
        year: monthYearMatch[2],
        month,
        day: null,
      };
    }
  }

  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return {
      year: yearMatch[0],
      month: null,
      day: null,
    };
  }

  return null;
}

function formatDateParts(parts: DateParts, format: string) {
  if (parts.month === null) {
    return parts.year;
  }

  const month = MONTHS[parts.month];
  if (!month) return parts.year;

  if (parts.day === null) {
    if (format === 'apa') return `${parts.year}, ${month.full}`;
    if (format === 'ieee' || format === 'asme' || format === 'aiaa' || format === 'ams') {
      return `${month.short} ${parts.year}`;
    }
    return `${month.full} ${parts.year}`;
  }

  if (format === 'apa') return `${parts.year}, ${month.full} ${parts.day}`;
  if (format === 'ieee' || format === 'asme' || format === 'aiaa' || format === 'ams') {
    return `${month.short} ${parts.day}, ${parts.year}`;
  }
  return `${month.full} ${parts.day}, ${parts.year}`;
}

export function normalizePublicationDate(raw: string, format: string) {
  const parts = buildDateParts(raw);
  if (parts) return formatDateParts(parts, format);
  return cleanRawDateInput(raw)
    .replace(/[,:;./-]+$/g, '')
    .trim();
}

export function getPublicationDatePlaceholder(format: string) {
  if (format === 'apa') return '2026, April 12';
  if (format === 'ieee' || format === 'asme' || format === 'aiaa' || format === 'ams') return 'Apr. 12, 2026';
  return 'April 12, 2026';
}
