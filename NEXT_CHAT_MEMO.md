# Памятка для нового чата (актуально на 14.04.2026)

## Репозиторий и ветки
- Repo: `dvinskihsergej9-cyber/business-portal`
- `main` обновлен и запушен до коммита: `eff9f4c`
- Новая рабочая ветка: `pr/crossdock-next-20260414`

## Что уже влито в main
- Почта/SMTP: исправлена отправка кода подтверждения, добавлены failover-порты и прозрачные ошибки.
- Оплата YooKassa:
  - периоды оплаты `1m/6m/12m` с корректной суммой/сроком,
  - проверка суммы/метаданных в status/webhook,
  - старт-тариф только для `1m`,
  - старт-тариф ограничен "1 раз на организацию".
- Публичные страницы:
  - исправлен UTF-8 в `SubscribeReturn`,
  - цены на лендинге синхронизированы с тарифами: `1 / 2990 / 6990`.

## Текущая инфраструктура (Timeweb)
- Web-домен: `https://skladonline74.ru`
- API-домен: `https://api.skladonline74.ru`
- Проверка DNS и доступности уже проходила: оба домена резолвятся корректно.

## Что осталось сделать (приоритет)
1. В `business-portal-api` задать env с реальными значениями:
   - `YOOKASSA_SHOP_ID`
   - `YOOKASSA_SECRET_KEY`
   - `FRONTEND_URL=https://skladonline74.ru`
   - `APP_URL=https://skladonline74.ru`
2. Перезапустить деплой `business-portal-api`.
3. Проверить `https://api.skladonline74.ru/api/billing/config`:
   - должно вернуть `{ "yookassaEnabled": true }`.
4. В кабинете YooKassa задать webhook:
   - `https://api.skladonline74.ru/api/billing/yookassa/webhook`
5. На web-приложении (`skladonline-web`) проверить env:
   - `VITE_API_BASE=https://api.skladonline74.ru`
   - и выполнить redeploy.
6. Прогнать ручной smoke по оплате:
   - создание платежа,
   - редирект в YooKassa,
   - возврат на `/subscribe/return`,
   - продление подписки на нужный срок.

## Важные заметки
- Не коммитить: `dist/`, `docs/`, `tools/scripts/`, `tools/snippets/`, `.vercel/`, `node_modules/`.
- `dist/` в рабочем дереве может быть untracked после сборок — это нормально, не добавлять в git.
- Старый VPS `Humble Raven` пока не удалять до финального подтверждения, что всё стабильно работает на App Platform (web + api + боты).
