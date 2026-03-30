# Pallet / LPN Contour

Отдельный паллетный контур для Mobile TSD, изолированный от товарного учета.

## Что важно
- Единица учета: паллета (`palletCode` / LPN).
- Если внешнего SSCC нет, система генерирует внутренний `palletCode`.
- Все дальнейшие операции только по скану `palletCode`.
- Этот контур не пишет `StockMovement` и не влияет на остатки по SKU.

## Модели Prisma
- `Pallet`
  - ключевые поля: `orgId`, `palletCode`, `externalCode`, `status`, `currentLocationId`, `receivedAt`, `storedAt`, `dispatchedAt`, `createdByUserId`.
- `PalletLocation`
  - отдельный справочник паллетных зон (`code`, `name`), не связан с `WarehouseLocation`.
- `PalletEvent`
  - журнал операций: `CREATE`, `RECEIVE`, `STORE`, `MOVE`, `DISPATCH`, `CANCEL`.
- `PalletDispatch`
  - данные отгрузки: `destinationRc`, `route`, `vehicle`, `driver`, `notes`, `dispatchedByUserId`, `dispatchedAt`.

## API
- `POST /api/pallets/receive`
  - создает паллету в `RECEIVED`,
  - генерирует `palletCode`,
  - пишет события `CREATE` + `RECEIVE`,
  - возвращает данные для печати.
- `POST /api/pallets/store`
  - вход: `palletCode`, `locationCode`,
  - допускает только `RECEIVED`/`STORED`,
  - обновляет зону/статус (`STORED`),
  - пишет `STORE` или `MOVE`.
- `POST /api/pallets/dispatch`
  - вход: `palletCode`, `destinationRc` (+ optional поля),
  - допускает только `STORED`,
  - создает `PalletDispatch`,
  - переводит в `DISPATCHED`,
  - пишет `DISPATCH`.
- `GET /api/pallets`
  - фильтры: `status`, `locationCode`, `inboundRef`, `supplierName`, `dateFrom`, `dateTo`.
- `GET /api/pallets/:palletCode/history`
  - возвращает карточку паллеты и ленту событий.

## Печать этикетки
- `POST /api/pallets/print-label`
- QR payload: `bp:pallet:<palletCode>`
- Формат по умолчанию: `LABEL_75X50` (опционально `A6`)
- На этикетке печатаются:
  - крупный QR,
  - текстовый `palletCode` (для ручного ввода),
  - дополнительные данные (`supplierName`, `inboundRef`, если заданы).

## Mobile TSD
Режим `Паллеты` добавлен в `Mobile TSD` и содержит вкладки:
- `Приемка` — создание паллеты и печать.
- `Размещение` — скан паллеты + скан зоны.
- `Отгрузка` — скан паллеты + РЦ назначения.
- `Поиск` — поиск по коду, просмотр статуса и истории событий.

## Конкурентность и защита от ошибок
- Дубли по внешнему коду блокируются (`409`).
- Отгрузка разрешена только из `STORED` (`409` иначе).
- Критичные изменения выполняются в транзакциях Prisma.
- От двойной параллельной отгрузки защищает повторная проверка состояния в транзакции.
