import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { checkRateLimit } from '../lib/rate-limit.js';
import { requireProjectAccessFromAuthHeader } from '../lib/request-auth.js';
import { supabase } from '../lib/supabase.js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import JSZip from 'jszip';

const GOAL_ATTACHMENT_BUCKET = 'goal-attachments';
const MAX_COMMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_COMMENT_ATTACHMENTS = 5;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const COMMENT_RATE_LIMIT = { maxRequests: 25, windowMs: 60_000 };
const ATTACHMENT_SIGN_TTL_SECONDS = 900;
const MAX_ATTACHMENT_EXTRACT_CHARS = 20_000;
const MAX_ATTACHMENT_PREVIEW_CHARS = 1_200;
const ATTACHMENT_EXTRACTION_TIMEOUT_MS = 10_000;

const ALLOWED_ATTACHMENT_MIME_PREFIXES = ['image/'];
const ALLOWED_ATTACHMENT_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.txt',
  '.md',
  '.csv',
  '.json',
]);

type MultipartFile = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

function sanitizeFileName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.slice(index).toLowerCase() : '';
}

function isAllowedAttachmentType(filename: string, mimeType: string): boolean {
  const extension = getFileExtension(filename);
  if (ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) return true;
  if (ALLOWED_ATTACHMENT_MIME.has(mimeType)) return true;
  return ALLOWED_ATTACHMENT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function summarizeAttachmentText(text: string, filename: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const summary = trimmed.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 240);
  return summary || `${filename} attached to a task note`;
}

async function extractAttachmentText(file: MultipartFile): Promise<string | null> {
  const lower = file.filename.toLowerCase();

  if (file.mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    try {
      const data = await withTimeout(pdfParse(file.buffer), ATTACHMENT_EXTRACTION_TIMEOUT_MS, 'Attachment PDF extraction');
      return data.text?.trim().slice(0, MAX_ATTACHMENT_EXTRACT_CHARS) || null;
    } catch {
      return null;
    }
  }

  if (file.mimeType.includes('wordprocessingml') || lower.endsWith('.docx')) {
    try {
      const result = await withTimeout(mammoth.extractRawText({ buffer: file.buffer }), ATTACHMENT_EXTRACTION_TIMEOUT_MS, 'Attachment DOCX extraction');
      return result.value?.trim().slice(0, MAX_ATTACHMENT_EXTRACT_CHARS) || null;
    } catch {
      return null;
    }
  }

  if (file.mimeType.includes('presentationml') || lower.endsWith('.pptx')) {
    try {
      const zip = await withTimeout(JSZip.loadAsync(file.buffer), ATTACHMENT_EXTRACTION_TIMEOUT_MS, 'Attachment PPTX extraction');
      const slideFiles = Object.keys(zip.files)
        .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
        .sort((left, right) => left.localeCompare(right));
      const textParts: string[] = [];
      for (const slideFile of slideFiles) {
        const xml = await zip.file(slideFile)?.async('string');
        if (!xml) continue;
        const slideText = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (slideText) textParts.push(slideText);
      }
      return textParts.join('\n').slice(0, MAX_ATTACHMENT_EXTRACT_CHARS) || null;
    } catch {
      return null;
    }
  }

  if (
    file.mimeType.startsWith('text/')
    || lower.endsWith('.txt')
    || lower.endsWith('.md')
    || lower.endsWith('.csv')
    || lower.endsWith('.json')
  ) {
    return file.buffer.toString('utf8').slice(0, MAX_ATTACHMENT_EXTRACT_CHARS);
  }

  return null;
}

async function readMultipartFiles(
  request: Parameters<FastifyInstance['post']>[1] extends never ? never : any,
  options: {
    maxFileCount: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    fileFieldName?: string;
  },
): Promise<{ fields: Record<string, string>; files: MultipartFile[] }> {
  const parts = request.parts();
  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];
  let totalBytes = 0;

  for await (const part of parts) {
    if (part.type === 'field') {
      fields[part.fieldname] = `${part.value ?? ''}`;
      continue;
    }

    if (options.fileFieldName && part.fieldname !== options.fileFieldName) {
      continue;
    }
    if (files.length >= options.maxFileCount) {
      throw new Error(`A maximum of ${options.maxFileCount} files can be uploaded at once.`);
    }

    const filename = part.filename || 'attachment';
    const mimeType = part.mimetype || 'application/octet-stream';
    const chunks: Buffer[] = [];
    let fileBytes = 0;

    for await (const chunk of part.file) {
      const bufferChunk = chunk as Buffer;
      fileBytes += bufferChunk.byteLength;
      totalBytes += bufferChunk.byteLength;

      if (fileBytes > options.maxFileBytes) {
        throw new Error(`"${filename}" exceeds the ${(options.maxFileBytes / (1024 * 1024)).toFixed(0)} MB limit.`);
      }
      if (totalBytes > options.maxTotalBytes) {
        throw new Error(`Combined attachment uploads exceed the ${(options.maxTotalBytes / (1024 * 1024)).toFixed(0)} MB limit.`);
      }

      chunks.push(bufferChunk);
    }

    files.push({
      filename,
      mimeType,
      buffer: Buffer.concat(chunks),
    });
  }

  return { fields, files };
}

