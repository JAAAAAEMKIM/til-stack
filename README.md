# TIL Stack

A full-stack "Today I Learned" journal application built with a modern TypeScript stack.

## Tech Stack

- **Frontend**: React 19, TanStack Router, TanStack Query, Tailwind CSS, Rspack
- **Backend**: Hono, tRPC, Drizzle ORM, SQLite
- **Monorepo**: pnpm workspaces

## Prerequisites

- Node.js 20+
- pnpm 8+

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/JAAAAAEMKIM/til-stack.git
cd til-stack
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root directory:

```bash
NODE_ENV=development
DATABASE_PATH=./data/local.db
PORT=3001
API_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:3000
```

### 4. Build the shared package

```bash
pnpm --filter @til-stack/shared build
```

### 5. Run database migrations

```bash
pnpm db:migrate
```

### 6. Start the development server

```bash
pnpm dev
```

This starts both:
- API server at `http://localhost:3001`
- Web app at `http://localhost:3000`

## Project Structure

```
til-stack/
├── apps/
│   ├── api/          # Hono + tRPC backend
│   └── web/          # React frontend
├── packages/
│   └── shared/       # Shared types and validators
└── pnpm-workspace.yaml
```

## Available Scripts

```bash
pnpm dev          # Run both API and web in development mode
pnpm build        # Build all packages
pnpm db:migrate   # Run database migrations
pnpm lint         # Lint all packages
```

## Features

- **Daily journaling** with markdown support and syntax highlighting
- **Monthly calendar view** with weekly summaries
- **AI-powered summaries** via multiple backends (Gemini Nano, WebLLM, Groq, Google AI)
- **Skip days configuration** for weekends/holidays
- **Templates** for consistent entry structure
- **Dark mode** with system preference detection
- **Auto-save drafts** to prevent data loss
