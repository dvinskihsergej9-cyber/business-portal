import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import UserManagement from "./UserManagement";
import TenantManagement from "./TenantManagement";
import PickingReport from "./PickingReport";
import AdminWarehousePanel from "../components/admin/AdminWarehousePanel";
import AdminOrgProfilePanel from "../components/admin/AdminOrgProfilePanel";
import AdminMarketingSettingsPanel from "../components/admin/AdminMarketingSettingsPanel";
import AdminPickingShortagePanel from "../components/admin/AdminPickingShortagePanel";
import AdminOrderStatusHistoryPanel from "../components/admin/AdminOrderStatusHistoryPanel";
import AdminPlatformNewsPanel from "../components/admin/AdminPlatformNewsPanel";
import "../components/admin/admin.css";
import { hasPermission, PERMISSION_KEYS } from "../utils/permissions";

const BASE_TABS = [
  { id: "users", label: "Пользователи" },
  { id: "warehouse", label: "Склад" },
  { id: "picking-shortage", label: "Отбор" },
  { id: "order-status-history", label: "Журнал статусов" },
  { id: "org-profile", label: "Реквизиты" },
  { id: "picking-report", label: "Биллинг ресурсов" },
];

const OWNER_TAB = { id: "tenants", label: "Клиенты" };
const OWNER_PLATFORM_NEWS_TAB = { id: "platform-news", label: "Новости платформы" };
const COMPANY_OWNER_MARKETING_TAB = { id: "marketing-settings", label: "Рассылка" };

export default function AdminConsole({ initialTab = "users" }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isSystemOwner = user?.isSystemOwner === true;
  const canUsers = hasPermission(user, PERMISSION_KEYS.ADMIN_USERS);
  const canWarehouse = hasPermission(user, PERMISSION_KEYS.ADMIN_WAREHOUSE);
  const canTenants =
    isSystemOwner && hasPermission(user, PERMISSION_KEYS.ADMIN_TENANTS);
  const canCompanyOwnerMarketing = isAdmin && !isSystemOwner;

  const tabs = useMemo(
    () =>
      [
        canTenants ? OWNER_TAB : null,
        canTenants ? OWNER_PLATFORM_NEWS_TAB : null,
        canUsers ? BASE_TABS.find((item) => item.id === "users") : null,
        canWarehouse ? BASE_TABS.find((item) => item.id === "warehouse") : null,
        canWarehouse
          ? BASE_TABS.find((item) => item.id === "picking-shortage")
          : null,
        canWarehouse
          ? BASE_TABS.find((item) => item.id === "order-status-history")
          : null,
        canWarehouse
          ? BASE_TABS.find((item) => item.id === "org-profile")
          : null,
        canCompanyOwnerMarketing ? COMPANY_OWNER_MARKETING_TAB : null,
        canWarehouse
          ? BASE_TABS.find((item) => item.id === "picking-report")
          : null,
      ].filter(Boolean),
    [canUsers, canWarehouse, canTenants, canCompanyOwnerMarketing, isSystemOwner]
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
            <div className="admin-console__title">Управление</div>
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
            <div className="admin-console__title">Управление</div>
            <div className="admin-console__subtitle">
              Нет доступных разделов управления для этого пользователя.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-console">
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
        {activeTab === "platform-news" && <AdminPlatformNewsPanel />}
        {activeTab === "users" && <UserManagement />}
        {activeTab === "warehouse" && <AdminWarehousePanel />}
        {activeTab === "picking-shortage" && <AdminPickingShortagePanel />}
        {activeTab === "order-status-history" && <AdminOrderStatusHistoryPanel />}
        {activeTab === "org-profile" && <AdminOrgProfilePanel />}
        {activeTab === "marketing-settings" && <AdminMarketingSettingsPanel />}
        {activeTab === "picking-report" && <PickingReport />}
      </div>
    </div>
  );
}

