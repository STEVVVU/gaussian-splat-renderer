# Browser GPU benchmark results

Two complete CUA-driven campaigns passed six owned procedural workloads each on the browser's **Intel Xe-LPG** adapter, Chrome 155 on Windows. This is the adapter reported by WebGPU; the separate CUDA device is not the measured renderer. The [raw campaigns and source hashes](evidence/metrics-20261022/summary.json) retain all samples. Each campaign completed 1,680 timed frames: 140 per arm per workload, after ten warm frames per arm. Seven alternating repetitions contain twenty frames each. No failed timed frames were omitted.

The GPU arm uses production projection, radix sorting, floating-point accumulation and final presentation. The control uses the same projection and rendering, with GPU readback, native stable typed-array CPU sorting and upload. Its wall time includes that roundtrip. Queue completion bounds both arms; this is not a comparison against another renderer. Model/scene allocation, compilation, warmup and quality readback are outside the timed region. Browser UserTiming measures wall time; optional WebGPU timestamps span projection through presentation. The recorded `drawMs` stage includes accumulation and presentation. CPU-arm GPU time is unavailable.

Each table cell gives the two retained campaigns separately. Values are empirical percentiles over each campaign's 140 individual frames, not confidence intervals or display-refresh FPS.

| Gaussians | Viewport | GPU-path wall p50, ms | GPU-path wall p95, ms | CPU-sort roundtrip wall p50, ms |
| ---: | --- | --- | --- | --- |
| 16,384 | 640x360 | 5.90 / 5.90 | 6.90 / 6.90 | 6.00 / 6.00 |
| 16,384 | 1280x720 | 6.90 / 6.90 | 8.90 / 9.10 | 8.00 / 8.00 |
| 131,072 | 640x360 | 14.00 / 14.80 | 16.10 / 16.90 | 14.40 / 14.50 |
| 131,072 | 1280x720 | 16.90 / 16.90 | 19.30 / 20.20 | 17.50 / 17.00 |
| 524,288 | 640x360 | 44.70 / 44.80 | 59.10 / 67.60 | 46.80 / 46.40 |
| 524,288 | 1280x720 | 47.30 / 47.80 | 55.20 / 60.30 | 49.40 / 50.10 |

Every workload passed visible-count, permutation uniqueness, sorted keys, finite values, independent sampled CPU composition and full-image comparison. Maximum CPU/GPU image difference was one eight-bit code in all twelve cases, below the unchanged three-code gate. Sampled composition stayed below the unchanged 0.012 bound, including the final post-timing check. Image hashes differ across captures: this establishes tolerant agreement, not bitwise reproducibility.

## Diagnosed fix

Earlier campaigns failed composition and image gates. An attachment replay held all projected values, keys and draw indices exactly equal between captures. Changing only the accumulation attachment to `rgba16float` reduced the worst sampled error to 0.0030453 in the GPU-order arm and 0.0055136 in the CPU-order arm. The original eight-bit failure was retained; its gate was not relaxed.

Production now accumulates Gaussian blends into a resizable RGBA16-float texture and converts once during fullscreen presentation. Both arms use this path. The additional attachment costs eight bytes per viewport pixel and adds a presentation pass; logical allocation accounting includes it. This is a correctness fix, not a measured speedup over the failed eight-bit implementation. The radix shared-memory publication fix also remains covered by missing-barrier negative controls and actual native permutations.

## Limits

These are deterministic owned rooms with SH degree zero, fixed seed 565, identity camera and scale one. They do not establish the desired 650K-splat, 1920×1080, 72 FPS or 33% GPU-time claim. CPU-sort and GPU-sort timing ranges overlap; neither this table nor the optional timestamp stages establish an isolated radix-kernel speedup. Physical peak VRAM, photorealistic captures and full degree-two/three SH coverage were not measured. The inherited cross-workgroup radix lookback still relies on forward progress; finite tests on this adapter do not prove portability.

The image and composition cutoffs are numerical regression checks for these bounded-color fixtures, not calibrated perceptual quality metrics or a general HDR composition guarantee.

The original small fixture was re-driven through the new accumulation/presentation path and passed all seven diagnostics. CPU checks, TypeScript/Vite build, and independent code/raw-sample review passed. The owned browser tab and Vite server were stopped; retained evidence survives cleanup. The final narrow-screen layout remains unverified.
