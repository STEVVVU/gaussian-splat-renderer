---
name: verify-splatforge
description: Drive the real Gaussian splat renderer WebGPU viewer with CUA, validate owned Gaussian fixtures, and preserve GPU evidence.
---
# Launch
Run npm ci then node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186 --strictPort in a tracked shell session. Ready is Vite Local URL; usable additionally requires a WebGPU adapter and successful fixture draw.
# Doctor
Invoke-WebRequest http://127.0.0.1:5186 and inspect title. Use CUA to observe the page and visible errors. Never use CDP or Playwright. Coordinate shared GPU ownership before opening the viewer.
# Drive
Open the local URL with CUA. Use Load synthetic scene, change renderer between gaussian and pointcloud, adjust gaussian multiplier, and orbit with mouse. Capture before and after states. Import malformed PLY and confirm readable failure without replacing scene. GPU diagnostics exercises production preprocess, sort and draw before readback.
# Evidence
Store screenshots, UI action transcript, GPU readbacks, adapter info and validation errors outside repository under C:/Users/steve/.codex/orchestrate/coursework30-20261021/evidence/P16/. Record action, resulting state and file/network side effects. npm build proves TypeScript/bundling only. Status: proven on the owned synthetic-renderer feature. Launch, Doctor, Drive, Evidence and Cleanup executed against the real visible IAB/WebGPU. Final narrow-screen layout remains visually unverified; other mapped journeys retain their stated acceptance checks.
# Cleanup
Close only the CUA tab created for this run. Stop only the tracked Vite session. Confirm retained evidence exists after cleanup. No deployment or external scenes required.


# Retained proof and numerical oracle
Main-thread visible IAB CUA actually drove the owned fixture and multiplier at748x766. GPU diagnostics all seven checks passed; raw text and screenshots survive outside the repo in C:/Users/steve/.codex/orchestrate/coursework30-20261021/evidence/P16/cua/. Readback numeric oracle: `node scripts/check-gpu-readback.mjs <diagnostics-AX-or-JSON-file> [multiplier=1]`. It requires the synthetic scene identity camera and compares the actual projected center, inverse covariance, eigenvalue radius, rotated conic sign, SH red and rendered-pixel error. Main browser creation/actions are necessary on this host because a subagent cannot create visible IAB or claim main-thread tabs. No hidden browser workaround is allowed. Launch/Doctor/Drive/Evidence/Cleanup executed. Main closed the owned tabs; the implementer stopped only Vite session58601 and confirmed port5186 has no listener. Retained accepted.txt/png and GPU oracle evidence survived cleanup. Final narrow-screen layout was not observed after its CSS change; no responsive acceptance claim is made.
