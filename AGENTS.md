# Working agreement for coding agents

Astrovivu is built by several agents in parallel in **one working tree**. These rules keep the pieces interlocking. Read `docs/ARCHITECTURE.md` and `src/contracts/` before writing anything.

## People

Five people also work on this repository, each on their own branch through pull requests: `CONTRIBUTING.md` describes that workflow and `.github/CODEOWNERS` records who reviews which paths.

| Person | Area | Paths |
|---|---|---|
| `quocbao271207` | UI/UX end to end, map, contracts, merges | `src/ui/**` (not `mascot`), `src/globe/**`, `src/styles/**`, `src/contracts/**`, `src/state/**` |
| `thuyyen03052008` | Mascot | `src/ui/mascot/**`, `public/mascot/**`, `docs/MASCOT.md` |
| `quocthai2711` | Crop data (catalogue, regional prevalence, costs and prices per country) and the urban grower logic | `data/crops/**`, `scripts/crops/**`, `scripts/build-crop-catalog.ts`, `src/core/crops/**`, `public/data/crops/**`, `src/core/urban/**`, `docs/CROP_DATA.md` |
| `khoaminh2957` | Model (suitability scoring, profit optimisation) and the chatbot | `src/core/scoring/**`, `src/core/economics/**`, `src/core/advisory/rotation.ts`, `src/rag/**`, `server/**`, `scripts/rag/**`, `data/rag/**`, `public/rag/**`, `docs/SCORING.md`, `docs/SCORING_PAPER.md`, `docs/ECONOMICS.md`, `docs/RAG.md` |
| `MinDuy314` | Soil improvement from soil data | `src/core/soil/**`, `docs/SOIL.md` |

An agent works for one person, on that person's branch. Before touching a path another person owns, say so and let its owner review the pull request; never push to `main`, never merge a pull request, and never rewrite a branch someone else has pushed. Rule 1 below (no git writes) is for agents sharing one working tree under an orchestrator; an agent working alone on a person's branch commits there when that person asks.

## Ownership

Edit only the paths you own. If you need something outside them, describe the change in your final report; do not make it.

| Area | Paths |
|---|---|
| Architect / orchestrator | `src/contracts/**`, `src/state/**`, `src/lib/**`, `src/i18n/index.ts`, `src/main.tsx`, root config, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_INSTRUCTIONS.md` |
| 2a Data ingestion | `src/data/**` (not `samples.ts` geometry), `scripts/cache-samples.ts`, `scripts/data/**`, `public/data/samples/**`, `docs/DATA_SOURCES.md` |
| 2b Scoring & economics | `src/core/crops/**`, `src/core/scoring/**`, `src/core/economics/**`, `scripts/build-crop-catalog.ts`, `scripts/crops/**`, `public/data/crops/**`, `data/crops/**`, `docs/SCORING.md`, `docs/ECONOMICS.md` |
| 2c Advisory, insights, urban logic | `src/core/advisory/**`, `src/core/urban/**`, `docs/ADVISORY.md` |
| 3 Globe | `src/globe/**`, vertex geometry in `src/data/samples.ts`, `docs/GLOBE.md` |
| Design Director | `src/ui/design/**`, `src/styles/**`, `public/fonts/**`, `docs/DESIGN.md` |
| 4a Mission UI | `src/App.tsx`, `src/ui/chrome/**`, `src/ui/hero/**`, `src/ui/dock/**`, `src/ui/hud/**`, `src/ui/timeline/**`, `src/ui/override/**` |
| 4b Advisory, urban, assistant UI | `src/ui/advisory/**`, `src/ui/urban/**`, `src/ui/ask/**` |
| 5 Docs & QA | `README.md`, `docs/DEMO_SCRIPT.md`, `docs/JUDGING.md` |
| 6 Crop-knowledge RAG | `src/rag/**`, `server/**`, `scripts/rag/**`, `public/rag/**`, `data/rag/**`, `docs/RAG.md` |
| 7 Market data & database | `supabase/**`, `scripts/market/**`, `data/market/**`, `docs/DATABASE.md` |
| 8 CI/CD | `.github/**`, `scripts/ci/**`, `docs/CI_CD.md` |

Contracts (`src/contracts/**`) may be extended additively (new optional fields, new exported types) when your area needs it. Never rename or remove. List every contract change in your final report.

## Rules

1. **No git writes.** Do not run `git add`, `commit`, `push`, `stash`, `checkout`, `reset`, `restore` or `clean`. The orchestrator commits. Reading (`git status`, `git diff`, `git log`) is fine.
2. **Installing a package** changes shared files. Take the lock first, release it after:
   `mkdir .agent-locks/npm` (succeeds for one agent only; if it fails, wait 20 s and retry, up to 10 minutes) → `npm install <pkg> --no-audit --no-fund` → `rmdir .agent-locks/npm`. Never run `npm install` without the lock, never delete `node_modules` or the lockfile, never run `npm audit fix`.
3. **Processes.** Start dev servers only on your assigned port. Stop only processes you started, by PID. Never `taskkill /IM node.exe` or anything that kills by name: other agents' servers are running.
4. **Verification is scoped.** Run your own tests (`npx vitest run <path>`), then `npx tsc --noEmit`. Other agents' work in progress can produce errors outside your paths: report them, do not fix them, and do not let them block you.
5. **Data honesty.** Never fabricate an observation. Every value carries its source and provenance; a fallback writes a visible note; simulated data is flagged `simulated`. If a source fails, degrade to the next one and say so in `BranchTelemetry.notes`.
6. **Secrets.** Keys live in `.env` (git-ignored) and are read from `process.env` on the server or in scripts only. Never print, log or commit them. Never put a secret in browser code.
7. **Network manners.** Timeouts on every request, at most 3 retries with backoff, cache responses under `.cache/` (git-ignored) in scripts and in IndexedDB in the browser. Do not hammer public APIs: no more than 4 concurrent requests per host.
8. **Two languages.** Every user-facing string exists in English and Vietnamese: `I18nText` for data and model output, `registerStrings(ns, en, vi)` in a `strings.ts` inside your folder for UI text.
9. **Code.** TypeScript strict, no `any` without a comment explaining why. `src/core` is pure (no fetch, no DOM, no Date.now() without an injectable `today`). Comments explain why, not what. Keep modules small.
10. **Docs.** Each area writes one document under `docs/` describing what it does, the formulas or decisions with their sources, and the known limits. Plain prose and tables; no marketing.

## Environment

- Windows 11, Git Bash and PowerShell. The project path contains a space: quote it.
- Node 24, npm. **No Python.** Scripts are TypeScript run with `npx tsx`.
- Database (optional): `npm run db:start` runs a local Supabase with Docker, API on port 54321 and Postgres on 54322; `npm run db:test` checks migrations and policies. See `docs/DATABASE.md`. Nothing in the app needs it to start.
- Today is 2026-11-14. The telemetry window is the 365 days ending today.
- Dev server ports: orchestrator 5173, globe 5181, mission UI 5182, advisory UI 5183, design 5184, API server 8787.
- Deep links: `?sample=<id>&phase=locked|advisory&crop=<id>&lang=vi`, `?phase=explore`, `?phase=urban`, `#/styleguide`, `#/globe-lab`.
- Browser tools, if you have them: open your own tab, pass its `tabId` on every call, never navigate, select, resize or close a tab you did not open.

## Final report

End with: what you built (files), how you verified it (commands and their results), what does not work or was not verified, contract changes, and anything another agent needs to know or do.
