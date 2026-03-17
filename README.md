# Odyssey

A unified project intelligence platform. One place for everything your team touches — and an AI that maps how it all came together.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript |
| Styling | Tailwind CSS |
| Backend | Node + Fastify (TypeScript) |
| Database & Auth | Supabase (PostgreSQL) |
| AI | Claude Sonnet (Anthropic API) |
| Hosting | Vercel (frontend) + Railway (API) |

## Getting Started

### Prerequisites
- Node.js 20+
- A Supabase project (free tier works)

### Frontend
```bash
cd client
cp .env.example .env.local   # Add your Supabase keys
npm install
npm run dev
```

### Backend
```bash
cd server
cp .env.example .env          # Add your keys
npm install
npm run dev
```

### Database
Run `supabase/schema.sql` in your Supabase SQL Editor to create all tables.

## Project Structure

```
odyssey/
├── client/              # React frontend (Vite + TypeScript)
│   └── src/
│       ├── components/  # Reusable UI components
│       ├── lib/         # Supabase client, auth context
│       ├── pages/       # Route pages
│       └── types/       # TypeScript interfaces
├── server/              # Fastify backend (TypeScript)
│   └── src/
│       └── routes/      # API route handlers
└── supabase/
    └── schema.sql       # Database schema
```

Odyssey Project Management
