# Review Request

## Question
Review the FRONTEND code of `pko-tools` and propose the best baseline architecture for an extremely fast, interactive PKO asset viewer/workbench (great UX + high rendering performance + fast action workflows like Cmd+K).

## Context
### Repository Focus
- App shell and routing: `src/App.tsx`
- Navigators: `src/features/*/*Navigator.tsx`
- Workbenches/viewers: `src/features/{character,item,effect,map,buildings}/*`
- State: `src/store/*.ts`

### Performance-Critical Observations to validate/challenge
- Character navigator registers Tauri event listener on each selection without unsubscribe.
- Effect playback updates Jotai state each frame (`currentTime`) and many components subscribe to same atom.
- Effect renderer creates temporary `THREE.CylinderGeometry` objects inside `useFrame` during interpolation.
- Effect viewport uses `gl={{ preserveDrawingBuffer: true }}` continuously.
- GLTF JSON is repeatedly transformed to Data URI with FileReader in several viewers.
- Map object markers are rendered as one mesh per object marker (no instancing).

### Desired Outcome
- Prioritized findings (bugs, performance risks, UX risks)
- Concrete base architecture for:
  - command palette / action system
  - fast state transitions and undo/redo
  - asset loading/cache strategy
  - 3D render loop architecture
  - observability/profiling baseline

## Instructions
Provide an independent critical review.
- Identify risks, regressions, and blind spots
- Explain tradeoffs and alternatives
- Be specific and opinionated
- Structure with: Critical Risks, High-Impact Improvements, UX Architecture, and 30/60/90 plan
