# Gaussian splat renderer project instructions

Commands: `npm ci`; `npm run check` (local Node25.8.1 native TypeScript fixture/parser checks); `npm run build` (tsc and Vite); `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186 --strictPort` (owned loopback server). Use the project `.agents/skills/verify-splatforge/SKILL.md` for actual UI/GPU verification. CPU checks/build do not validate WGSL execution.

Architecture: src/utils loads validated binary Gaussian PLY into packed half storage. src/shaders/preprocess.wgsl projects covariance and SH into splats; src/sort provides inherited GPU radix sorting; gaussian-renderer.ts records preprocess, sort and indirect alpha quad draw. renderer.ts owns shared camera/UI and scene replacement. Synthetic fixture source is src/utils/synthetic.ts, checked-in binary is public/fixtures/synthetic.ply.

Preserve official MIT license, README.upstream.md and author/source credits. Document original mechanisms and actual verification in IMPLEMENTATION.md. Keep generated evidence outside maintained tooling and untracked (/.evidence/ is ignored). Preserve user's publication gates: no origin, push, PR or deployment without instruction. Coordinate GPU use with the main task, and use CUA for browser interaction; subagents cannot create visible IAB tabs or bind main-thread IAB tabs on this host.
