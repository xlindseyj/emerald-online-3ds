# Phase 4: First quest chain & world resource nodes

Scope: items 2 and 3 from the user's Phase 4 request.

## Goals

- Extend the existing "Welcome to Hoenn Online" quest into a short chain.
- Add server-authoritative resource nodes (tree, rock, water) that players can interact with.
- Resource interactions grant quest progress and, later, skill XP.
- Keep the 3DS client changes minimal and match existing page/interaction patterns.

## Design

### Quest chain

1. **Welcome to Hoenn Online** (existing)
   - NPC: Scientist on map `0-9`, tile `14,13`, facing south.
   - Reward: `Beta Pioneer` title.
   - Leads to: Field Research.

2. **Field Research** (new)
   - Objective: interact with one resource node.
   - Reward: `Beta Pioneer II` title.
   - Leads to: Report Findings.

3. **Report Findings** (new)
   - Objective: talk to the scientist again.
   - Reward: `Research Assistant` title.

### Resource nodes

- Table `resource_nodes`:
  - `slug`, `kind` (`tree`, `rock`, `water`), `map`, `x`, `y`, `level` (skill req), `respawn_seconds`, `active`, `last_harvested_at`.
- Table `player_skills` (minimal, for future expansion):
  - `identity_id`, `skill`, `xp`, `level`.
- Protocol:
  - Client sends `resource_interact { node_id }`.
  - Server validates distance, availability, and quest/skill requirements.
  - Server responds `resource_interact_result { ok, node_id, kind, xp_gained, quest_progress }`.
  - `npc_snapshot` is extended to include nearby resource nodes.

### 3DS client

- Add a `PAGE_QUEST` (already exists) update to show multi-step objectives.
- Render resource nodes on the bottom-screen map/radar page.
- Allow interacting with a nearby resource node from the map/radar page or via a context prompt.

## Tasks

### Server
- [ ] Migration `013_resource_nodes_and_skills.sql`
- [ ] `server/src/resource-node-store.mjs` (Postgres + Memory)
- [ ] `server/src/skill-store.mjs` (Postgres + Memory)
- [ ] Extend `server/src/protocol.mjs` with `resource_interact` validator
- [ ] Extend `server/src/server.mjs` with `resource_interact` handler and include nodes in `npc_snapshot`
- [ ] Extend `server/src/quest-store.mjs` with new requirement kinds: `interact_resource`, `quest_completed`
- [ ] Seed the Field Research and Report Findings quests plus resource nodes
- [ ] Tests for resource nodes, skill XP, and quest chain

### 3DS client
- [ ] Extend protocol parsing for `resource_interact_result`
- [ ] Add resource node rendering to bottom-screen map/radar
- [ ] Add resource node interaction handling
- [ ] Update quest log page for multi-step display
- [ ] Rebuild runtime and update release artifacts

### Docs / ops
- [ ] Update `ROADMAP.md`
- [ ] Update `GATE_4_HANDOFF.md` / `GATE_4_PHYSICAL_TEST.md` if needed
- [ ] Run `npm test`
- [ ] Build, push server image, redeploy

## Acceptance criteria

- A trainer can talk to the scientist, accept the first quest, and receive `Beta Pioneer`.
- The trainer can see a resource node near the scientist on the bottom-screen map.
- Interacting with the node completes the Field Research objective.
- Returning to the scientist completes the chain and grants `Research Assistant`.
- All existing tests still pass.
