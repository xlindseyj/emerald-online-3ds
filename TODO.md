# Phase 4: First quest chain & world resource nodes

Goal: extend the existing scientist quest into a short chain and add server-authoritative resource nodes that grant quest progress (and later skill XP).

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
