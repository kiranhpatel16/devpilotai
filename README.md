# CPWork

**Common Port for Agent** — a Magento development orchestration platform.

Single window to go from a Jira task → AI agent → review → test → commit → staging PR, with per-user local environments and role-based access.

> Full design: [`docs/CPWORK-MASTER-SPEC-v1.md`](docs/CPWORK-MASTER-SPEC-v1.md)

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + Tailwind + React Router + React Query |
| Backend | Node.js + Express + TypeScript |
| Database | SQLite (better-sqlite3) → PostgreSQL later |
| Auth | bcrypt + JWT (httpOnly cookie) + RBAC |
| AI | Cursor SDK, OpenAI (ChatGPT), Grok, Cloud AI (later phases) |
| Magento tooling | git, gh CLI, PHPUnit, Playwright (later phases) |

## Monorepo layout

```
cpwork/
├── apps/
│   ├── api/        # Express + TypeScript backend
│   └── web/        # React + Tailwind frontend
├── packages/
│   └── shared/     # Shared TypeScript types & constants
├── data/           # SQLite db + run artifacts (gitignored)
└── docs/           # Specification
```

## Getting started

```bash
# 1. Install dependencies (root installs all workspaces)
npm install

# 2. Create your env file
cp .env.example .env
#   - set JWT_SECRET
#   - set CPWORK_MASTER_KEY (openssl rand -hex 32)
#   - set SEED_ADMIN_PASSWORD

# 3. Seed the first admin (creates db + runs migrations)
npm run seed:admin

# 4. Run backend + frontend together
npm run dev
```

- API: http://localhost:3000
- Web: http://localhost:5173

## Implementation status

This is the **base scaffold** (Phase 0 foundation):

- [x] Monorepo + shared types
- [x] SQLite schema + migrations
- [x] Auth (login/logout, JWT, RBAC)
- [x] Admin: users, projects, activities
- [x] Per-user project environments
- [x] Runs skeleton + activity logging
- [x] Frontend shell: Login, Admin, My Work, Agent Port, My Environments
- [ ] Jira connector (Phase 1)
- [ ] AI provider adapters (Phase 0.5)
- [ ] Git workflow + tests + PR (Phase 2–3)

See the spec for the full phased plan.
