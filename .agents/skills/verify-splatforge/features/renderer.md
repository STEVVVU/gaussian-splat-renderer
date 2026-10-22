# Renderer

## User path and maintained driver

Open the loopback Vite viewer through CUA. Load synthetic scene, switch Gaussian/pointcloud, adjust scale and orbit; run GPU diagnostics for the seven real pipeline checks. Browser actions stay CUA-only.

Benchmark prepares owned procedural rooms at 16,384, 131,072 and 524,288 Gaussians, each at 640x360 and 1280x720, fixed camera, seed 565, SH degree zero and scale one. It compares production GPU projection/radix/float accumulation/presentation with the same rendering plus GPU readback/native stable typed-array CPU sort/upload. Ten warm frames per side precede seven alternating twenty-frame repetitions per side. Export benchmark saves and visibly displays the complete JSON, including failures.

## Acceptance evidence

Two complete CUA campaigns passed all six cases each on Intel Xe-LPG / Chrome155 / Windows. Every cell retained 140 samples per side; full-image error was at most one code under the unchanged three-code gate, and independent CPU composition stayed below 0.012 including the final check. The original small fixture passed all seven diagnostics through the new float accumulation/presentation path. See [results](../../../../docs/benchmark-results-20261022.md) and maintained raw evidence under docs/evidence/metrics-20261022/. Earlier failed campaigns and the controlled float replay remain outside Git in the central metrics30 evidence store.

The attachment replay retains exact projected values, keys and draw indices, avoiding nondeterministic compaction/tie order between captures. Float accumulation and single presentation conversion fixed the reproduced quantization failures. The radix barrier guard includes missing-barrier negative controls; static checks alone do not establish WGSL execution.

## Limits and cleanup

Browser UserTiming bounds queue-complete production work; optional native timestamps include projection, interpass sort work, accumulation and presentation. The recorded draw stage includes presentation. CPU-arm GPU time is unreported. Logical GPU allocation includes the eight-byte-per-pixel float attachment and is not physical VRAM. Empirical frame percentiles are not confidence bounds or display-refresh FPS. No vendor-renderer, 650K/1080p/72-FPS, photorealistic-scene or portability claim is accepted. Inherited cross-workgroup lookback still requires forward progress.

Benchmark replaces the loaded scene, then restores display dimensions and scale. Requires an exclusive GPU slot and a still camera. Main closed only owned CUA tabs and stopped Vite; retained JSON/AX/screenshots survived cleanup. The final narrow-screen layout remains unverified.
