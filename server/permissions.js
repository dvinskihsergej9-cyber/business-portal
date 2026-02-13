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

const WAREHOUSE_SECTION_PERMISSIONS = [
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
];

const TSD_MODE_PERMISSIONS = [
  PERMISSION_KEYS.TSD_RECEIVING,
  PERMISSION_KEYS.TSD_PUTAWAY,
  PERMISSION_KEYS.TSD_MOVE,
  PERMISSION_KEYS.TSD_COUNT,
  PERMISSION_KEYS.TSD_BIN,
  PERMISSION_KEYS.TSD_REPLENISH,
  PERMISSION_KEYS.TSD_PICK,
  PERMISSION_KEYS.TSD_DISCREPANCIES,
];

export const ALL_PERMISSION_KEYS = Object.freeze([
  PERMISSION_KEYS.APP_WAREHOUSE,
  PERMISSION_KEYS.APP_TMC,
  PERMISSION_KEYS.APP_ADMIN,
  ...WAREHOUSE_SECTION_PERMISSIONS,
  ...TSD_MODE_PERMISSIONS,
  PERMISSION_KEYS.WAREHOUSE_MANAGE,
  PERMISSION_KEYS.ADMIN_USERS,
  PERMISSION_KEYS.ADMIN_WAREHOUSE,
  PERMISSION_KEYS.ADMIN_SETTINGS,
  PERMISSION_KEYS.ADMIN_TENANTS,
]);

const ALL_PERMISSION_SET = new Set(ALL_PERMISSION_KEYS);

const EMPLOYEE_BASE = [
  PERMISSION_KEYS.APP_WAREHOUSE,
  PERMISSION_KEYS.APP_TMC,
  ...WAREHOUSE_SECTION_PERMISSIONS,
  ...TSD_MODE_PERMISSIONS,
];

const ACCOUNTING_BASE = [...EMPLOYEE_BASE, PERMISSION_KEYS.WAREHOUSE_MANAGE];

const ADMIN_BASE = [...ALL_PERMISSION_KEYS];

const WAREHOUSE_BASE = [
  PERMISSION_KEYS.APP_WAREHOUSE,
  PERMISSION_KEYS.WAREHOUSE_INVENTORY,
  PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
  PERMISSION_KEYS.WAREHOUSE_TSD,
  PERMISSION_KEYS.WAREHOUSE_ORDERS,
  ...TSD_MODE_PERMISSIONS,
];

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  EMPLOYEE: EMPLOYEE_BASE,
  HR: EMPLOYEE_BASE,
  ACCOUNTING: ACCOUNTING_BASE,
  WAREHOUSE: WAREHOUSE_BASE,
  ADMIN: ADMIN_BASE,
  LOADER: [
    PERMISSION_KEYS.APP_WAREHOUSE,
    PERMISSION_KEYS.WAREHOUSE_TSD,
    PERMISSION_KEYS.WAREHOUSE_ORDERS,
    PERMISSION_KEYS.TSD_PICK,
  ],
});

