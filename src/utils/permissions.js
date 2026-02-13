export const PERMISSION_KEYS = Object.freeze({
  APP_WAREHOUSE: "app.warehouse",
  APP_TMC: "app.tmc",
  APP_ADMIN: "app.admin",

  WAREHOUSE_REQUESTS: "warehouse.requests",
  WAREHOUSE_TASKS: "warehouse.tasks",
  WAREHOUSE_INVENTORY: "warehouse.inventory",
  WAREHOUSE_MOVEMENT: "warehouse.movement",
  WAREHOUSE_TRANSACTIONS: "warehouse.transactions",
  WAREHOUSE_REVISION: "warehouse.revision",
  WAREHOUSE_SUPPLIERS: "warehouse.suppliers",
  WAREHOUSE_LOCATIONS: "warehouse.locations",
  WAREHOUSE_QUEUE: "warehouse.queue",
  WAREHOUSE_TSD: "warehouse.tsd",
  WAREHOUSE_ORDERS: "warehouse.orders",
  WAREHOUSE_MANAGE: "warehouse.manage",

  TSD_RECEIVING: "tsd.receiving",
  TSD_PUTAWAY: "tsd.putaway",
  TSD_MOVE: "tsd.move",
  TSD_COUNT: "tsd.count",
  TSD_BIN: "tsd.bin",
  TSD_REPLENISH: "tsd.replenish",
  TSD_PICK: "tsd.pick",
  TSD_DISCREPANCIES: "tsd.discrepancies",

  ADMIN_USERS: "admin.users",
  ADMIN_WAREHOUSE: "admin.warehouse",
  ADMIN_SETTINGS: "admin.settings",
  ADMIN_TENANTS: "admin.tenants",
});

export const PERMISSION_LABELS = Object.freeze({
  [PERMISSION_KEYS.APP_WAREHOUSE]: "Склад",
  [PERMISSION_KEYS.APP_TMC]: "ТМЦ и РМ",
  [PERMISSION_KEYS.APP_ADMIN]: "Администрирование",

  [PERMISSION_KEYS.WAREHOUSE_REQUESTS]: "Заявки",
  [PERMISSION_KEYS.WAREHOUSE_TASKS]: "Задачи склада",
  [PERMISSION_KEYS.WAREHOUSE_INVENTORY]: "Остатки",
  [PERMISSION_KEYS.WAREHOUSE_MOVEMENT]: "История движений",
  [PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS]: "Транзакции",
  [PERMISSION_KEYS.WAREHOUSE_REVISION]: "Ревизия",
  [PERMISSION_KEYS.WAREHOUSE_SUPPLIERS]: "Поставщики и заказы",
  [PERMISSION_KEYS.WAREHOUSE_LOCATIONS]: "Справочник ячеек",
  [PERMISSION_KEYS.WAREHOUSE_QUEUE]: "Очередь поставщиков",
  [PERMISSION_KEYS.WAREHOUSE_TSD]: "Мобильный ТСД",
  [PERMISSION_KEYS.WAREHOUSE_ORDERS]: "Заказы клиентов (отбор)",
  [PERMISSION_KEYS.WAREHOUSE_MANAGE]: "Управление складом",

  [PERMISSION_KEYS.TSD_RECEIVING]: "ТСД: Приемка",
  [PERMISSION_KEYS.TSD_PUTAWAY]: "ТСД: Размещение",
  [PERMISSION_KEYS.TSD_MOVE]: "ТСД: Перемещение",
  [PERMISSION_KEYS.TSD_COUNT]: "ТСД: Инвентаризация",
  [PERMISSION_KEYS.TSD_BIN]: "ТСД: Контроль ячейки",
  [PERMISSION_KEYS.TSD_REPLENISH]: "ТСД: Подпитка",
  [PERMISSION_KEYS.TSD_PICK]: "ТСД: Отбор",
  [PERMISSION_KEYS.TSD_DISCREPANCIES]: "ТСД: Косяки",

  [PERMISSION_KEYS.ADMIN_USERS]: "Админ: Пользователи",
  [PERMISSION_KEYS.ADMIN_WAREHOUSE]: "Админ: Склад",
  [PERMISSION_KEYS.ADMIN_SETTINGS]: "Админ: Настройки",
  [PERMISSION_KEYS.ADMIN_TENANTS]: "Админ: Клиенты SaaS",
});

