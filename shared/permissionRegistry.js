const GROUP_DEFINITIONS = Object.freeze([
  { id: "apps", label: "Разделы портала" },
  { id: "warehouse", label: "Склад" },
  { id: "tsd", label: "Мобильный ТСД" },
  { id: "admin", label: "Администрирование" },
]);

const ENTRY_DEFINITIONS = Object.freeze([
  {
    id: "APP_WAREHOUSE",
    key: "app.warehouse",
    label: "Склад",
    groupId: "apps",
  },
  {
    id: "APP_ADMIN",
    key: "app.admin",
    label: "Администрирование",
    groupId: "apps",
  },
  {
    id: "WAREHOUSE_REQUESTS",
    key: "warehouse.requests",
    label: "Заявки",
    groupId: "warehouse",
    warehouseSection: "requests",
  },
  {
    id: "WAREHOUSE_TASKS",
    key: "warehouse.tasks",
    label: "Задачи склада",
    groupId: "warehouse",
    warehouseSection: "tasks",
  },
  {
    id: "WAREHOUSE_INVENTORY",
    key: "warehouse.inventory",
    label: "Остатки",
    groupId: "warehouse",
    warehouseSection: "inventory",
  },
  {
    id: "WAREHOUSE_MOVEMENT",
    key: "warehouse.movement",
    label: "История движений",
    groupId: "warehouse",
    warehouseSection: "movement",
  },
  {
    id: "WAREHOUSE_TRANSACTIONS",
    key: "warehouse.transactions",
    label: "Транзакции",
    groupId: "warehouse",
    warehouseSection: "transactions",
  },
  {
    id: "WAREHOUSE_REVISION",
    key: "warehouse.revision",
    label: "Ревизия",
    groupId: "warehouse",
    warehouseSection: "revision",
  },
  {
    id: "WAREHOUSE_SUPPLIERS",
    key: "warehouse.suppliers",
    label: "Поставщики и заказы",
    groupId: "warehouse",
    warehouseSection: "suppliers",
  },
  {
    id: "WAREHOUSE_LOCATIONS",
    key: "warehouse.locations",
    label: "Справочник ячеек",
    groupId: "warehouse",
    warehouseSection: "locations",
  },
  {
    id: "WAREHOUSE_QUEUE",
    key: "warehouse.queue",
    label: "Очередь поставщиков",
    groupId: "warehouse",
    warehouseSection: "queue",
  },
  {
    id: "WAREHOUSE_TSD",
    key: "warehouse.tsd",
    label: "Мобильный ТСД",
    groupId: "warehouse",
    warehouseSection: "tsd",
  },
  {
    id: "WAREHOUSE_ORDERS",
    key: "warehouse.orders",
    label: "Заказы клиентов (отбор)",
    groupId: "warehouse",
    warehouseSection: "orders",
  },
  {
    id: "WAREHOUSE_MANAGE",
    key: "warehouse.manage",
    label: "Управление складом",
    groupId: "warehouse",
  },
  {
    id: "TSD_RECEIVING",
    key: "tsd.receiving",
    label: "ТСД: Приемка",
    groupId: "tsd",
    tsdMode: "receiving",
  },
  {
    id: "TSD_PUTAWAY",
    key: "tsd.putaway",
    label: "ТСД: Размещение",
    groupId: "tsd",
    tsdMode: "putaway",
  },
  {
    id: "TSD_MOVE",
    key: "tsd.move",
    label: "ТСД: Перемещение",
    groupId: "tsd",
    tsdMode: "move",
  },
  {
    id: "TSD_COUNT",
    key: "tsd.count",
    label: "ТСД: Инвентаризация",
    groupId: "tsd",
    tsdMode: "count",
  },
  {
    id: "TSD_BIN",
    key: "tsd.bin",
    label: "ТСД: Контроль ячейки",
    groupId: "tsd",
    tsdMode: "bin",
  },
  {
    id: "TSD_REPLENISH",
    key: "tsd.replenish",
    label: "ТСД: Подпитка",
    groupId: "tsd",
    tsdMode: "replenish",
  },
  {
    id: "TSD_PICK",
    key: "tsd.pick",
    label: "ТСД: Отбор",
    groupId: "tsd",
    tsdMode: "pick",
  },
  {
    id: "TSD_SHIP",
    key: "tsd.ship",
    label: "ТСД: Отгрузка",
    groupId: "tsd",
    tsdMode: "ship",
  },
  {
    id: "TSD_PALLETS",
    key: "tsd.pallets",
    label: "\u0422\u0421\u0414: \u041f\u0430\u043b\u043b\u0435\u0442\u044b",
    groupId: "tsd",
    tsdMode: "pallets",
  },
  {
    id: "TSD_DISCREPANCIES",
    key: "tsd.discrepancies",
    label: "ТСД: Косяки",
    groupId: "tsd",
    tsdMode: "discrepancies",
  },
  {
    id: "ADMIN_USERS",
    key: "admin.users",
    label: "Админ: Пользователи",
    groupId: "admin",
  },
  {
    id: "ADMIN_WAREHOUSE",
    key: "admin.warehouse",
    label: "Админ: Склад",
    groupId: "admin",
  },
  {
    id: "ADMIN_TENANTS",
    key: "admin.tenants",
    label: "Админ: Клиенты SaaS",
    groupId: "admin",
    ownerOnly: true,
  },
]);