async function verifyGoalBelongsToProject(goalId: string, projectId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('goals')
    .select('id')
    .eq('id', goalId)
    .eq('project_id', projectId)
    .maybeSingle();
  return !error && !!data;
}

export async function goalActivityRoutes(server: FastifyInstance) {
  server.post<{ Params: { projectId: string; goalId: string } }>(
    '/projects/:projectId/goals/:goalId/comments',
    async (request, reply) => {
      const access = await requireProjectAccessFromAuthHeader(request.params.projectId, request.headers.authorization);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });

      const rateLimit = checkRateLimit(`goal-comment:${access.userId}:${request.params.projectId}`, COMMENT_RATE_LIMIT);
      if (rateLimit.limited) {
        return reply.status(429).send({
          error: 'Too many task note requests. Please wait before trying again.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
      }

      if (!(await verifyGoalBelongsToProject(request.params.goalId, request.params.projectId))) {
        return reply.status(404).send({ error: 'Task not found.' });
      }

      try {
        const { fields, files } = await readMultipartFiles(request, {
          maxFileCount: MAX_COMMENT_ATTACHMENTS,
          maxFileBytes: MAX_COMMENT_ATTACHMENT_BYTES,
          maxTotalBytes: MAX_TOTAL_ATTACHMENT_BYTES,
        });
        const content = (fields.content ?? '').trim();

        if (!content && files.length === 0) {
          return reply.status(400).send({ error: 'A note or at least one attachment is required.' });
        }

        for (const file of files) {
          if (!isAllowedAttachmentType(file.filename, file.mimeType)) {
            return reply.status(415).send({
              error: `Unsupported attachment type for "${file.filename}".`,
            });
          }
        }

        const { data: comment, error: commentError } = await supabase
          .from('goal_comments')
          .insert({
            goal_id: request.params.goalId,
            project_id: request.params.projectId,
            author_id: access.userId,
            content,
          })
          .select('*')
          .single();

        if (commentError || !comment) {
          return reply.status(500).send({ error: commentError?.message ?? 'Unable to save note.' });
        }

        const uploadedRows: Array<Record<string, unknown>> = [];
        try {
          for (const file of files) {
            const storagePath = `${request.params.projectId}/${request.params.goalId}/${randomUUID()}-${sanitizeFileName(file.filename)}`;
            const { error: uploadError } = await supabase.storage
              .from(GOAL_ATTACHMENT_BUCKET)
              .upload(storagePath, file.buffer, {
                contentType: file.mimeType,
                upsert: false,
              });

            if (uploadError) {
              throw new Error(uploadError.message);
            }

            const extractedText = await extractAttachmentText(file);

            uploadedRows.push({
              goal_id: request.params.goalId,
              project_id: request.params.projectId,
              comment_id: comment.id,
              author_id: access.userId,
              file_name: file.filename,
              file_path: storagePath,
              file_size: file.buffer.byteLength,
              mime_type: file.mimeType,
              extracted_text: extractedText,
              content_preview: extractedText?.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS) ?? null,
              document_summary: extractedText ? summarizeAttachmentText(extractedText, file.filename) : null,
              extracted_char_count: extractedText?.length ?? 0,
            });
          }
        } catch (error) {
          if (uploadedRows.length > 0) {
            await supabase.storage.from(GOAL_ATTACHMENT_BUCKET).remove(
              uploadedRows
                .map((row) => row.file_path)
                .filter((value): value is string => typeof value === 'string'),
            );
          }
          await supabase.from('goal_comments').delete().eq('id', comment.id);
          return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unable to upload note attachments.' });
        }

        const attachments = uploadedRows.length > 0
          ? await supabase.from('goal_attachments').insert(uploadedRows).select('*')
          : { data: [], error: null };

        if (attachments.error) {
          await supabase.storage.from(GOAL_ATTACHMENT_BUCKET).remove(
            uploadedRows
              .map((row) => row.file_path)
              .filter((value): value is string => typeof value === 'string'),
          );
          await supabase.from('goal_comments').delete().eq('id', comment.id);
          return reply.status(500).send({ error: attachments.error.message });
        }

        await supabase.from('events').insert({
          project_id: request.params.projectId,
          actor_id: access.userId,
          source: 'manual',
          event_type: 'comment_added',
          title: `Comment on task`,
          summary: content || `${uploadedRows.length} attachment${uploadedRows.length === 1 ? '' : 's'} added to a task note.`,
          metadata: {
            goal_id: request.params.goalId,
            comment_id: comment.id,
            attachment_count: uploadedRows.length,
          },
          occurred_at: new Date().toISOString(),
        });

        return reply.send({
          comment,
          attachments: attachments.data ?? [],
        });
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : 'Unable to parse task note upload.' });
      }
    },
  );

  server.delete<{ Params: { projectId: string; goalId: string; commentId: string } }>(
    '/projects/:projectId/goals/:goalId/comments/:commentId',
    async (request, reply) => {
      const access = await requireProjectAccessFromAuthHeader(request.params.projectId, request.headers.authorization);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });

      const { data: comment } = await supabase
        .from('goal_comments')
        .select('id, author_id')
        .eq('id', request.params.commentId)
        .eq('goal_id', request.params.goalId)
        .eq('project_id', request.params.projectId)
        .maybeSingle();

      if (!comment) return reply.status(404).send({ error: 'Note not found.' });
      if (!access.isOwner && comment.author_id !== access.userId) {
        return reply.status(403).send({ error: 'Only the note author or a project owner can delete this note.' });
      }

      const { data: attachments } = await supabase
        .from('goal_attachments')
        .select('id, file_path')
        .eq('comment_id', request.params.commentId);

      const paths = (attachments ?? [])
        .map((attachment) => attachment.file_path)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

      if (paths.length > 0) {
        await supabase.storage.from(GOAL_ATTACHMENT_BUCKET).remove(paths);
      }

      await supabase.from('goal_attachments').delete().eq('comment_id', request.params.commentId);
      const { error } = await supabase.from('goal_comments').delete().eq('id', request.params.commentId);
      if (error) return reply.status(500).send({ error: error.message });

      return reply.send({ ok: true });
    },
  );

  server.post<{ Params: { projectId: string; goalId: string; attachmentId: string } }>(
    '/projects/:projectId/goals/:goalId/attachments/:attachmentId/sign',
    async (request, reply) => {
      const access = await requireProjectAccessFromAuthHeader(request.params.projectId, request.headers.authorization);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });

      const { data: attachment, error } = await supabase
        .from('goal_attachments')
        .select('id, file_path')
        .eq('id', request.params.attachmentId)
        .eq('goal_id', request.params.goalId)
        .eq('project_id', request.params.projectId)
        .maybeSingle();

      if (error) return reply.status(500).send({ error: error.message });
      if (!attachment?.file_path) return reply.status(404).send({ error: 'Attachment not found.' });

      const { data: signed, error: signError } = await supabase.storage
        .from(GOAL_ATTACHMENT_BUCKET)
        .createSignedUrl(attachment.file_path, ATTACHMENT_SIGN_TTL_SECONDS);

      if (signError || !signed?.signedUrl) {
        return reply.status(500).send({ error: signError?.message ?? 'Unable to create attachment URL.' });
      }

      return reply.send({ url: signed.signedUrl });
    },
  );

  server.delete<{ Params: { projectId: string; goalId: string; attachmentId: string } }>(
    '/projects/:projectId/goals/:goalId/attachments/:attachmentId',
    async (request, reply) => {
      const access = await requireProjectAccessFromAuthHeader(request.params.projectId, request.headers.authorization);
      if (!access.ok) return reply.status(access.status).send({ error: access.error });

      const { data: attachment, error } = await supabase
        .from('goal_attachments')
        .select('id, file_path, author_id')
        .eq('id', request.params.attachmentId)
        .eq('goal_id', request.params.goalId)
        .eq('project_id', request.params.projectId)
        .maybeSingle();

      if (error) return reply.status(500).send({ error: error.message });
      if (!attachment) return reply.status(404).send({ error: 'Attachment not found.' });
      if (!access.isOwner && attachment.author_id !== access.userId) {
        return reply.status(403).send({ error: 'Only the attachment author or a project owner can delete this file.' });
      }

      if (attachment.file_path) {
        await supabase.storage.from(GOAL_ATTACHMENT_BUCKET).remove([attachment.file_path]);
      }

      const { error: deleteError } = await supabase.from('goal_attachments').delete().eq('id', attachment.id);
      if (deleteError) return reply.status(500).send({ error: deleteError.message });

      return reply.send({ ok: true });
    },
  );
}
