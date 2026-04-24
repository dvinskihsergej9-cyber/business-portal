import "dotenv/config";
import { PrismaClient } from "@prisma/client";

function toBool(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function sqlLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function parseRoleFromDatabaseUrl(urlValue) {
  try {
    const parsed = new URL(String(urlValue || "").trim());
    return decodeURIComponent(String(parsed.username || "").trim());
  } catch {
    return "";
  }
}

function isPostgresDatabaseUrl(urlValue) {
  const value = String(urlValue || "").trim().toLowerCase();
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

function buildPrivilegeCheckSql() {
  return `
    SELECT
      current_user AS "currentUser",
      has_table_privilege(current_user, 'public."User"', 'SELECT') AS "userSelect",
      has_table_privilege(current_user, 'public."User"', 'INSERT') AS "userInsert",
      has_table_privilege(current_user, 'public."User"', 'UPDATE') AS "userUpdate",
      has_table_privilege(current_user, 'public."User"', 'DELETE') AS "userDelete",
      has_table_privilege(current_user, 'public."Organization"', 'SELECT') AS "orgSelect",
      has_table_privilege(current_user, 'public."WarehouseNotification"', 'SELECT') AS "notificationSelect",
      has_table_privilege(current_user, 'public."EmailVerificationCode"', 'SELECT') AS "emailCodeSelect",
      has_table_privilege(current_user, 'public."EmailVerificationCode"', 'INSERT') AS "emailCodeInsert",
      has_table_privilege(current_user, 'public."EmailVerificationCode"', 'UPDATE') AS "emailCodeUpdate"
  `;
}

function hasRequiredPrivileges(row) {
  return Boolean(
    row &&
      row.userSelect &&
      row.userInsert &&
      row.userUpdate &&
      row.userDelete &&
      row.orgSelect &&
      row.notificationSelect &&
      row.emailCodeSelect &&
      row.emailCodeInsert &&
      row.emailCodeUpdate
  );
}

async function loadPrivilegeSnapshot(databaseUrl) {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  try {
    const rows = await client.$queryRawUnsafe(buildPrivilegeCheckSql());
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } finally {
    await client.$disconnect().catch(() => null);
  }
}

async function grantRuntimePrivileges({ adminUrl, targetRole, schemaName }) {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: adminUrl,
      },
    },
  });
  const roleLiteral = sqlLiteral(targetRole);
  const schemaLiteral = sqlLiteral(schemaName);
  try {
    await client.$executeRawUnsafe(`
      DO $$
      DECLARE
        v_target_role text := ${roleLiteral};
        v_schema text := ${schemaLiteral};
        v_owner record;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target_role) THEN
          RAISE EXCEPTION 'Role "%" does not exist', v_target_role;
        END IF;

        EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', v_schema, v_target_role);
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA %I TO %I',
          v_schema,
          v_target_role
        );
        EXECUTE format(
          'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I',
          v_schema,
          v_target_role
        );

        FOR v_owner IN
          SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = v_schema
            AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
            AND pg_get_userbyid(c.relowner) IS NOT NULL
        LOOP
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO %I',
            v_owner.owner_name,
            v_schema,
            v_target_role
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
            v_owner.owner_name,
            v_schema,
            v_target_role
          );
        END LOOP;
      END
      $$;
    `);
  } finally {
    await client.$disconnect().catch(() => null);
  }
}

async function main() {
  const runtimeUrl = String(process.env.DATABASE_URL || "").trim();
  if (!runtimeUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const strictMode = toBool(process.env.DB_PERMISSIONS_STRICT, false);
  const schemaName = String(process.env.DB_PERMISSIONS_SCHEMA || "public").trim() || "public";
  if (!isPostgresDatabaseUrl(runtimeUrl)) {
    console.log("[DB_PERMS] Skip: DATABASE_URL is not PostgreSQL.");
    return;
  }
  const targetRole =
    String(process.env.DATABASE_RUNTIME_ROLE || "").trim() ||
    parseRoleFromDatabaseUrl(runtimeUrl);

  if (!targetRole) {
    const message = "Cannot determine runtime role. Set DATABASE_RUNTIME_ROLE explicitly.";
    if (strictMode) {
      throw new Error(message);
    }
    console.warn(`[DB_PERMS] ${message} Skip permissions bootstrap.`);
    return;
  }

  const before = await loadPrivilegeSnapshot(runtimeUrl);
  if (hasRequiredPrivileges(before)) {
    console.log(
      `[DB_PERMS] Runtime role "${targetRole}" already has required privileges (current_user=${before?.currentUser || "?"}).`
    );
    return;
  }

  const adminUrl = String(process.env.DATABASE_ADMIN_URL || "").trim();
  if (!adminUrl) {
    const message =
      "[DB_PERMS] Missing required runtime privileges and DATABASE_ADMIN_URL is not set. " +
      "Set DATABASE_ADMIN_URL to auto-grant permissions during deploy.";
    if (strictMode) {
      throw new Error(message);
    }
    console.warn(message);
    return;
  }

  console.log(
    `[DB_PERMS] Granting privileges for runtime role "${targetRole}" using admin connection...`
  );
  await grantRuntimePrivileges({
    adminUrl,
    targetRole,
    schemaName,
  });

  const after = await loadPrivilegeSnapshot(runtimeUrl);
  if (!hasRequiredPrivileges(after)) {
    const details = JSON.stringify(after || {}, null, 2);
    const message =
      `[DB_PERMS] Privileges are still insufficient for role "${targetRole}" after grant attempt.\n` +
      details;
    if (strictMode) {
      throw new Error(message);
    }
    console.warn(message);
    return;
  }

  console.log(
    `[DB_PERMS] Runtime role "${targetRole}" permissions are OK (current_user=${after?.currentUser || "?"}).`
  );
}

main().catch((err) => {
  console.error("[DB_PERMS] failed:", err?.message || err);
  process.exit(1);
});
