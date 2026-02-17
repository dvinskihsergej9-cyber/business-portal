# Business Portal (архивная база + восстановление мобильного и оплаты)

## Локальный запуск
```
npm install
npm run dev
```

Сборка:
```
npm run build
```

## Render deploy (MVP)
Build Command:
```
npm install && npm run db:deploy
```

Start Command:
```
npm run api
```

## ENV (обязательные)
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `APP_URL`
- `VITE_API_BASE` (origin без `/api`)
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`

### Vercel / Preview без VITE_API_BASE
- Если `VITE_API_BASE` не задан:
  - в DEV используется `http(s)://<host>:3001/api`
  - в PROD/preview fallback: `https://business-portal-8nba.onrender.com/api`
- Рекомендуется всё равно явно задать `VITE_API_BASE` в Vercel.

## ENV (email, опционально)
- `MAIL_HOST`
- `MAIL_PORT`
- `MAIL_SECURE`
- `MAIL_USER`
- `MAIL_PASS`
- `MAIL_FROM`

## YooKassa webhook
```
POST https://your-api-domain/api/billing/yookassa/webhook
```

Return URL берётся из `APP_URL`:
```
${APP_URL}/subscribe/return?paymentId=...
```

## СБП (YooKassa)
1) Включите метод оплаты "СБП" в кабинете YooKassa для магазина.
2) Убедитесь, что webhook настроен на `payment.succeeded`:
```
POST https://your-api-domain/api/billing/yookassa/webhook
```

## Test EMPLOYEE (trial)
Option 1 (seed):
```
npm run seed
```
Creates or updates:
- email: employee@test.local
- password: Test12345!
- role: EMPLOYEE

Option 2 (admin API):
- POST /api/admin/create-employee (ADMIN only)
- Or use Admin -> Settings -> Create test EMPLOYEE button.

## Smoke check
```
SMOKE_API_BASE=http://localhost:3001/api \
SMOKE_ADMIN_EMAIL=admin@example.com \
SMOKE_ADMIN_PASSWORD=adminpass \
SMOKE_EMPLOYEE_EMAIL=employee@test.local \
SMOKE_EMPLOYEE_PASSWORD=Test12345! \
npm run smoke
```

## Smoke seed (локально, опционально)
```
SMOKE_SEED=true \
SMOKE_API_BASE=http://localhost:3001/api \
SMOKE_ADMIN_EMAIL=admin@test.local \
SMOKE_ADMIN_PASSWORD=Test12345! \
SMOKE_EMPLOYEE_EMAIL=employee@test.local \
SMOKE_EMPLOYEE_PASSWORD=Test12345! \
npm run smoke
```

## E2E (Playwright)
Установить браузер:
```
npm run e2e:install
```

Запуск (в разных терминалах):
```
npm run api
npm run build
npm run preview -- --host --port 4173
```

E2E:
```
E2E_BASE_URL=http://localhost:4173 \
E2E_ADMIN_EMAIL=admin@test.local \
E2E_ADMIN_PASSWORD=Test12345! \
E2E_EMPLOYEE_EMAIL=employee@test.local \
E2E_EMPLOYEE_PASSWORD=Test12345! \
npm run e2e
```


RESET_INVENTORY_ON_DEPLOY: optional, default false. Set true to reset inventory once per deploy revision.

## Important: persistent database in production
- Do not use `DATABASE_URL=file:./dev.db` on Render/Vercel backend runtime.
- SQLite file storage is ephemeral in stateless containers and data will be lost after restart/redeploy.
- For production SaaS use PostgreSQL (`postgresql://...`) in `DATABASE_URL`.
