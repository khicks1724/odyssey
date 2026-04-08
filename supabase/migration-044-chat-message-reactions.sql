-- Allow thread members to update the metadata column of any message in their thread
-- (used for emoji reactions stored as metadata.reactions: { [emoji]: userId[] })
CREATE POLICY chat_messages_update_reactions
  ON public.chat_messages
  FOR UPDATE
  USING (is_chat_thread_member(thread_id, auth.uid()))
  WITH CHECK (is_chat_thread_member(thread_id, auth.uid()));
