import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { supabase } from '../lib/supabase.js';
import { randomUUID } from 'crypto';
// Import from lib directly to avoid pdf-parse's test-file side-effect on module load
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

const BUCKET = 'project-documents';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.log', '.yaml', '.yml']);
const MAX_EXTRACTED_CHARS = 50_000; // ~12k tokens

function isTextFile(name: string, mimeType: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return mimeType.startsWith('text/') || TEXT_EXTS.has(ext);
}

async function extractText(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const lower = filename.toLowerCase();

  // PDF
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    try {
      const data = await pdfParse(buffer);
      return data.text?.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // DOCX
  if (mimeType.includes('wordprocessingml') || lower.endsWith('.docx')) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
    } catch {
      return null;
    }
  }

  // Plain text formats
  if (isTextFile(filename, mimeType)) {
    return buffer.toString('utf8').slice(0, MAX_EXTRACTED_CHARS);
  }

  return null;
}

export async function uploadRoutes(server: FastifyInstance) {
  await server.register(multipart, {
    limits: { fileSize: 52_428_800 }, // 50 MB
  });

  // ── Upload a file (PDF, DOCX, TXT, etc.) ──────────────────────────────────
  server.post('/uploads/local', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const parts = request.parts();
    let projectId = '';
    let filename = '';
    let mimeType = '';
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'projectId') projectId = part.value as string;
        if (part.fieldname === 'filename') filename = part.value as string;
      } else if (part.type === 'file') {
        filename = filename || part.filename;
        mimeType = part.mimetype;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!projectId || !filename || !fileBuffer) {
      return reply.status(400).send({ error: 'projectId, filename, and file are required' });
    }

    // Membership check
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Not a member of this project' });
    }

    // Validate MIME type (be lenient — browsers sometimes report wrong types)
    const inferredMime = mimeType || 'application/octet-stream';

    // Upload to Supabase Storage: project-documents/{projectId}/{uuid}-{filename}
    const storagePath = `${projectId}/${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: storageErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: inferredMime, upsert: false });

    if (storageErr) {
      return reply.status(500).send({ error: `Storage upload failed: ${storageErr.message}` });
    }

    // Extract text from PDF, DOCX, and plain-text formats for AI context
    const extractedText = await extractText(fileBuffer, filename, inferredMime);
    const contentPreview = extractedText?.slice(0, 2000) ?? null;

    const sizeKb = (fileBuffer.byteLength / 1024).toFixed(1);
    const summary = `${filename} (${sizeKb} KB) — uploaded to project storage`;

    const { data, error: dbErr } = await supabase.from('events').insert({
      project_id: projectId,
      actor_id: user.id,
      source: 'local',
      event_type: 'file_upload',
      title: filename,
      summary,
      metadata: {
        filename,
        mime_type: inferredMime,
        size_bytes: fileBuffer.byteLength,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        extracted_text: extractedText,  // full text for AI context (up to 50k chars)
        content_preview: contentPreview, // short preview for UI display
        readable: extractedText !== null,
      },
      occurred_at: new Date().toISOString(),
    }).select().single();

    if (dbErr) {
      // Clean up storage if DB insert fails
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return reply.status(500).send({ error: dbErr.message });
    }

    return { event: data };
  });

  // ── Generate a signed download URL ─────────────────────────────────────────
  server.post<{ Body: { storagePath: string } }>('/uploads/sign', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { storagePath } = request.body;
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });

    // Verify membership: project ID is the first path segment
    const projectId = storagePath.split('/')[0];
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600); // 1-hour expiry

    if (error || !data) return reply.status(500).send({ error: error?.message ?? 'Could not sign URL' });
    return { url: data.signedUrl };
  });

  // ── Delete a file from storage (called when event is deleted) ──────────────
  server.delete<{ Body: { storagePath: string } }>('/uploads/file', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { storagePath } = request.body;
    if (!storagePath) return reply.status(400).send({ error: 'storagePath required' });

    const projectId = storagePath.split('/')[0];
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error) return reply.status(500).send({ error: error.message });
    return { ok: true };
  });
}
