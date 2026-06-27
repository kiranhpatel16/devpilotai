# Devpilot AI

**Common Port for Agent** — a Magento development orchestration platform.

Single window to go from a Jira task → AI agent → review → build → test → commit → staging PR, with per-user local environments and role-based access.

> **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · **Full spec:** [`docs/CPWORK-MASTER-SPEC-v1.md`](docs/CPWORK-MASTER-SPEC-v1.md)

---

## What it does

CPWork connects your team's workflow into one dashboard:

| Area | Capability |
|------|------------|
| **Jira** | Task boards, issue detail, comments, assignee filtering |
| **AI agents** | Requirement analysis, architecture, plans, test cases, code generation, AI review |
| **Git** | Branch setup, diff review, commit, push, staging PR (GitHub / Bitbucket) |
| **Magento build** | `setup:upgrade`, DI compile, static deploy, composer install (profile-aware) |
| **QA** | PHP lint, layout XML validation, PHPUnit, visual smoke (Playwright screenshots) |
| **Admin** | Users, projects, AI providers, AI rules, activity audit |
| **Per-user envs** | Each developer can point at their own local Magento path, URLs, and DB |

Human-in-the-loop by design: the agent proposes; the developer reviews and applies before anything is committed or deployed.

---

## Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite 8, Tailwind CSS, React Router, TanStack Query, Recharts |
| **Backend (active)** | Python 3.10+, FastAPI, Uvicorn |
| **Shared types** | TypeScript (`@cpwork/shared`) — used by the web app |
| **Database** | SQLite (`data/cpwork.db`) with WAL mode |
| **Auth** | bcrypt + JWT (httpOnly cookie) + RBAC |
| **AI providers** | OpenAI, Grok (xAI), Google Gemini (`cloud_ai`), Cursor SDK, custom OpenAI-compatible endpoints |
| **Magento tooling** | GitPython, `gh` CLI, PHPUnit, Playwright (Chromium) |
| **Legacy API** | `apps/api` — Node.js + Express + TypeScript (not used by default; kept for reference) |

---

## Requirements

| Tool | Version |
|------|---------|
| **Node.js** | ≥ 20 (`.nvmrc` pins **24**) |
| **Python** | 3.10+ |
| **npm** | Comes with Node (workspaces monorepo) |
| **git** | For branch/commit/PR workflow |
| **gh** | Optional — GitHub PR creation |
| **PHP / Magento** | On the host or in Docker — used during build & test steps against your project root |

---

## Quick start

### One-command setup

```bash
./setup.sh
```

This script:

1. Creates a Python virtual environment (`.venv`)
2. Installs Python deps from `apps/api_py/requirements.txt`
3. Runs `npm install` and builds `@cpwork/shared`
4. Installs Playwright Chromium (visual smoke tests)
5. Copies `.env.example` → `.env` if missing
6. Seeds the first super-admin user

### Configure secrets

Edit `.env` before going to production:

```bash
cp .env.example .env   # if setup.sh didn't already
```

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Signs session tokens — use a long random string |
| `CPWORK_MASTER_KEY` | Encrypts stored API keys (Jira, Git, AI). Generate: `openssl rand -hex 32` |
| `SEED_ADMIN_PASSWORD` | Initial admin password (change on first login) |
| `WEB_ORIGIN` | CORS origin for the Vite dev server (default `http://localhost:5173`) |
| `DATABASE_FILE` | SQLite path (default `./data/cpwork.db`) |

AI provider keys are configured in the UI under **Settings → AI Providers** (encrypted at rest with `CPWORK_MASTER_KEY`).

### Run the system

```bash
# API + web together (recommended)
npm run dev

# Or use the shell wrapper
npm start          # same as ./start.sh

# Run separately
npm run dev:api    # Python API on :3000
npm run dev:web    # Vite dev server on :5173
```

| Service | URL |
|---------|-----|
| **Web UI** | http://localhost:5173 |
| **API** | http://localhost:3000 |
| **Health check** | http://localhost:3000/api/health |

The Vite dev server proxies `/api` → `http://localhost:3000`.

