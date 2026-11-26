# AI Design Assistant

Open **Project menu → AI Design Assistant** and describe the floor and changes you want. In **Live AI agent** mode, try “Redesign the top floor with three bedrooms and two en suites” or “Add a window to the south wall of the study.” Choose a proposal to see the changes in the 2D plan. You can request revisions, or use **Apply layout** and undo the entire edit in one step.

For an existing enclosed floor, the live agent can edit internal partitions and add internal doors, windows, front doors or bifold patio doors. An upstairs bedroom schedule supports up to four bedrooms, two en suites and an optional shared bathroom. Each bedroom has independent access from the landing and each en suite has private access from its own bedroom. Room redesigns preserve exterior wall lines, existing exterior entrances and stairs. Structural checks, headroom, bathroom fixtures, drainage, fire safety and regulatory checks require independent verification.

In **Live AI agent** mode, ask to extend a front, rear or side façade, or ask for a wraparound along two adjoining façades. For example, ask “Extend the house 4 m to the rear and 2 m to the right over two storeys.” The addition runs along the full straight wall on each chosen side. The new upper walls can meet the outside lines of the lower extension from an original upper floor that is set back, provided the new slab stays within the footprint below. If the front door does not establish the orientation, name the walls in plan view or select them in the editor. Switch floors in the 2D view to review the walls, slabs and access. **Apply extension** commits the whole preview in one undoable edit. Roof joining and room layouts inside the new footprint are separate edits.

A measured request such as “Extend the north side by 4 m and the east side by 2.5 m” can preview the footprint directly in the editor. North is the top of the 2D plan. The footprint uses one storey unless the request specifies two. In **Live AI agent** mode, a brief for an extension and rooms on both floors continues automatically from the proposed footprint into the room and stair layout. **Apply design** commits the complete proposal in one edit. For an earlier footprint that was already applied, **Design both floors and stairs** can pick up the original brief from the open assistant conversation.

If you already applied a single-storey assistant extension, ask “Make the existing extension two storeys.” The preview adds the upper storey over the existing addition. If the project has several assistant extensions, select a wall on the one you want to build above.

The local upstairs planner works within one enclosed area on an upper level with one existing stair, retaining existing walls, windows and stairs. It handles rectangular and some simple polygonal outlines.

In **Live AI agent** mode, ask for a staircase between two adjacent levels, optionally near a named room. The editor tests straight, L-shaped and U-shaped stairs against both floors, and **Apply staircase** installs the preview. Switch to the upper floor to inspect the opening before applying.

For a brief covering both floors, the assistant drafts the rooms and fits the staircase between the proposed hall and landing. Use the 2D floor selector to review both layouts and the opening above the stair. **Apply layout** commits both floors, the staircase and its opening in one undoable edit.

## Architecture

The editor stores walls, wall-mounted doors and windows, stair models and room metadata in `FloorLevel`. The slab and stair opening helpers derive the footprint and aperture from that data. Wall topology supplies the room polygons and signatures used by both the assistant and the editor. Older projects without room functions retain their existing room labels until relabelled.

The local planner reads its snapshot in a Web Worker. Agent modes run the conversation and geometry in the workspace server and an isolated worker thread. The tool workspace accepts centre-line partitions and doors, derives room boundaries with native wall topology and can measure a turning route from the stair. It can also use the deterministic planner to find starting layouts. A design must pass the native wall, door and room checks before it can be published to the panel.

The 2D canvas fades the existing plan and draws the validated draft above it. Retained walls and openings are visible, and new or moved walls are blue. Red dashes mark removals and teal marks new windows. **Fit draft** brings the proposal back into view. Apply checks the project revision and revalidates against the editor snapshot, then commits native wall and opening edits and room metadata in one history transaction. The normal project saver handles those objects and the normal 3D view renders them.

## Choose an assistant mode

