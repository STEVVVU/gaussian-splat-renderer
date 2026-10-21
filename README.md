# Gaussian splat renderer

A WebGPU renderer for Gaussian PLY scenes. It projects 3D covariance into screen space, culls invisible splats, sorts survivors on the GPU and draws alpha-blended quads with view-dependent spherical-harmonic color.

Built from the complete [UPenn CIS5650 Fall 2025 starter](https://github.com/CIS5650-Fall-2025/Project5-WebGPU-Gaussian-Splat-Viewer), commit `c0b02e3a5d529b6e84528263b76533f89ab49695`. The [assignment instructions](INSTRUCTION.md), upstream history, author credits and [MIT license](LICENSE) remain. [README.upstream.md](README.upstream.md) preserves the original overview. The starter supplied the camera, loader, point-cloud path and radix sorter; this adaptation implements the Gaussian rendering path and its verification.

## Run

Use Node.js 25.8 or later for the native TypeScript checks and a WebGPU-capable browser.

```sh
npm ci
npm run check
npm run build
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186 --strictPort
```

Open `http://127.0.0.1:5186/`, select **Load synthetic scene**, then **GPU diagnostics**. The owned six-point fixture includes rotated and anisotropic splats, overlapping colors, an offscreen splat and one behind the camera. Four splats survive. The expected far-to-near order is `2, 0/1, 3`. All diagnostic checks should be true.

Drag the canvas to rotate, right-drag to pan, and use the wheel to move. The multiplier changes Gaussian scale. The file controls accept a Gaussian PLY and an optional camera JSON. The renderer switch retains the upstream point-cloud view.

## Implementation

- Normalized PLY quaternions and exponentiated scale produce 3D covariance. A perspective Jacobian projects it to a 2D covariance, inverse conic and three-sigma screen radius.
- Compute preprocessing rejects near/far, low-opacity and offscreen splats, compacts survivors and creates complemented depth keys. The inherited four-pass radix sorter runs on the GPU; an indirect draw consumes its survivor count.
- Sorted quads evaluate conic Gaussian opacity. Premultiplied far-to-near blending produces the final image. Spherical harmonics support degrees zero through three.
- The loader validates binary little-endian PLY layout, finite half-representable values, quaternion length, SH properties and adapter buffer limits. Scene limits are 256 MiB and one million points; this is a full-buffer loader.
- Scene replacement releases owned GPU buffers. Readback diagnostics use the actual render path, copy an offscreen GPU image and compare sampled colors with an independent CPU blending reference.

[IMPLEMENTATION.md](IMPLEMENTATION.md) maps the changed files and remaining limits. Source fixtures are maintained under `src/utils/synthetic.ts` and `public/fixtures/`.

## Verification

```sh
npm run check
npm run build
npm audit
node scripts/check-gpu-readback.mjs path/to/diagnostics.txt
```

The [verification skill](.agents/skills/verify-splatforge/SKILL.md) describes the actual browser journey. CPU checks cover parser boundaries, owned fixture values and reference math. A build alone does not establish shader execution.

Actual CUA browser checks ran the WebGPU pipeline on the owned scene. GPU readback found four survivors in the expected order. All seven diagnostics passed, including alpha composition and first-order view-dependent color. An independent scalar oracle measured conic relative error `8.43e-8`, expected and actual radius `278`, and maximum sampled RGB error `0.00342` against a tolerance of `0.012`. The scale control also changed the visible lobe sizes.

These are small-scene correctness checks. Large or photorealistic scenes, performance benchmarks, full degree-two/three SH numerical coverage and the final narrow-screen layout remain unverified. No live deployment is configured. Hosted CI builds and runs CPU checks; it does not claim browser GPU coverage.