export const PERMISSION_GROUPS = Object.freeze([
  {
    id: "apps",
    label: "Разделы портала",
    keys: [
      PERMISSION_KEYS.APP_WAREHOUSE,
      PERMISSION_KEYS.APP_TMC,
      PERMISSION_KEYS.APP_ADMIN,
    ],
  },
  {
    id: "warehouse",
    label: "Склад",
    keys: [
      PERMISSION_KEYS.WAREHOUSE_REQUESTS,
      PERMISSION_KEYS.WAREHOUSE_TASKS,
      PERMISSION_KEYS.WAREHOUSE_INVENTORY,
      PERMISSION_KEYS.WAREHOUSE_MOVEMENT,
      PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS,
      PERMISSION_KEYS.WAREHOUSE_REVISION,
      PERMISSION_KEYS.WAREHOUSE_SUPPLIERS,
      PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
      PERMISSION_KEYS.WAREHOUSE_QUEUE,
      PERMISSION_KEYS.WAREHOUSE_TSD,
      PERMISSION_KEYS.WAREHOUSE_ORDERS,
      PERMISSION_KEYS.WAREHOUSE_MANAGE,
    ],
  },
  {
    id: "tsd",
    label: "Мобильный ТСД",
    keys: [
      PERMISSION_KEYS.TSD_RECEIVING,
      PERMISSION_KEYS.TSD_PUTAWAY,
      PERMISSION_KEYS.TSD_MOVE,
      PERMISSION_KEYS.TSD_COUNT,
      PERMISSION_KEYS.TSD_BIN,
      PERMISSION_KEYS.TSD_REPLENISH,
      PERMISSION_KEYS.TSD_PICK,
      PERMISSION_KEYS.TSD_DISCREPANCIES,
    ],
  },
  {
    id: "admin",
    label: "Администрирование",
    keys: [
      PERMISSION_KEYS.ADMIN_USERS,
      PERMISSION_KEYS.ADMIN_WAREHOUSE,
      PERMISSION_KEYS.ADMIN_SETTINGS,
      PERMISSION_KEYS.ADMIN_TENANTS,
    ],
  },
]);

export const PERMISSION_TEMPLATES = Object.freeze([
  { id: "ROLE_DEFAULT", label: "По роли" },
  { id: "WAREHOUSE_PICKER", label: "Склад: Отбор" },
  { id: "WAREHOUSE_TSD", label: "Склад: Весь ТСД" },
  { id: "WAREHOUSE_FULL", label: "Склад: Полный" },
  { id: "BACKOFFICE", label: "Офис: склад без ТСД" },
]);

export const WAREHOUSE_SECTION_PERMISSION_MAP = Object.freeze({
  requests: PERMISSION_KEYS.WAREHOUSE_REQUESTS,
  tasks: PERMISSION_KEYS.WAREHOUSE_TASKS,
  inventory: PERMISSION_KEYS.WAREHOUSE_INVENTORY,
  movement: PERMISSION_KEYS.WAREHOUSE_MOVEMENT,
  transactions: PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS,
  revision: PERMISSION_KEYS.WAREHOUSE_REVISION,
  suppliers: PERMISSION_KEYS.WAREHOUSE_SUPPLIERS,
  locations: PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
  queue: PERMISSION_KEYS.WAREHOUSE_QUEUE,
  tsd: PERMISSION_KEYS.WAREHOUSE_TSD,
  tmc: PERMISSION_KEYS.APP_TMC,
});

export const TSD_MODE_PERMISSION_MAP = Object.freeze({
  receiving: PERMISSION_KEYS.TSD_RECEIVING,
  putaway: PERMISSION_KEYS.TSD_PUTAWAY,
  move: PERMISSION_KEYS.TSD_MOVE,
  count: PERMISSION_KEYS.TSD_COUNT,
  bin: PERMISSION_KEYS.TSD_BIN,
  replenish: PERMISSION_KEYS.TSD_REPLENISH,
  pick: PERMISSION_KEYS.TSD_PICK,
  discrepancies: PERMISSION_KEYS.TSD_DISCREPANCIES,
});

export function hasPermission(user, permissionKey) {
  if (!permissionKey) return true;
  if (user?.isSystemOwner) return true;
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return userPermissions.includes(permissionKey);
}

export function hasAnyPermission(user, permissionKeys = []) {
  if (user?.isSystemOwner) return true;
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  return permissionKeys.some((key) => hasPermission(user, key));
}
