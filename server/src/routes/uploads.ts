import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';

// Text-readable MIME types / extensions
const TEXT_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/xml',
  'application/json', 'application/xml', 'application/csv',
]);
const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.log', '.yaml', '.yml', '.ts', '.js', '.py', '.rs', '.go', '.java', '.cpp', '.c', '.h']);

function isTextFile(name: string, mimeType: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return TEXT_TYPES.has(mimeType) || mimeType.startsWith('text/') || TEXT_EXTS.has(ext);
}

interface LocalUploadBody {
  projectId: string;
  filename: string;
  mimeType: string;
  size: number;
  content?: string; // plain text, sent from client FileReader
}

export async function uploadRoutes(server: FastifyInstance) {
  server.post<{ Body: LocalUploadBody }>('/uploads/local', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return reply.status(401).send({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, filename, mimeType, size, content } = request.body;
    if (!projectId || !filename) return reply.status(400).send({ error: 'projectId and filename are required' });

    // Membership check
    const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    const { data: membership } = await supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', user.id).single();
    if (proj?.owner_id !== user.id && !membership) return reply.status(403).send({ error: 'Not a member of this project' });

    const canReadText = isTextFile(filename, mimeType);
    const preview = content ? content.slice(0, 2000) : null;
    const summary = content ? content.slice(0, 500) : `Local file: ${filename} (${(size / 1024).toFixed(1)} KB)`;

    const { data, error: dbErr } = await supabase.from('events').insert({
      project_id: projectId,
      actor_id: user.id,
      source: 'local',
      event_type: 'file_upload',
      title: filename,
      summary,
      metadata: {
        filename,
        mime_type: mimeType,
        size_bytes: size,
        content_preview: preview,
        readable: canReadText,
      },
      occurred_at: new Date().toISOString(),
    }).select().single();

    if (dbErr) return reply.status(500).send({ error: dbErr.message });
    return { event: data };
  });
}
