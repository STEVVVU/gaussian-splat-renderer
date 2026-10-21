# Scene input
## Sub-features
Binary little endian PLY import, structural bounds validation, default camera and camera presets.
## How to get to it (user POV)
Use PLY file control or Load synthetic scene.
## Driving it with CUA
Load fixture, switch rendering modes, orbit camera. Import truncated/unsupported PLY and retain visible error.
## Gotchas
Only scalar float/uchar properties are supported; reject unsupported layouts before GPU allocation. Scene replacement must release old GPU buffers.
