# Business Portal SaaS (MVP)

## Local setup
Do not commit `.env` into git.

3-step local run:
```
npm install
npm run db:migrate
npm run dev
```

Local PostgreSQL config:
```
DATABASE_URL=postgresql://user:password@localhost:5432/business_portal?schema=public
```

Dev-only test subscription:
- Available only in local/dev mode.
- Check: login -> open Billing or Pricing -> click “Activate test subscription (30 days)” -> paid pages open.

## Env variables
Required:
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `VITE_API_BASE` (обязательно для Preview/Production, origin без `/api`)
- `APP_URL`
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`

Optional (email):
- `MAIL_HOST`
- `MAIL_PORT`
- `MAIL_SECURE`
- `MAIL_REQUIRE_TLS`
- `MAIL_USER`
- `MAIL_PASS`
- `MAIL_FROM`

## Deploy env
Vercel (frontend):
- `VITE_API_BASE=https://business-portal-8nba.onrender.com`

Render (API):
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL=https://business-portal-weld.vercel.app`
- `APP_URL=https://business-portal-weld.vercel.app`
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`
- `MAIL_*` (optional)

## Staging/Prod checklist
1) Set all required env variables.
2) Run Prisma migrations:
```
npm run db:migrate
```
3) Portal news admin is available at `/admin/portal-news` for ADMIN users.
3) Configure YooKassa webhook URL:
```
POST https://your-api-domain/api/billing/yookassa/webhook
```
4) Make a test payment in YooKassa and verify `paidUntil` updated.
5) Check webhook logs in API output (billing.* events).

## Security notes
- Never commit `.env` into git.
- Rotate SMTP password (it was previously in the repo history).

## YooKassa webhook
Configure a webhook in YooKassa to:
```
POST https://your-api-domain/api/billing/yookassa/webhook
```

Return URL is set automatically from `APP_URL`:
```
${APP_URL}/subscribe/return?paymentId=...
```

## Manual checklist (MVP)
- Register or accept invite and login.
- Open `/pricing`, initiate payment, confirm redirect to YooKassa.
- Return to `/subscribe/return`, verify status shows success.
- Check `/api/me` for `subscription.isActive === true`.
- Verify API returns 402 for paid routes without active subscription.
