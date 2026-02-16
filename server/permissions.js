import {
  ALL_PERMISSION_KEYS,
  OWNER_ONLY_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_TEMPLATES_MAP,
  ROLE_DEFAULT_PERMISSIONS,
} from "../shared/permissionRegistry.js";

export {
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  ROLE_DEFAULT_PERMISSIONS,
};

export const PERMISSION_TEMPLATES = PERMISSION_TEMPLATES_MAP;

const ALL_PERMISSION_SET = new Set(ALL_PERMISSION_KEYS);
const OWNER_ONLY_PERMISSION_SET = new Set(OWNER_ONLY_PERMISSION_KEYS);

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
  return (
    ROLE_DEFAULT_PERMISSIONS[String(role || "").trim()] ||
    ROLE_DEFAULT_PERMISSIONS.EMPLOYEE
  );
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
  for (const key of OWNER_ONLY_PERMISSION_SET) result.delete(key);

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

export function getPermissionCatalog({ isSystemOwner = false } = {}) {
  const filterOwnerOnly = (keys) =>
    (Array.isArray(keys) ? keys : []).filter(
      (key) => isSystemOwner || !OWNER_ONLY_PERMISSION_SET.has(key)
    );

  return {
    permissions: filterOwnerOnly(ALL_PERMISSION_KEYS),
    roleDefaults: Object.fromEntries(
      Object.entries(ROLE_DEFAULT_PERMISSIONS).map(([role, keys]) => [
        role,
        filterOwnerOnly(keys),
      ])
    ),
    groups: PERMISSION_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      keys: filterOwnerOnly(group.keys),
    })),
    templates: Object.values(PERMISSION_TEMPLATES).map((tpl) => ({
      id: tpl.id,
      label: tpl.label,
      permissions: filterOwnerOnly(tpl.permissions),
    })),
  };
}

