# Console GUI implementation plan

Spec: ../specs/2026-10-18-console-remake.md

User approved UI/UX, SVG and image generation. Existing main checkout was clean at 4739de1; work here preserves current 4.2 behavior and avoids moving an active user room.

- [x] Renderer: compact public dashboard and 12-card notebook in public/seven-app.js; preserve action ids, modal flows and secrecy. Add meaningful renderer coverage in tests/seven-gui.test.cjs.
- [x] Presentation: new last-loaded public/console-ui.css, responsive fixed-height game shell, paper dialogs, location blueprint, gold selection and red exclusions. Independent CSS ownership.
- [x] Integration: public/online-app.js compact app header, accessible music controls and chat; public/console-icons.js currentColor SVG library; index/build mapping.
- [x] Assets: three generated materials, original PNGs in .IMG/console-v1, optimized WebPs in public/images, exact prompts and hash manifest.
- [x] Verify: build, full engine/UI/service suite, security/auth reviews; browser 360×640/390×844/desktop cards/tabs/details/chat/private/question/review/result and keyboard. Independently review final changes.
- [ ] Release: document scope and evidence; commit authorized files, push main, confirm Vercel git SHA and production alias; smoke test deployed UI; provide source archive and preview images.

Rulings: Internal dialogs can scroll for readable details, while primary game viewport remains fixed. Public profiles remain anonymous because NPC portraits would leak assignment. Existing 4.2 two-verdict budget takes precedence over the sample image's 1/1. Legacy cases retain their existing catalog/rules.

Browser acceptance: real Edge practice D and S DAY 1–7, final accusation, audit, report, replay and restart passed; game and result fit 390×844, 360×640, 1440×900 and 844×390. Full suite 292/292; security20 and auth5. Release evidence is delivered separately in outputs/gui-remake.
