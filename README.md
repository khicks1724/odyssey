# Odyssey

> **AI-powered project management platform** — track goals, unify activity across GitHub, GitLab, Microsoft 365, and Teams, and get intelligent suggestions powered by Claude, GPT-4o, or Gemini.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Features](#features)
- [AI Integration](#ai-integration)
- [Integrations](#integrations)
- [Theme System](#theme-system)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Building for Production](#building-for-production)

---

## Overview

Odyssey is a full-stack project management dashboard built for small engineering teams. It connects to your GitHub/GitLab repos, Microsoft 365 workspace, and file uploads to give you a single unified view of project activity. Three AI providers (Anthropic Claude, OpenAI GPT-4o, Google Gemini) are available and auto-routed based on task complexity — simple questions get fast Haiku responses, complex analysis uses Sonnet or GPT-4o.

The AI doesn't just answer questions: it can propose goal changes (create, update, delete), suggest deadline extensions based on commit velocity, and analyze the entire project and generate an **Intelligent Update** — a ranked list of suggestions you can accept or dismiss individually or all at once.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS 4 |
| **Backend** | Node.js, Fastify 5, TypeScript |
| **Database** | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| **AI** | Anthropic Claude (Haiku / Sonnet / Opus), OpenAI GPT-4o, Google Gemini |
| **Routing** | React Router 7 |
| **Markdown** | react-markdown + remark-gfm |
| **Document Parsing** | pdf-parse, mammoth (DOCX) |
| **Hosting** | Vercel (frontend), Railway (backend) |

---

## Project Structure

```
odyssey/
├── client/                         # React frontend (Vite)
│   ├── src/
│   │   ├── components/             # UI components
│   │   │   ├── layout/             # AppLayout, Sidebar
│   │   │   ├── GoalCard.tsx        # Goal display card
│   │   │   ├── ProjectChat.tsx     # AI chat panel (right-side)
│   │   │   ├── IntelligentUpdatePanel.tsx  # AI suggestions panel
│   │   │   ├── Timeline.tsx        # Unified event timeline
│   │   │   ├── ContributionGraph.tsx       # Activity heatmap
│   │   │   ├── FileViewer.tsx      # GitHub/GitLab file browser
│   │   │   ├── GoalMetrics.tsx     # Analytics charts
│   │   │   ├── ThemeSwitcher.tsx   # Theme selector dropdown
│   │   │   └── AIAgentDropdown.tsx # AI model selector
│   │   ├── hooks/                  # Custom React hooks
│   │   │   ├── useDashboard.ts     # Dashboard stats & insights
│   │   │   ├── useGoals.ts         # Goal CRUD
│   │   │   ├── useEvents.ts        # Event feed
│   │   │   └── useProjects.ts      # Project management
│   │   ├── lib/                    # Core utilities & contexts
│   │   │   ├── theme.tsx           # 10 built-in themes + ThemeProvider
│   │   │   ├── auth.tsx            # Supabase auth context
│   │   │   ├── supabase.ts         # Supabase client
│   │   │   ├── ai-agent.tsx        # AI model selector context
│   │   │   └── chat-panel.tsx      # Persistent chat state context
│   │   ├── pages/                  # Route-level page components
│   │   │   ├── DashboardPage.tsx   # Overview & stats
│   │   │   ├── ProjectDetailPage.tsx  # Goals, chat, timeline
│   │   │   ├── ProjectsPage.tsx    # Project list
│   │   │   └── SettingsPage.tsx    # Integrations & profile
│   │   └── types/                  # Shared TypeScript interfaces
│   └── package.json
│
├── server/                         # Fastify API backend
│   ├── src/
│   │   ├── index.ts                # Server setup, route registration
│   │   ├── ai-providers.ts         # Multi-model LLM router
│   │   └── routes/
│   │       ├── ai.ts               # Chat, Intelligent Update, Insights
│   │       ├── github.ts           # GitHub API proxy & file browser
│   │       ├── gitlab.ts           # GitLab API proxy (self-hosted)
│   │       ├── microsoft.ts        # Microsoft 365 OAuth2 + Graph API
│   │       ├── uploads.ts          # File upload + text extraction
│   │       ├── webhooks.ts         # GitHub webhook handler
│   │       └── health.ts           # Health check
│   └── package.json
│
└── supabase/                       # Database migrations (SQL)
    ├── schema.sql                  # Core tables + RLS policies
    └── migration-*.sql             # Incremental schema updates
```

---

## Features

### Goal Tracking

- Create, edit, and delete goals with deadlines, categories, status, and progress percentage
- **Kanban board** with columns: Not Started → In Progress → In Review → Complete
- Goals completed more than 7 days ago are automatically moved to a hidden "archived" section in the Complete column — click **Show archived goals** to reveal them with a faded treatment
- **Status color coding**: red (not started), orange (in progress), yellow (in review), green (complete)
- Risk scoring per goal; overdue and at-risk goals surfaced in the dashboard

### Activity Timeline

- Unified event feed from all connected sources: GitHub commits, GitLab commits, Microsoft Teams messages, OneDrive file edits, OneNote pages, manual uploads, and Odyssey-internal goal updates
- Contribution heatmap (GitHub-style) showing activity density per day
- Filter by source, event type, or date range
- Supabase Realtime pushes new events without a page reload

### Project Dashboard

- At-a-glance stats: active projects, goals tracked, events this week
- Upcoming deadlines widget with days-remaining countdown
- AI-generated project summary (status, next steps, future features) — persisted per project, regenerated on demand
- Recent commits feed from linked GitHub/GitLab repos

### File & Document Management

- Upload PDF, DOCX, TXT, CSV, JSON, and other files to Supabase Storage
- Automatic text extraction (up to 50 KB) for inclusion in AI context
- Preview files in-app with a dedicated file viewer
- Browse GitHub/GitLab repo trees and view raw file content directly in the dashboard (capped at 512 KB)

### Reports & Analytics

- Goal metrics dashboard with completion rate charts
- Contribution heatmap by date
- Activity breakdown by event source and type
- On-track rate per project

---

## AI Integration

### Model Selection

Use the **AI Agent dropdown** in the top navigation to choose a provider:

| Option | Behavior |
|---|---|
| **Auto** | Haiku for short/simple queries, Sonnet for complex ones |
| **Claude Haiku** | Fast responses, lightweight DB-only context |
| **Claude Sonnet** | Full context including GitHub commits and documents |
| **Claude Opus** | Highest capability |
| **GPT-4o** | OpenAI alternative |
| **Gemini Pro** | Google alternative |

### Auto-Routing Logic

When set to **Auto**, the server analyzes the last user message:

- Contains analysis keywords (`analyz`, `comprehensive`, `summarize`, `deep dive`, etc.) → **Sonnet**
- Longer than 80 words → **Sonnet**
- Longer than 20 words → **Sonnet**
- Short/simple message (e.g., "hello", "what are my goals?") → **Haiku**

Haiku-routed messages use a **lightweight context** (database queries only — no GitHub/GitLab API calls), reducing response time from ~5–20 seconds down to ~200 ms.

### AI Chat Panel

Click **AI Chat** in the top navigation (only visible when a project is open) to open the chat panel on the right side of the screen. Drag the divider to resize it.

- Full multi-turn conversation about the active project
- The AI receives project goals, recent events, and document excerpts as context
- **Proposed actions**: when the AI suggests creating, updating, or deleting a goal, it presents an action card with **Approve** and **Decline** buttons — no changes happen without your confirmation
- Responses rendered with full GitHub-flavored Markdown (headers, bold, lists, code blocks)
- Hover over any assistant message to reveal a **copy button** in the top-right corner
- Chat history persists when you close and reopen the panel; clears automatically when you switch to a different project

### Intelligent Update Panel

The **Intelligent Update** button on a project page runs a full project analysis and returns a prioritized list of AI suggestions, displayed in the same right-side panel as the chat.

Each suggestion includes:

| Field | Description |
|---|---|
| **Type** | Create Goal, Update Goal, Remove Goal, Extend Deadline, Move Deadline Up |
| **Priority** | High / Medium / Low |
| **Why?** | Expandable AI reasoning for the suggestion |
| **Accept** | Applies the change immediately to the database |
| **Dismiss** | Marks as rejected without applying |

Use **Accept All** in the footer to apply all pending suggestions at once.

### Project Insights

The **Insights** section on the dashboard contains an AI-generated summary of the entire project:

- **Status overview** — current project health assessment
- **Next steps** — ordered list of recommended immediate actions
- **Future features** — longer-horizon ideas and enhancements

Insights are stored in the database (one row per project) and can be regenerated at any time. The provider that generated each insight is displayed for transparency.

---

## Integrations

### GitHub

Connect a GitHub repository to pull in commit history, file trees, and repository metadata.

**Supported operations:**
- Recent commits with author, date, and message (default 30, up to 100)
- Repo metadata: stars, open issues, primary language, default branch
- Recursive file tree browser (up to 500 files)
- Raw file content viewer (up to 512 KB)
- GitHub user search for assigning collaborators

**Webhooks:**

Configure a webhook in your GitHub repo settings pointing to `/api/webhooks/github`. Odyssey verifies HMAC-SHA256 signatures and normalizes events into the unified activity timeline.

Supported events: `push`, `pull_request`, `issues`, `issue_comment`, `create`, `delete`, `release`

### GitLab (Self-Hosted)

Connect to a self-hosted GitLab instance (configured via `GITLAB_HOST` env var).

- Fetch commits, README, and repo metadata
- Browse file trees and preview raw files
- Link multiple GitLab repos per project

### Microsoft 365

OAuth2 integration with Azure AD. After connecting your account in Settings, Odyssey can access:

- **OneDrive** — files and folders
- **OneNote** — notebooks, sections, and pages (HTML stripped to plaintext for AI)
- **Teams** — basic team access

Tokens are stored AES-256-GCM encrypted in the database and automatically refreshed before expiry.

---

## Theme System

Odyssey ships with 10 built-in themes. All colors are applied as CSS custom properties on the document root, so switching themes takes effect instantly without a reload. The selected theme persists to `localStorage`.

| Theme | Style |
|---|---|
| **Odyssey Dark** | Default — deep navy with blue accent |
| **Odyssey Light** | Clean light variant of the brand theme |
| **One Dark Pro** | Atom editor-inspired dark theme |
| **Dark Modern** | Contemporary charcoal |
| **Light Modern** | Contemporary light gray |
| **Claude Dark** | Anthropic-inspired dark theme |
| **Claude Light** | Anthropic-inspired light theme |
| **GitHub Dark** | GitHub VS Code dark theme |
| **Nord** | Arctic/Nordic cool-blue palette |
| **Dracula** | High-contrast purple/pink dark theme |

**Custom properties used throughout the app:**

```css
--color-bg        /* Page background */
--color-surface   /* Card / panel background */
--color-surface2  /* Elevated surface (input, hover states) */
--color-border    /* Border color */
--color-accent    /* Primary accent (buttons, links) */
--color-accent2   /* Secondary accent */
--color-accent3   /* Tertiary accent (success actions) */
--color-danger    /* Error / destructive actions */
--color-text      /* Body text */
--color-muted     /* Secondary / placeholder text */
--color-heading   /* Heading text */
```

---

## Database Schema

All tables have Row-Level Security (RLS) enabled. Users can only access data for projects they own or are members of.

### Core Tables

| Table | Purpose |
|---|---|
| `profiles` | Extended user profile linked to Supabase Auth |
| `projects` | Top-level project container with owner |
| `project_members` | Many-to-many: users ↔ projects with roles |
| `goals` | Goals with status, deadline, progress, category, assignee |
| `events` | Unified activity log from all sources |
| `integrations` | Per-project connection config for GitHub / GitLab / Teams |
| `project_insights` | One AI-generated summary row per project |
| `user_connections` | Encrypted OAuth tokens for Microsoft 365 |

### Goal Statuses

| Value | Meaning |
|---|---|
| `not_started` | Work hasn't begun |
| `in_progress` | Actively being worked on |
| `in_review` | Under review / awaiting sign-off |
| `complete` | Done |

### Event Sources

`github` · `gitlab` · `teams` · `onedrive` · `onenote` · `manual` · `local`

---

## Environment Variables

### Server (`server/.env`)

```env
PORT=3001
CLIENT_URL=http://localhost:5173

# Supabase (service role key — never expose to client)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# AI Providers — at least one required; Claude recommended
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=AIza...

# GitHub
GITHUB_TOKEN=ghp_...                    # Optional — raises rate limit
GITHUB_WEBHOOK_SECRET=your-secret       # Must match GitHub webhook config

# Microsoft 365 (optional)
MICROSOFT_CLIENT_ID=your-azure-app-id
MICROSOFT_CLIENT_SECRET=your-azure-secret
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/microsoft/auth/callback
MICROSOFT_TOKEN_ENCRYPT_KEY=           # 64-char hex string (see below)

# GitLab (optional — for self-hosted instances)
GITLAB_HOST=https://your-gitlab-instance.com
GITLAB_TOKEN=glpat-...
```

**Generate a Microsoft token encryption key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Client (`client/.env.local`)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Running Locally

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- At least one AI API key (Anthropic Claude recommended)

### 1. Install Dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### 2. Set Up the Database

1. Open your Supabase project → **SQL Editor**
2. Run `supabase/schema.sql`
3. Run each migration file in order (`migration-005-improvements.sql` through the latest numbered file)

### 3. Configure Environment

```bash
# Server
cd server
cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_KEY, and at least one AI API key

# Client
cd ../client
cp .env.example .env.local
# Fill in: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

### 4. Start Dev Servers

```bash
# Terminal 1 — Backend (auto-reloads on save)
cd server
npm run dev
# → http://localhost:3001

# Terminal 2 — Frontend
cd client
npm run dev
# → http://localhost:5173
```

On startup the server logs which AI providers are detected:
```
[AI] Available providers: claude-haiku, claude-sonnet, claude-opus
```

### 5. First Login

1. Go to `http://localhost:5173`
2. Create an account with your email (Supabase sends a confirmation link)
3. Create a new project and start adding goals

---

## Building for Production

```bash
# Frontend
cd client
npm run build         # Outputs to client/dist/

# Backend
cd server
npm run build         # Compiles TypeScript to server/dist/
npm start             # Runs the compiled build
```

The frontend `dist/` folder is served by Vercel. The backend is deployed to Railway as a Node.js service with environment variables set in the Railway dashboard.

---

## Security Notes

- All API routes validate Supabase JWT tokens before accessing data
- RLS policies enforce row-level access at the database level — direct API calls still cannot read other teams' data
- GitHub webhook payloads are verified with HMAC-SHA256 before processing
- Microsoft OAuth tokens are stored AES-256-GCM encrypted — never in plaintext
- GitHub and GitLab `owner`/`repo` URL parameters are validated with regex to prevent path traversal
- File uploads are limited to 50 MB; text extraction is capped at 50 KB

---

*Built with React, Fastify, Supabase, and Claude.*