const ROLE_DEFAULT_PERMISSION_IDS = Object.freeze({
  EMPLOYEE: [
    "APP_WAREHOUSE",
    "WAREHOUSE_REQUESTS",
    "WAREHOUSE_TASKS",
    "WAREHOUSE_INVENTORY",
    "WAREHOUSE_MOVEMENT",
    "WAREHOUSE_TRANSACTIONS",
    "WAREHOUSE_REVISION",
    "WAREHOUSE_SUPPLIERS",
    "WAREHOUSE_LOCATIONS",
    "WAREHOUSE_QUEUE",
    "WAREHOUSE_TSD",
    "WAREHOUSE_ORDERS",
    "TSD_RECEIVING",
    "TSD_PUTAWAY",
    "TSD_MOVE",
    "TSD_COUNT",
    "TSD_BIN",
    "TSD_REPLENISH",
    "TSD_PICK",
    "TSD_SHIP",
    "TSD_PALLETS",
    "TSD_DISCREPANCIES",
  ],
  ADMIN: ENTRY_DEFINITIONS.map((entry) => entry.id),
});

const TEMPLATE_DEFINITIONS = Object.freeze([
  {
    id: "ROLE_DEFAULT",
    label: "По роли",
    permissionIds: [],
  },
  {
    id: "WAREHOUSE_PICKER",
    label: "Склад: Отбор",
    permissionIds: [
      "APP_WAREHOUSE",
      "WAREHOUSE_TSD",
      "WAREHOUSE_ORDERS",
      "TSD_PICK",
      "TSD_SHIP",
    ],
  },
  {
    id: "WAREHOUSE_TSD",
    label: "Склад: Весь ТСД",
    permissionIds: [
      "APP_WAREHOUSE",
      "WAREHOUSE_TSD",
      "WAREHOUSE_LOCATIONS",
      "WAREHOUSE_ORDERS",
      "TSD_RECEIVING",
      "TSD_PUTAWAY",
      "TSD_MOVE",
      "TSD_COUNT",
      "TSD_BIN",
      "TSD_REPLENISH",
      "TSD_PICK",
      "TSD_SHIP",
      "TSD_PALLETS",
      "TSD_DISCREPANCIES",
    ],
  },
  {
    id: "WAREHOUSE_FULL",
    label: "Склад: Полный",
    permissionIds: [
      "APP_WAREHOUSE",
      "WAREHOUSE_REQUESTS",
      "WAREHOUSE_TASKS",
      "WAREHOUSE_INVENTORY",
      "WAREHOUSE_MOVEMENT",
      "WAREHOUSE_TRANSACTIONS",
      "WAREHOUSE_REVISION",
      "WAREHOUSE_SUPPLIERS",
      "WAREHOUSE_LOCATIONS",
      "WAREHOUSE_QUEUE",
      "WAREHOUSE_TSD",
      "WAREHOUSE_ORDERS",
      "WAREHOUSE_MANAGE",
      "TSD_RECEIVING",
      "TSD_PUTAWAY",
      "TSD_MOVE",
      "TSD_COUNT",
      "TSD_BIN",
      "TSD_REPLENISH",
      "TSD_PICK",
      "TSD_SHIP",
      "TSD_PALLETS",
      "TSD_DISCREPANCIES",
    ],
  },
  {
    id: "BACKOFFICE",
    label: "Офис: склад без ТСД",
    permissionIds: [
      "APP_WAREHOUSE",
      "WAREHOUSE_REQUESTS",
      "WAREHOUSE_TASKS",
      "WAREHOUSE_INVENTORY",
      "WAREHOUSE_MOVEMENT",
      "WAREHOUSE_TRANSACTIONS",
      "WAREHOUSE_REVISION",
      "WAREHOUSE_SUPPLIERS",
      "WAREHOUSE_LOCATIONS",
      "WAREHOUSE_QUEUE",
    ],
  },
]);

