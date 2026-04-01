import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { supabase } from '../lib/supabase.js';
import { randomUUID } from 'crypto';
// Import from lib directly to avoid pdf-parse's test-file side-effect on module load
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import JSZip from 'jszip';

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

  // PPTX — extract all slide text via JSZip + XML tag stripping
  if (mimeType.includes('presentationml') || lower.endsWith('.pptx')) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)?.[0] ?? '0');
          const numB = parseInt(b.match(/\d+/)?.[0] ?? '0');
          return numA - numB;
        });
      const parts: string[] = [];
      for (const slideFile of slideFiles) {
        const xml = await zip.files[slideFile].async('string');
        // Extract text runs (<a:t>...</a:t>) and join with spaces
        const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
        if (runs.length) parts.push(runs.join(' '));
      }
      return parts.join('\n').slice(0, MAX_EXTRACTED_CHARS) || null;
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

  // ── List report templates for a project ───────────────────────────────────
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/report-templates', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId } = request.params;
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase
      .from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('events')
      .select('id, title, occurred_at, metadata')
      .eq('project_id', projectId)
      .eq('event_type', 'report_template')
      .order('occurred_at', { ascending: false });

    if (error) return reply.status(500).send({ error: error.message });

    const templates = (data ?? []).map((e) => {
      const meta = e.metadata as { template_type?: string; filename?: string; size_bytes?: number; storage_path?: string };
      return {
        id: e.id,
        templateType: meta.template_type ?? 'docx',
        filename: meta.filename ?? e.title,
        sizeBytes: meta.size_bytes ?? 0,
        storagePath: meta.storage_path ?? '',
        uploadedAt: e.occurred_at,
      };
    });

    return { templates };
  });

  // ── Upload a report template ───────────────────────────────────────────────
  server.post('/uploads/report-template', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const parts = request.parts();
    let projectId = '';
    let templateType = '';   // 'docx' | 'pptx' | 'pdf'
    let filename = '';
    let mimeType = '';
    let fileBuffer: Buffer | null = null;

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'projectId') projectId = part.value as string;
        if (part.fieldname === 'templateType') templateType = part.value as string;
        if (part.fieldname === 'filename') filename = part.value as string;
      } else if (part.type === 'file') {
        filename = filename || part.filename;
        mimeType = part.mimetype;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!projectId || !templateType || !filename || !fileBuffer) {
      return reply.status(400).send({ error: 'projectId, templateType, filename, and file are required' });
    }
    if (!['docx', 'pptx', 'pdf'].includes(templateType)) {
      return reply.status(400).send({ error: 'templateType must be docx, pptx, or pdf' });
    }

    // Owner-only
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    if (proj?.owner_id !== user.id) return reply.status(403).send({ error: 'Only project owners can manage templates' });

    // Delete existing template of this type (one per type per project)
    const { data: existing } = await supabase
      .from('events')
      .select('id, metadata')
      .eq('project_id', projectId)
      .eq('event_type', 'report_template')
      .filter('metadata->>template_type', 'eq', templateType);

    for (const old of existing ?? []) {
      const oldMeta = old.metadata as { storage_path?: string };
      if (oldMeta.storage_path) {
        await supabase.storage.from(BUCKET).remove([oldMeta.storage_path]);
      }
      await supabase.from('events').delete().eq('id', old.id);
    }

    // Upload to storage
    const storagePath = `${projectId}/templates/${templateType}-${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const inferredMime = mimeType || 'application/octet-stream';
    const { error: storageErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: inferredMime, upsert: false });

    if (storageErr) return reply.status(500).send({ error: `Storage upload failed: ${storageErr.message}` });

    // Extract text from the template file
    const extractedText = await extractText(fileBuffer, filename, inferredMime);

    const { data, error: dbErr } = await supabase.from('events').insert({
      project_id: projectId,
      actor_id: user.id,
      source: 'local',
      event_type: 'report_template',
      title: filename,
      summary: `Report template for ${templateType.toUpperCase()} reports`,
      metadata: {
        template_type: templateType,
        filename,
        mime_type: inferredMime,
        size_bytes: fileBuffer.byteLength,
        storage_path: storagePath,
        storage_bucket: BUCKET,
        extracted_text: extractedText,
        readable: extractedText !== null,
      },
      occurred_at: new Date().toISOString(),
    }).select().single();

    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return reply.status(500).send({ error: dbErr.message });
    }

    const meta = data.metadata as { template_type?: string; filename?: string; size_bytes?: number; storage_path?: string };
    return {
      template: {
        id: data.id,
        templateType: meta.template_type ?? templateType,
        filename: meta.filename ?? filename,
        sizeBytes: meta.size_bytes ?? 0,
        storagePath: meta.storage_path ?? storagePath,
        uploadedAt: data.occurred_at,
      },
    };
  });

  // ── Delete a report template ───────────────────────────────────────────────
  server.delete<{ Body: { projectId: string; eventId: string } }>('/uploads/report-template', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, eventId } = request.body;
    if (!projectId || !eventId) return reply.status(400).send({ error: 'projectId and eventId are required' });

    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    if (proj?.owner_id !== user.id) return reply.status(403).send({ error: 'Only project owners can manage templates' });

    const { data: evt } = await supabase
      .from('events').select('metadata').eq('id', eventId).eq('project_id', projectId).single();

    if (!evt) return reply.status(404).send({ error: 'Template not found' });

    const meta = evt.metadata as { storage_path?: string };
    if (meta.storage_path) {
      await supabase.storage.from(BUCKET).remove([meta.storage_path]);
    }
    await supabase.from('events').delete().eq('id', eventId);

    return { ok: true };
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
