-- The original welcome quest had no objective, so accepting it immediately
-- completed and claimed it. Require a deliberate follow-up conversation with
-- the Littleroot scientist instead. Existing completed/claimed progress is
-- preserved; this changes the quest definition only.
UPDATE quests
SET requirements = '[{"kind":"talk_to_npc","npc_id":"scientist-welcome","label":"Talk to the Littleroot scientist"}]'::jsonb,
    updated_at = now()
WHERE slug = 'welcome-to-hoenn-online'
  AND requirements = '[]'::jsonb;
