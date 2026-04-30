# Памятка для нового чата (актуально на 14.04.2026)

## Репозиторий и ветки
- Repo: `dvinskihsergej9-cyber/business-portal`
- `main` обновлен и запушен до коммита: `af8e7f1`
- Новая рабочая ветка: `pr/crossdock-next-20260414-postmain`

## Что уже влито в main
- Оплата YooKassa:
  - периоды `1m/6m/12m`,
  - валидация суммы/срока в status и webhook,
  - старт-тариф только `1m` и только один раз на организацию,
  - checkout через естественный выбор способа оплаты на стороне YooKassa.
- Почта:
  - исправлен поток верификации,
  - добавлены failover-попытки SMTP.
- Публичные страницы:
  - цены синхронизированы (`1 / 2990 / 6990`),
- исправлен домен в контактах на `https://app.skladonline74.ru`,
  - усилены юридические разделы для модерации YooKassa (`offer/privacy/refund/contacts`),
  - добавлена публичная ссылка на YooKassa на лендинге.

## Текущая инфраструктура (Timeweb)
- Web-домен: `https://app.skladonline74.ru`
- API-домен: `https://api.skladonline74.ru`

## Что осталось сделать (приоритет)
1. Задеплоить web с актуального `main`, чтобы модерация видела новые страницы.
2. В `business-portal-api` задать env с реальными значениями:
   - `YOOKASSA_SHOP_ID`
   - `YOOKASSA_SECRET_KEY`
  - `FRONTEND_URL=https://app.skladonline74.ru`
  - `APP_URL=https://app.skladonline74.ru`
3. Выполнить redeploy `business-portal-api`.
4. Проверить `https://api.skladonline74.ru/api/billing/config`:
   - должно вернуть `{ "yookassaEnabled": true }`.
5. Проверить webhook в кабинете YooKassa:
   - `https://api.skladonline74.ru/api/billing/yookassa/webhook`.
6. Выполнить redeploy `skladonline-web` (если ещё не делали после merge в `main`).
7. Прогнать smoke по оплате:
   - создание платежа,
   - редирект в YooKassa,
   - возврат на `/subscribe/return`,
   - продление подписки на `30/180/360` дней.

## Важные заметки
- Не коммитить: `dist/`, `docs/`, `tools/scripts/`, `tools/snippets/`, `.vercel/`, `node_modules/`.
- `dist/` может быть untracked после сборок — это нормально.
- Старый VPS `Humble Raven` не удалять до подтверждения стабильной работы минимум 24 часа.
