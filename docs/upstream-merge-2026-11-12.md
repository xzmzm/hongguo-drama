# Upstream merge — 2026-11-12

Merged `upstream/main` at `bb4aec9` into the fork, bringing upstream 7.1.

Playback requests, Argus551/Ladon signing, request headers, source pacing and bounded recovery use upstream code unchanged. The fork signer (`player-signature.js`) and its test were superseded by upstream `playback-signature.js` and its fixed-vector tests; the old files were moved to the Windows Recycle Bin. Upstream licensing notices are retained.

Fork-specific separate player windows and optional CDN setting remain. The settings conflict combines upstream `fast_conversion` with fork `fast_cdn_host`. pnpm now locks follow-redirects 1.16.3 to match upstream package-lock.json and exposes it for the upstream redirect check.

Validation:
- Signing, source routing/recovery/pacing, hardware encoder and conversion unit selection: 104/105 passed. The one failure is `output reservation reports ownership before writing and cleans a failed close` in upstream bytevc2.test.cjs. Its mock drops the bigint stat option; production code and this test match upstream unchanged. No claim of full regression success.
- App source checks: 13/13 passed; source recovery passed.
- Redirect header security passed with Axios 1.20.0 / follow-redirects 1.16.3.
- Player fast conversion, backend settings, online quality and two-episode prefetch checks passed.
- Download quality integration: 50/50 passed, including its real Hongguo catalog/download fixture (一江春水, series 7702724487975799832, episode 5 / vid 7702726316558142488). No signed media URLs or credentials recorded.
- Vite production build passed (separate temporary output; bundle size warning only).
- Release version checks passed; main.js and preload.js syntax checks passed.

No GUI/live playback, installer or cross-platform release acceptance was performed. No release, install replacement, issue comment or push is part of this merge.
