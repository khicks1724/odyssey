import type { FastifyInstance } from 'fastify';
import { getUserFromAuthHeader } from '../lib/request-auth.js';
import {
  getCoordinationBundleForViewer,
  getProjectAccess,
  materializeCoordinationSnapshotForViewer,
  recomputeProjectCoordination,
  resolveAcceptedSuggestion,
} from '../lib/coordination.js';
import { supabase } from '../lib/supabase.js';

export async function coordinationRoutes(server: FastifyInstance) {
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/coordination', async (request, reply) => {
    const userId = await getUserFromAuthHeader(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const access = await getProjectAccess(request.params.projectId, userId);
    if (!access.allowed) return reply.status(403).send({ error: 'Forbidden' });

    try {
      const bundle = await getCoordinationBundleForViewer(
        request.params.projectId,
        userId,
        access.isOwner ? 'owner' : 'member',
      );
      return reply.send(bundle);
    } catch (error: any) {
      request.log.error({ err: error, projectId: request.params.projectId }, 'Failed to load coordination snapshot');
      return reply.status(500).send({ error: error?.message ?? 'Failed to load coordination data' });
    }
  });

  server.post<{ Params: { projectId: string } }>('/projects/:projectId/coordination/recompute', async (request, reply) => {
    const userId = await getUserFromAuthHeader(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const access = await getProjectAccess(request.params.projectId, userId);
    if (!access.allowed) return reply.status(403).send({ error: 'Forbidden' });

    try {
      const { stored, graph } = await recomputeProjectCoordination(request.params.projectId, userId);
      const snapshot = materializeCoordinationSnapshotForViewer(
        request.params.projectId,
        stored,
        userId,
        access.isOwner ? 'owner' : 'member',
      );
      return reply.send({ snapshot, graph });
    } catch (error: any) {
      request.log.error({ err: error, projectId: request.params.projectId }, 'Failed to recompute coordination snapshot');
      return reply.status(500).send({ error: error?.message ?? 'Failed to recompute coordination data' });
    }
  });

  server.post<{ Params: { projectId: string }; Body: { taskId?: string; ownerId?: string } }>(
    '/projects/:projectId/coordination/accept-owner-suggestion',
    async (request, reply) => {
      const userId = await getUserFromAuthHeader(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const access = await getProjectAccess(request.params.projectId, userId);
      if (!access.allowed) return reply.status(403).send({ error: 'Forbidden' });
      if (!access.isOwner) return reply.status(403).send({ error: 'Only project owners can accept owner suggestions.' });

      const taskId = request.body?.taskId?.trim();
      if (!taskId) return reply.status(400).send({ error: 'taskId is required.' });

      try {
        let recomputed = await recomputeProjectCoordination(request.params.projectId, userId);
        let stored = recomputed.stored;
        const suggestion = stored.snapshot ? resolveAcceptedSuggestion(stored.snapshot, taskId) : null;

        if (!suggestion) {
          return reply.status(404).send({ error: 'No owner suggestion was found for that task.' });
        }
        if (!suggestion.recommendedOwnerId) {
          return reply.status(409).send({ error: 'That task does not have a confident owner recommendation yet.' });
        }
        if (request.body?.ownerId && request.body.ownerId !== suggestion.recommendedOwnerId) {
          return reply.status(409).send({ error: 'The suggested owner changed. Refresh the coordination view and try again.' });
        }

        const { data: goal, error: goalError } = await supabase
          .from('goals')
          .select('id, title, assigned_to, assignees')
          .eq('project_id', request.params.projectId)
          .eq('id', taskId)
          .single();

        if (goalError || !goal) {
          return reply.status(404).send({ error: 'Task not found.' });
        }

        const nextOwnerId = suggestion.recommendedOwnerId;
        const { error: updateError } = await supabase
          .from('goals')
          .update({
            assigned_to: nextOwnerId,
            assignees: [nextOwnerId],
            updated_by: userId,
          })
          .eq('project_id', request.params.projectId)
          .eq('id', taskId);

        if (updateError) {
          request.log.error({ err: updateError, taskId, projectId: request.params.projectId }, 'Failed to accept coordination owner suggestion');
          return reply.status(500).send({ error: updateError.message });
        }

        const summary = suggestion.recommendedOwnerName
          ? `${suggestion.recommendedOwnerName} was assigned as the owner via Coordination.`
          : 'A Coordination owner suggestion was accepted.';

        const { error: eventError } = await supabase.from('events').insert({
          project_id: request.params.projectId,
          actor_id: userId,
          source: 'ai',
          event_type: 'coordination_owner_suggestion_accepted',
          title: `Coordination accepted owner suggestion for "${goal.title}"`,
          summary,
          metadata: {
            goal_id: taskId,
            previous_owner_id: goal.assigned_to,
            previous_assignees: Array.isArray(goal.assignees) ? goal.assignees : [],
            accepted_owner_id: nextOwnerId,
            confidence: suggestion.confidence,
            suggested_collaborator_ids: suggestion.suggestedCollaboratorIds,
          },
          occurred_at: new Date().toISOString(),
        });

        if (eventError) {
          request.log.error({ err: eventError, taskId, projectId: request.params.projectId }, 'Failed to log coordination acceptance event');
        }

        recomputed = await recomputeProjectCoordination(request.params.projectId, userId);
        stored = recomputed.stored;
        const snapshot = materializeCoordinationSnapshotForViewer(request.params.projectId, stored, userId, 'owner');

        return reply.send({
          ok: true,
          taskId,
          ownerId: nextOwnerId,
          snapshot,
          graph: recomputed.graph,
        });
      } catch (error: any) {
        request.log.error({ err: error, taskId, projectId: request.params.projectId }, 'Failed to accept coordination owner suggestion');
        return reply.status(500).send({ error: error?.message ?? 'Failed to accept owner suggestion' });
      }
    },
  );
}