Default login (after seed): username from `SEED_ADMIN_USERNAME` (default `admin`).

---

## Monorepo layout

```
devpilotai/                    # repository root (project name: cpwork)
├── apps/
│   ├── api_py/                # ★ Active backend — FastAPI
│   │   ├── main.py            # App entry + router registration
│   │   ├── routers/           # HTTP route handlers
│   │   ├── services/          # Business logic (workflow, deploy, AI, git, jira…)
│   │   ├── db/                # SQLite repositories
│   │   ├── middleware/        # Auth middleware
│   │   ├── scripts/           # seed_admin.py, etc.
│   │   └── tests/             # pytest unit tests
│   ├── web/                   # ★ Active frontend — React + Vite
│   │   └── src/
│   │       ├── pages/         # Route-level screens
│   │       ├── components/  # UI + execution-center workflow panels
│   │       ├── hooks/         # Deploy/test pipeline hooks
│   │       └── lib/           # API client, workflow helpers
│   └── api/                   # Legacy Node/Express API (optional: npm run dev:api:ts)
├── packages/
│   └── shared/                # Shared TypeScript types & constants
├── data/                      # SQLite DB, run artifacts, task plans (gitignored)
├── docs/                      # Master specification
├── setup.sh                   # First-time environment setup
├── start.sh                   # Start API + web in one terminal
├── cacheclean.sh              # Clear Python/Node/Vite build caches
├── .env                       # Local secrets (not committed)
└── .nvmrc                     # Node version (24)
```

---

## Application pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — task counts, pipeline funnel, recent activity |
| `/workspaces/:projectId` | Jira task board for a project |
| `/workspaces/:projectId/tasks/:runId` | **Task Execution Center** — full workflow UI |
| `/tasks` | All tasks across projects |
| `/tasks/history` | Completed / archived runs |
| `/tasks/custom` | Custom (non-Jira) tasks |
| `/tasks/incidents` | Incident tracking |
| `/agents` | Agent personas overview |
| `/knowledge` | Project knowledge base (rules, standards, architecture) |
| `/deployments` | Deployment history |
| `/reports` | Usage & productivity reports |
| `/settings/users` | Admin — user management |
| `/settings/projects` | Admin — project registry (Jira, Git, LLM defaults) |
| `/settings/ai-providers` | Admin — AI provider keys & models |
| `/settings/ai-rules` | Admin — per-project AI prompt rules |
| `/settings/environments` | Per-user local Magento paths & URLs |

---

## Task workflow

Each task run follows a guided pipeline in the **Task Execution Center**:

```
Select → Analysis → Setup → Architecture → Plan → Test Cases → Approval
  → Code → Review → Build → Git → QA → Jira → Done
```

| Step | What happens |
|------|----------------|
| **Select** | Pick a Jira issue or custom task |
| **Analysis** | AI requirement analysis from Jira description + attachments |
| **Setup** | Branch creation, environment check, LLM provider selection |
| **Architecture** | Module/file structure design |
| **Plan** | Development plan with subtasks |
| **Test Cases** | Generated manual + automated test checklist |
| **Approval** | Human sign-off before code generation |
| **Code** | AI agent writes/edits files (Cursor SDK recommended for coding) |
| **Review** | Diff review + optional AI code review |
| **Build** | Magento deploy pipeline (`setup:upgrade`, DI compile, static content, cache) |
| **Git** | Stage, commit, push, open staging PR |
| **QA** | PHP lint, layout XML, PHPUnit, visual smoke screenshots |
| **Jira** | Post completion comment back to Jira |
| **Done** | Run archived to history |

Agent personas: **Magento Developer**, **React Developer**, **Laravel Developer**, **QA Engineer**.

Workspace-level LLM config supports separate **planning** and **coding** providers/models per project.

---

## API overview

Base path: `/api`

