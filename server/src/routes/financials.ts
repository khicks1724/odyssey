import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { checkRateLimit } from '../lib/rate-limit.js';
import { requireProjectAccessFromAuthHeader } from '../lib/request-auth.js';
import { supabase } from '../lib/supabase.js';

const MAX_FINANCIAL_IMPORT_BYTES = 8 * 1024 * 1024;
const FINANCIAL_IMPORT_RATE_LIMIT = { maxRequests: 8, windowMs: 60_000 };

type ParsedFinancialRow = {
  label: string;
  amount: number;
  category: 'budget' | 'expense' | 'revenue';
  note: string | null;
  date: string | null;
  sheet_name: string | null;
};

function parseAmount(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const normalized = String(value).replace(/[$,\s]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function inferCategory(sheetName: string, categoryValue: string): 'budget' | 'expense' | 'revenue' {
  const source = `${sheetName} ${categoryValue}`.toLowerCase();
  if (/budget|plan|alloc/.test(source)) return 'budget';
  if (/revenue|income|earn|receipt/.test(source)) return 'revenue';
  return 'expense';
}

function findHeaderRow(rows: unknown[][]): number {
  for (let index = 0; index < Math.min(10, rows.length); index += 1) {
    const textCells = rows[index].filter((cell) => typeof cell === 'string' && cell.trim().length > 0);
    if (textCells.length >= 2) return index;
  }
  return 0;
}

function mapWorksheetRows(rows: unknown[][], sheetName: string): ParsedFinancialRow[] {
  if (rows.length < 2) return [];
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map((value) => String(value ?? '').trim().toLowerCase());

  const amountIndex = headers.findIndex((header) => /amount|cost|price|total|budget|value|spend|expense|actual|est/i.test(header));
  const labelIndex = headers.findIndex((header) => /name|label|desc|item|title|task|activity|account|line/i.test(header));
  const dateIndex = headers.findIndex((header) => /date|when|period|month/i.test(header));
  const categoryIndex = headers.findIndex((header) => /^(category|type|class|kind|group)$/i.test(header));
  const noteIndex = headers.findIndex((header) => /note|comment|remark|detail/i.test(header));

  const parsed: ParsedFinancialRow[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const label = labelIndex >= 0 ? String(row[labelIndex] ?? '').trim() : '';
    const amount = amountIndex >= 0 ? parseAmount(row[amountIndex]) : 0;
    if (!label && !amount) continue;

    const categoryValue = categoryIndex >= 0 ? String(row[categoryIndex] ?? '').trim() : '';
    parsed.push({
      label: label || `${sheetName} row ${rowIndex + 1}`,
      amount,
      category: inferCategory(sheetName, categoryValue),
      note: noteIndex >= 0 ? String(row[noteIndex] ?? '').trim() || null : null,
      date: dateIndex >= 0 ? parseDate(row[dateIndex]) : null,
      sheet_name: sheetName || null,
    });
  }

  return parsed;
}

async function readSingleImportFile(request: any): Promise<{ filename: string; buffer: Buffer }> {
  const parts = request.parts();
  let filename = '';
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const part of parts) {
    if (part.type !== 'file') continue;
    filename = part.filename || 'financial-import';

    for await (const chunk of part.file) {
      const bufferChunk = chunk as Buffer;
      totalBytes += bufferChunk.byteLength;
      if (totalBytes > MAX_FINANCIAL_IMPORT_BYTES) {
        throw new Error('Financial imports are limited to 8 MB.');
      }
      chunks.push(bufferChunk);
    }
    break;
  }

  return { filename, buffer: Buffer.concat(chunks) };
}

async function parseFinancialImport(buffer: Buffer, filename: string): Promise<ParsedFinancialRow[]> {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith('.csv')) {
    const rows = buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').replace(/""/g, '"')));
    return mapWorksheetRows(rows, 'CSV');
  }

  if (!lowerName.endsWith('.xlsx')) {
    throw new Error('Only CSV and XLSX financial imports are supported.');
  }

  const workbook = new ExcelJS.Workbook();
  const excelBuffer: any = buffer;
  await workbook.xlsx.load(excelBuffer);

  const parsed: ParsedFinancialRow[] = [];
  workbook.eachSheet((worksheet) => {
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values as unknown[]);
    });
    parsed.push(...mapWorksheetRows(rows, worksheet.name));
  });

  return parsed;
}

export async function financialRoutes(server: FastifyInstance) {
  server.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/financials/import',
    async (request, reply) => {
      const access = await requireProjectAccessFromAuthHeader(request.params.projectId, request.headers.authorization);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });

      const rateLimit = checkRateLimit(`financial-import:${access.userId}:${request.params.projectId}`, FINANCIAL_IMPORT_RATE_LIMIT);
      if (rateLimit.limited) {
        return reply.status(429).send({
          error: 'Too many financial import requests. Please wait before trying again.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
      }

      try {
        const { filename, buffer } = await readSingleImportFile(request);
        if (!filename || buffer.byteLength === 0) {
          return reply.status(400).send({ error: 'A CSV or XLSX file is required.' });
        }

        const rows = await parseFinancialImport(buffer, filename);
        if (rows.length === 0) {
          return reply.status(422).send({ error: 'No financial rows could be parsed from that file.' });
        }

        const payload = rows.map((row) => ({
          project_id: request.params.projectId,
          created_by: access.userId,
          ...row,
        }));

        const { error } = await supabase.from('project_financials').insert(payload);
        if (error) return reply.status(500).send({ error: error.message });

        return reply.send({
          inserted: payload.length,
          sheets: [...new Set(rows.map((row) => row.sheet_name).filter(Boolean))],
        });
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : 'Unable to import financial data.' });
      }
    },
  );
}