export const PERMISSION_TEMPLATES = Object.freeze({
  ROLE_DEFAULT: {
    id: "ROLE_DEFAULT",
    label: "По роли",
    permissions: [],
  },
  WAREHOUSE_PICKER: {
    id: "WAREHOUSE_PICKER",
    label: "Склад: Отбор",
    permissions: [
      PERMISSION_KEYS.APP_WAREHOUSE,
      PERMISSION_KEYS.WAREHOUSE_TSD,
      PERMISSION_KEYS.WAREHOUSE_ORDERS,
      PERMISSION_KEYS.TSD_PICK,
    ],
  },
  WAREHOUSE_TSD: {
    id: "WAREHOUSE_TSD",
    label: "Склад: Весь ТСД",
    permissions: [
      PERMISSION_KEYS.APP_WAREHOUSE,
      PERMISSION_KEYS.WAREHOUSE_TSD,
      PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
      PERMISSION_KEYS.WAREHOUSE_ORDERS,
      ...TSD_MODE_PERMISSIONS,
    ],
  },
  WAREHOUSE_FULL: {
    id: "WAREHOUSE_FULL",
    label: "Склад: Полный",
    permissions: [
      PERMISSION_KEYS.APP_WAREHOUSE,
      ...WAREHOUSE_SECTION_PERMISSIONS,
      ...TSD_MODE_PERMISSIONS,
      PERMISSION_KEYS.WAREHOUSE_MANAGE,
    ],
  },
  BACKOFFICE: {
    id: "BACKOFFICE",
    label: "Офис: склад без ТСД",
    permissions: [
      PERMISSION_KEYS.APP_WAREHOUSE,
      PERMISSION_KEYS.APP_TMC,
      PERMISSION_KEYS.WAREHOUSE_REQUESTS,
      PERMISSION_KEYS.WAREHOUSE_TASKS,
      PERMISSION_KEYS.WAREHOUSE_INVENTORY,
      PERMISSION_KEYS.WAREHOUSE_MOVEMENT,
      PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS,
      PERMISSION_KEYS.WAREHOUSE_REVISION,
      PERMISSION_KEYS.WAREHOUSE_SUPPLIERS,
      PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
      PERMISSION_KEYS.WAREHOUSE_QUEUE,
    ],
  },
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

const normalizeList = (value) => {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  for (const item of value) {
    const key = String(item || "").trim();
    if (!key || !ALL_PERMISSION_SET.has(key)) continue;
    unique.add(key);
  }
  return Array.from(unique);
};

export function normalizePermissionConfig(rawValue) {
  const empty = {
    template: "ROLE_DEFAULT",
    grants: [],
    revokes: [],
  };

  if (!rawValue) return empty;

  let parsed = rawValue;
  if (typeof rawValue === "string") {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return empty;
    }
  }

  if (!parsed || typeof parsed !== "object") return empty;

  const template = String(parsed.template || "ROLE_DEFAULT").trim();
  const safeTemplate = PERMISSION_TEMPLATES[template] ? template : "ROLE_DEFAULT";

  const grants = normalizeList(parsed.grants);
  const revokes = normalizeList(parsed.revokes).filter((key) => !grants.includes(key));

  return {
    template: safeTemplate,
    grants,
    revokes,
  };
}

export function stringifyPermissionConfig(config) {
  return JSON.stringify(normalizePermissionConfig(config));
}

function resolveTemplatePermissions(templateId, role) {
  if (templateId && templateId !== "ROLE_DEFAULT") {
    const template = PERMISSION_TEMPLATES[templateId];
    if (template) return template.permissions;
  }
  return ROLE_DEFAULT_PERMISSIONS[String(role || "").trim()] || ROLE_DEFAULT_PERMISSIONS.EMPLOYEE;
}

export function resolveUserPermissions({ role, permissionsJson, isSystemOwner = false }) {
  if (isSystemOwner) {
    return [...ALL_PERMISSION_KEYS];
  }

  const config = normalizePermissionConfig(permissionsJson);
  const base = resolveTemplatePermissions(config.template, role);

  const result = new Set(base);
  for (const key of config.grants) result.add(key);
  for (const key of config.revokes) result.delete(key);

  return Array.from(result);
}

export function hasPermission(user, permissionKey) {
  if (!permissionKey) return true;
  if (user?.isSystemOwner) return true;
  const keys = Array.isArray(user?.permissions) ? user.permissions : [];
  return keys.includes(permissionKey);
}

export function hasAnyPermission(user, permissionKeys = []) {
  if (user?.isSystemOwner) return true;
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  return permissionKeys.some((key) => hasPermission(user, key));
}

export function getPermissionCatalog() {
  return {
    permissions: [...ALL_PERMISSION_KEYS],
    roleDefaults: Object.fromEntries(
      Object.entries(ROLE_DEFAULT_PERMISSIONS).map(([role, keys]) => [
        role,
        [...keys],
      ])
    ),
    groups: PERMISSION_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      keys: [...group.keys],
    })),
    templates: Object.values(PERMISSION_TEMPLATES).map((tpl) => ({
      id: tpl.id,
      label: tpl.label,
      permissions: [...tpl.permissions],
    })),
  };
}
