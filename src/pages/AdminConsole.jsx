import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import UserManagement from "./UserManagement";
import AdminHrPanel from "../components/admin/AdminHrPanel";
import AdminWarehousePanel from "../components/admin/AdminWarehousePanel";
import AdminSettingsPanel from "../components/admin/AdminSettingsPanel";
import "../components/admin/admin.css";

const TABS = [
  { id: "users", label: "Пользователи" },
  { id: "hr", label: "Кадры" },
  { id: "warehouse", label: "Склад" },
  { id: "settings", label: "Настройки" },
];

export default function AdminConsole({ initialTab = "users" }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [activeTab, setActiveTab] = useState(initialTab);

  const tabs = useMemo(() => TABS, []);

  if (!isAdmin) {
    return (
      <div className="admin-console">
        <div className="admin-console__header">
          <div>
            <div className="admin-console__title">
              Администрирование
            </div>
            <div className="admin-console__subtitle">
              Нет доступа, нужна роль ADMIN.
            </div>
          </div>
        </div>
        <div className="admin-console__card admin-console__card--warn">
          <div className="admin-console__card-title">
            Нет доступа
          </div>
          <div className="admin-console__card-text">
            Обратитесь к администратору за правами доступа.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-console">
      <div className="admin-console__header">
        <div>
          <div className="admin-console__title">
            Администрирование
          </div>
          <div className="admin-console__subtitle">
            Управление пользователями, кадрами и складом.
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
        {activeTab === "users" && <UserManagement />}
        {activeTab === "hr" && <AdminHrPanel />}
        {activeTab === "warehouse" && <AdminWarehousePanel />}
        {activeTab === "settings" && <AdminSettingsPanel />}
      </div>
    </div>
  );
}
