import {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  PERMISSION_TEMPLATES_LIST,
  TSD_MODE_PERMISSION_MAP,
  WAREHOUSE_SECTION_PERMISSION_MAP,
} from "../../shared/permissionRegistry.js";

export {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  TSD_MODE_PERMISSION_MAP,
  WAREHOUSE_SECTION_PERMISSION_MAP,
};

export const PERMISSION_TEMPLATES = PERMISSION_TEMPLATES_LIST;

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

