import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import UserManagement from "./UserManagement";
import TenantManagement from "./TenantManagement";
import AdminWarehousePanel from "../components/admin/AdminWarehousePanel";
import "../components/admin/admin.css";
import { hasPermission, PERMISSION_KEYS } from "../utils/permissions";

const BASE_TABS = [
  { id: "users", label: "Пользователи" },
  { id: "warehouse", label: "Склад" },
];

const OWNER_TAB = { id: "tenants", label: "Клиенты" };

export default function AdminConsole({ initialTab = "users" }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isSystemOwner = user?.isSystemOwner === true;
  const canUsers = hasPermission(user, PERMISSION_KEYS.ADMIN_USERS);
  const canWarehouse = hasPermission(user, PERMISSION_KEYS.ADMIN_WAREHOUSE);
  const canTenants =
    isSystemOwner && hasPermission(user, PERMISSION_KEYS.ADMIN_TENANTS);

  const tabs = useMemo(
    () =>
      [
        canTenants ? OWNER_TAB : null,
        canUsers ? BASE_TABS.find((item) => item.id === "users") : null,
        canWarehouse ? BASE_TABS.find((item) => item.id === "warehouse") : null,
      ].filter(Boolean),
    [canUsers, canWarehouse, canTenants]
  );
  const initialTabId = tabs.some((tab) => tab.id === initialTab)
    ? initialTab
    : tabs[0]?.id || "users";
  const [activeTab, setActiveTab] = useState(initialTabId);

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab(tabs[0]?.id || "users");
  }, [activeTab, tabs]);

  if (!isAdmin) {
    return (
      <div className="admin-console">
        <div className="admin-console__header">
          <div>
            <div className="admin-console__title">Администрирование</div>
            <div className="admin-console__subtitle">
              Нет доступа, нужна роль ADMIN.
            </div>
          </div>
        </div>
        <div className="admin-console__card admin-console__card--warn">
          <div className="admin-console__card-title">Нет доступа</div>
          <div className="admin-console__card-text">
            Обратитесь к администратору за правами доступа.
          </div>
        </div>
      </div>
    );
  }

  if (!tabs.length) {
    return (
      <div className="admin-console">
        <div className="admin-console__header">
          <div>
            <div className="admin-console__title">Администрирование</div>
            <div className="admin-console__subtitle">
              Нет доступных разделов админки для этого пользователя.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-console">
      <div className="admin-console__header">
        <div>
          <div className="admin-console__title">Администрирование</div>
          <div className="admin-console__subtitle">
            Управление пользователями, складом и клиентами SaaS.
          </div>
        </div>
      </div>

      <div className="admin-console__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={
              "admin-console__tab" +
              (activeTab === tab.id ? " admin-console__tab--active" : "")
            }
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="admin-console__body">
        {activeTab === "tenants" && <TenantManagement />}
        {activeTab === "users" && <UserManagement />}
        {activeTab === "warehouse" && <AdminWarehousePanel />}
      </div>
    </div>
  );
}
