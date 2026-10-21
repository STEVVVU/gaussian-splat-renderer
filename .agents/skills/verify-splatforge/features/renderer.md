# Renderer
## Sub-features
Point cloud MVP; Gaussian covariance, conic, radius, culling; GPU radix sorting; SH color; alpha quads; multiplier.
## How to get to it (user POV)
Open local viewer and choose Load synthetic scene.
## Driving it with CUA
Capture gaussian and pointcloud modes, orbit and multiplier changes. Run GPU diagnostics and retain JSON plus screenshot.
## Gotchas
Requires WebGPU adapter and exclusive coordinated GPU slot. Build alone does not validate WGSL. Owned scene is a small mechanism test, not photorealistic capture.
