# SkladOnline Marketing Site (Separate Frontend)

Отдельный маркетинговый сайт для СкладОнлайн.
Рабочий кабинет не дублируется: вход и все рабочие разделы ведут в основное приложение.

## Architecture

- Separate frontend app: Next.js + TypeScript + Tailwind (`site/`)
- Shared backend: existing Express API (`/server/index.js`)
- Shared database: existing PostgreSQL + Prisma (`/prisma/schema.prisma`)
- Single source of truth: backend + DB остаются одни и те же
- Operational routes on site (`/login`, `/register`, `/dashboard`, etc.) auto-redirect to main app URL

## Main Pages

- Marketing homepage (`/`)
- Legal pages: `/offer`, `/privacy`, `/contacts`, `/refund`

## Folder Structure

```txt
site/
  app/
    api/
      auth/
      proxy/[...path]/
      realtime/stream/
  components/
  hooks/
  services/
  store/
  types/
  lib/
  public/
  proxy.ts
  .env.example
```

## Setup

1. Install dependencies:

```bash
cd site
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Run development server:

```bash
npm run dev
```

4. Open:

- Site: `http://localhost:3000`

## Required Env

- `BACKEND_API_BASE` — existing backend API URL
- `APP_PUBLIC_URL` — existing main app URL (redirect target for login/cabinet)
