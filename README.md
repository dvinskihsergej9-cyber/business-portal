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

## ENV (обязательные)
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_URL`
- `APP_URL`
- `VITE_API_BASE` (origin без `/api`)
- `YOOKASSA_SHOP_ID`
- `YOOKASSA_SECRET_KEY`

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