const unique = (values) => Array.from(new Set(values));

export const PERMISSION_KEYS = Object.freeze(
  Object.fromEntries(ENTRY_DEFINITIONS.map((entry) => [entry.id, entry.key]))
);

export const ALL_PERMISSION_KEYS = Object.freeze(
  ENTRY_DEFINITIONS.map((entry) => entry.key)
);

export const OWNER_ONLY_PERMISSION_KEYS = Object.freeze(
  ENTRY_DEFINITIONS.filter((entry) => entry.ownerOnly).map((entry) => entry.key)
);

const KEY_TO_LABEL = Object.freeze(
  Object.fromEntries(ENTRY_DEFINITIONS.map((entry) => [entry.key, entry.label]))
);

export const PERMISSION_LABELS = KEY_TO_LABEL;

const idToKey = (id) => PERMISSION_KEYS[id] || null;
const idsToKeys = (ids) =>
  unique(
    (Array.isArray(ids) ? ids : [])
      .map((id) => idToKey(id))
      .filter(Boolean)
  );

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROLE_DEFAULT_PERMISSION_IDS).map(([role, ids]) => [
      role,
      Object.freeze(idsToKeys(ids)),
    ])
  )
);

export const PERMISSION_TEMPLATES_MAP = Object.freeze(
  Object.fromEntries(
    TEMPLATE_DEFINITIONS.map((template) => [
      template.id,
      Object.freeze({
        id: template.id,
        label: template.label,
        permissions: Object.freeze(idsToKeys(template.permissionIds)),
      }),
    ])
  )
);

export const PERMISSION_TEMPLATES_LIST = Object.freeze(
  TEMPLATE_DEFINITIONS.map((template) =>
    Object.freeze({
      id: template.id,
      label: template.label,
    })
  )
);

export const PERMISSION_GROUPS = Object.freeze(
  GROUP_DEFINITIONS.map((group) => {
    const keys = ENTRY_DEFINITIONS
      .filter((entry) => entry.groupId === group.id)
      .map((entry) => entry.key);
    return Object.freeze({
      id: group.id,
      label: group.label,
      keys: Object.freeze(keys),
    });
  })
);

export const WAREHOUSE_SECTION_PERMISSION_MAP = Object.freeze(
  {
    ...Object.fromEntries(
      ENTRY_DEFINITIONS.filter((entry) => entry.warehouseSection).map((entry) => [
        entry.warehouseSection,
        entry.key,
      ])
    ),
    items: PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
    holds: PERMISSION_KEYS.WAREHOUSE_MANAGE,
  }
);

export const TSD_MODE_PERMISSION_MAP = Object.freeze(
  Object.fromEntries(
    ENTRY_DEFINITIONS.filter((entry) => entry.tsdMode).map((entry) => [
      entry.tsdMode,
      entry.key,
    ])
  )
);

