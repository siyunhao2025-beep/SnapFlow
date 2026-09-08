# JieGe Website Design Spec

## Visual direction

- Tone: serious desktop research tool, led by real product UI instead of mascots or decorative AI illustrations.
- Base: off-black navy `#05080D`, with layered `#0A1018` and `#101824` surfaces.
- Accent: one restrained research blue, `#4B8DFF`; `#79AAFF` is limited to secondary text and focus detail.
- Texture: low-opacity technical grid, sparse light points, subtle grain, and cool ambient light. Avoid saturated purple gradients.
- Geometry: 8–14 px radii, 1 px cool-gray borders, asymmetric layouts, and generous negative space.

## Typography and interaction

- Type: SF Pro/HarmonyOS Sans/PingFang SC system stack; Cascadia Mono for labels, versions, and metrics.
- Headlines: compact line height and negative tracking; body copy remains below roughly 65 characters per line.
- Touch target: at least 44 px for primary actions; keyboard focus must remain visible.
- Breakpoints: 560 px, 900 px, and 1080 px.
- Motion: transform and opacity only; all non-essential motion is disabled under `prefers-reduced-motion`.
- Theme: dark by default; the user's light/dark choice remains stored in localStorage.

## Product imagery

- Use genuine JieGe screenshots with accurate captions and descriptive alt text.
- Publish screenshots as optimized WebP to keep the landing page lightweight while preserving interface text.
- Do not invent performance, adoption, or accuracy claims around screenshots.