- **Local planner** recognises the supported layout requests and common follow-ups in the browser. It works with `npm run dev`.
- **Local agent demo** exercises the architectural tools through the local workspace server with a deterministic provider. Run `npm run dev:all` and select it in the assistant panel.
- **Live AI agent** lets the configured model choose the tools and draft edits. Set `OPENAI_API_KEY` and `HOUSE_DESIGNER_OPENAI_MODEL` in the workspace server’s environment, then run `npm run dev:all`. Select **Live AI agent** in the panel. Choose a model that supports Responses API function calling and Structured Outputs. [OpenAI function calling documentation](https://developers.openai.com/api/docs/guides/function-calling)

The live model sees the prompt, recent conversation, a level summary and the structured results of the tools it requests. The local workspace service holds the API key. The architecture payload contains editable geometry, dimensions, room labels and selected IDs. Images, meshes and textures stay in the editor. The panel’s **Developer diagnostics** shows tool calls, validated arguments, tool results, timing and reported token counts.

For an open-ended redesign request, the live agent uses the level summary to suggest where to start and asks what the user wants to improve. A request for a single floor edits that floor. A combined brief supplies both adjacent floor layouts and fits the staircase against the resulting geometry. Window additions can be batched. The model receives short references for geometry IDs, while the editor and diagnostics use the original IDs. Draft edits return the changed elements. The full floor remains available on inspection.

A short bedroom and en suite brief can use the existing-room planner. When there is an eligible upper floor and the editor validates an arrangement from existing rooms and doorway edits, the assistant can show the preview without calling OpenAI. Requests with additional design instructions go through the live model.

For a live request such as “No windows allowed on the left side,” the editor checks that the proposed floor has no windows on the left-facing exterior walls in plan view. If the floor has no modeled stair arrival, the draft can reserve a landing and flags the stair position for review.

An applied redesign stores its window exclusion on the floor. A follow-up works from the installed plan and can combine opening closures, wall moves, removals and new partitions in one validated edit.

Default limits allow 20 calls, three corrections after an initial evaluation per draft, 85 seconds, 75,000 input tokens and 7,000 output tokens per request. An individual OpenAI reply has a 45-second limit within that request. Workspace server overrides include `HOUSE_DESIGNER_AGENT_TOOL_CALLS`, `HOUSE_DESIGNER_AGENT_CORRECTIONS`, `HOUSE_DESIGNER_AGENT_TIMEOUT_MS`, `HOUSE_DESIGNER_AGENT_TURN_TIMEOUT_MS`, `HOUSE_DESIGNER_AGENT_INPUT_TOKENS`, `HOUSE_DESIGNER_AGENT_OUTPUT_TOKENS` and `HOUSE_DESIGNER_AGENT_ARGUMENT_BYTES`. Use **Cancel** to stop a pending request. After a timeout or interrupted connection, **Retry request** uses the same brief and conversation context. Only published and validated options can reach the preview, including when a time or tool limit is reached.

The token budget restarts on each Send. Diagnostics show the total for the current request. Model calls within that request can include the same prompt, history and floor-tool results, and each call counts its input again.

## Phase 2 verification

The existing-floor test in `tests/assistantAgent.test.ts` covers a saved Springfield floor. The agent tools detect an en suite still connected to the landing, close that doorway, add a private door from the bedroom, and publish the validated preview. The test replays the proposal through the editor validator and checks a follow-up revision. A second test moves and removes existing partitions and adds a window on a ground floor.

The direct-layout test in `tests/assistantAgent.test.ts` used a scripted provider and the real architectural tools. It ran this sequence and produced two validated alternatives with four native partitions and four doors in each.

```text
get_project_overview → get_floor_layout → get_constraints → begin_design
→ create_partition_wall → set_room_function → set_room_name
→ insert_internal_door [door_clearance] → evaluate_layout [missing entrances]
→ insert_internal_door → evaluate_layout → publish_design
→ begin_design → move_partition_wall → evaluate_layout → publish_design
```

The bathroom follow-up ran `begin_design → move_partition_wall → evaluate_layout → publish_design`. The bathroom grew while its existing draft door placements were preserved. The test materialized the edits through the native editor validator and checked that a newer revision rejected the old proposal.

The Responses transport test used simulated API responses. It verified that a function requested by the provider executed against the real floor and returned structured geometry linked to its call ID. A live account trace requires configured credentials. Use the diagnostic view to inspect that trace when running in live mode.

The Chrome test exercised the streamed local demo, checked that preview left the floor data untouched, applied a proposal, undid it in one step and cancelled another request. On `springfield_15_narrower.json` it observed 37 frame callbacks over 600 ms while the camera moved and the agent ran four tools. It recorded zero WebGL shader compilations, shader warmup events or GI preparation during that sample. This is a short headless regression sample for one saved house.
