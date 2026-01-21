// src/pages/Hr/index.jsx

import React from "react";
import { Routes, Route, NavLink } from "react-router-dom";

import HrDashboard from "./HrDashboard";
import Employees from "./Employees";
import Documents from "./Documents";
import Reports from "./Reports";
import Templates from "./Templates"; // 👈 новая страница с табелями

const Tab = ({ to, children }) => (
  <NavLink
    to={to}
    end
    className={({ isActive }) => "tab" + (isActive ? " active" : "")}
  >
    {children}
  </NavLink>
);

export default function HrRouter() {
  return (
    <div className="page">
      <h1>Кадры</h1>

      <div className="tabs">
        <Tab to="">Обзор</Tab>
        <Tab to="employees">Сотрудники</Tab>
        <Tab to="documents">Документы</Tab>
        <Tab to="templates">Табели</Tab> {/* 👈 новая вкладка */}
        <Tab to="reports">Отчёты</Tab>
      </div>

      <Routes>
        <Route index element={<HrDashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="documents" element={<Documents />} />
        <Route path="templates" element={<Templates />} /> {/* 👈 маршрут для табелей */}
        <Route path="reports" element={<Reports />} />
      </Routes>
    </div>
  );
}
