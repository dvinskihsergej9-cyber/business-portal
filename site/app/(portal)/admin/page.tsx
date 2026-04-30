"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { changeUserRole, fetchMe, fetchUsers } from "@/services/api";

export default function AdminPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["session", "me"], queryFn: fetchMe });
  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: fetchUsers,
    enabled: meQuery.data?.role === "ADMIN",
  });
  const [error, setError] = useState("");

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => changeUserRole(userId, role),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["session", "me"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Не удалось изменить роль."),
  });

  if (meQuery.data?.role !== "ADMIN") {
    return (
      <div className="space-y-3">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Админ-панель</h1>
        <p className="text-sm text-slate-500">Раздел доступен только администраторам.</p>
      </div>
    );
  }

  const users = usersQuery.data || [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Админ-панель</h1>
        <p className="text-sm text-slate-500">Управление ролями и доступами сотрудников организации.</p>
      </header>

      <SectionCard title="Пользователи" subtitle="Единый реестр пользователей">
        {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}
        <div className="overflow-auto">
          <table className="table-grid">
            <thead>
              <tr>
                <th>ID</th>
                <th>Имя</th>
                <th>Логин</th>
                <th>Роль</th>
                <th>Организация</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.name}</td>
                  <td>{user.login}</td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(event) =>
                        roleMutation.mutate({ userId: user.id, role: event.target.value })
                      }
                      disabled={user.isSystemOwner || roleMutation.isPending}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="EMPLOYEE">EMPLOYEE</option>
                    </select>
                  </td>
                  <td>{user.organization?.name || "-"}</td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={5} className="text-slate-500">
                    Пользователи не найдены.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