| Router | Prefix / area |
|--------|----------------|
| `auth` | Login, logout, session |
| `admin_users` | User CRUD |
| `admin_projects` | Project registry |
| `admin_activities` | Audit log |
| `admin_ai_providers` | AI provider settings |
| `admin_ai_rules` | Per-project prompt rules |
| `projects` | Project access, environments, LLM config |
| `jira` | Task board, issue detail |
| `workflow` | Step transitions, artifacts, approvals |
| `runs` | Run CRUD, agent execution, streaming |
| `ai` | Direct AI calls |
| `agents` | Agent persona metadata |
| `chat` | In-run chat |
| `deployments` | Deploy history |
| `dashboard` | Summary metrics |
| `reports` | Usage reports |
| `knowledge` | Knowledge base entries |
| `usage` | AI credit / token tracking |

---

## Roles & access

**Global roles** (system-wide):

| Role | Access |
|------|--------|
| `super_admin` | Full system access |
| `admin` | User/project/AI admin, all projects |
| `developer` | Assigned projects, run workflows |
| `viewer` | Read-only |

**Project roles** (per project): `owner`, `developer`, `reviewer`, `viewer`.

Admins configure shared project settings (Jira, Git remote, default paths). Each developer overrides paths in **Settings → Environments**.

---

## AI providers

Built-in providers (enable in **Settings → AI Providers**):

| ID | Label | Typical use |
|----|-------|-------------|
| `openai` | ChatGPT (OpenAI) | Planning, analysis, review |
| `grok` | Grok (xAI) | General agent tasks |
| `cloud_ai` | Google Gemini | General agent tasks |
| `cursor` | Cursor SDK | **Coding step** — file edits in the repo |

Custom OpenAI-compatible providers can also be added from the admin UI.

---

## Magento deploy profiles

Deploy steps adapt based on changed files:

| Profile | When used |
|---------|-----------|
| `auto` | Detect from diff (default) |
| `light` | Config/XML only — skip heavy compile |
| `standard` | Typical module changes |
| `full` | Theme/static/frontend changes |

Supports host PHP or Docker-based Magento (via per-environment `docker_compose_path`).

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Run `./setup.sh` |
| `npm start` | Run `./start.sh` (API + web) |
| `npm run dev` | API + web via `concurrently` |
| `npm run dev:api` | Python API only |
| `npm run dev:web` | Frontend only (builds shared first) |
| `npm run build` | Production web build |
| `npm run build:shared` | Compile `@cpwork/shared` |
| `npm run seed:admin` | Create initial admin user |
| `npm run cacheclean` | Clear build caches |
| `npm run dev:api:ts` | Legacy Node API (not default) |

---

## Testing

### Python unit tests

```bash
source .venv/bin/activate
python -m pytest apps/api_py/tests/ -q
```

Covers deploy error parsing, layout XML validation, AI rules, agent output validation, git helpers, and more.

### Visual smoke (Playwright)

Installed during `setup.sh`. Screenshots are captured during the QA step when a frontend URL is configured.

---

## Data & artifacts

| Path | Contents |
|------|----------|
| `data/cpwork.db` | SQLite database |
| `data/runs/<run-id>/` | Per-run logs, diffs, screenshots |
| `data/task-plans/` | Saved development plans |

These directories are gitignored. Back up `data/` before major upgrades.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Python virtual environment not found` | Run `./setup.sh` |
| API key decrypt errors | Re-save keys in AI Providers; ensure `CPWORK_MASTER_KEY` hasn't changed |
| Frontend type errors after shared changes | `npm run build:shared` |
| Stale Vite cache | `npm run cacheclean` then `npm run dev:web` |
| CORS errors | Match `WEB_ORIGIN` in `.env` to your Vite URL |
| Jira tasks empty | Set your Jira account ID on your user profile; verify project Jira config |

---

## Environment assumptions

Designed for Magento 2 teams using:

- PHP 8.3
- MariaDB / MySQL
- Hyvä, Tailwind, Magewire themes
- Local project clones (e.g. `/var/www/html/myproject`, `/var/www/html/myproject-local`)
- Staging PRs only — never auto-merge to production

---

## Further reading

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture, data flow, workflow state machine, security
- [`docs/CPWORK-MASTER-SPEC-v1.md`](docs/CPWORK-MASTER-SPEC-v1.md) — full product spec, data model, API reference, phased roadmap
