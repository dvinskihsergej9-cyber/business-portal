"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchMe, fetchTasksAll, fetchTasksMy, submitTaskResponse, updateTaskStatus } from "@/services/api";

const editableStatuses = ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["session", "me"], queryFn: fetchMe });
  const isAdmin = meQuery.data?.role === "ADMIN";

  const tasksMyQuery = useQuery({ queryKey: ["tasks", "my"], queryFn: fetchTasksMy });
  const tasksAllQuery = useQuery({
    queryKey: ["tasks", "all"],
    queryFn: fetchTasksAll,
    enabled: isAdmin,
  });

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");

  const tasks = useMemo(() => {
    const source = isAdmin ? tasksAllQuery.data : tasksMyQuery.data;
    return source || [];
  }, [isAdmin, tasksAllQuery.data, tasksMyQuery.data]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;

  const statusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: number; status: string }) => updateTaskStatus(taskId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const responseMutation = useMutation({
    mutationFn: ({ taskId, text }: { taskId: number; text: string }) => submitTaskResponse(taskId, text),
    onSuccess: () => {
      setResponseText("");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Задачи</h1>
        <p className="text-sm text-slate-500">Управление задачами склада с синхронизацией между приложением и сайтом.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Список задач" subtitle={isAdmin ? "Все задачи организации" : "Назначенные и созданные вами"}>
          <div className="overflow-auto">
            <table className="table-grid">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Задача</th>
                  <th>Статус</th>
                  <th>Исполнитель</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr
                    key={task.id}
                    className={selectedTaskId === task.id ? "bg-blue-50/60" : ""}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <td>{task.id}</td>
                    <td>{task.title}</td>
                    <td>{task.status}</td>
                    <td>{task.executorName || "-"}</td>
                  </tr>
                ))}
                {!tasks.length ? (
                  <tr>
                    <td colSpan={4} className="text-slate-500">
                      Нет задач.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Карточка задачи" subtitle={selectedTask ? `#${selectedTask.id}` : "Выберите задачу"}>
          {selectedTask ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Название</p>
                <p className="font-medium text-slate-900">{selectedTask.title}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Описание</p>
                <p className="text-sm text-slate-700">{selectedTask.description || "—"}</p>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-slate-500">Статус</span>
                <select
                  value={selectedTask.status}
                  onChange={(event) =>
                    statusMutation.mutate({ taskId: selectedTask.id, status: event.target.value })
                  }
                >
                  {editableStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-slate-500">Ответ по задаче</span>
                <textarea
                  rows={4}
                  value={responseText}
                  onChange={(event) => setResponseText(event.target.value)}
                  placeholder="Добавьте комментарий по выполнению"
                  className="w-full"
                />
              </label>

              <button
                type="button"
                disabled={!responseText.trim() || responseMutation.isPending}
                onClick={() => responseMutation.mutate({ taskId: selectedTask.id, text: responseText.trim() })}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {responseMutation.isPending ? "Сохраняем..." : "Сохранить ответ"}
              </button>

              {selectedTask.responseText ? (
                <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-sm text-slate-700">
                  <p className="mb-1 text-xs uppercase tracking-[0.14em] text-slate-500">Последний ответ</p>
                  {selectedTask.responseText}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Выберите задачу в таблице слева.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
