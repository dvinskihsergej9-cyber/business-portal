import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../apiConfig";

export default function Profile() {
  const { user, updateProfile } = useAuth();

  const [form, setForm] = useState({
    name: user?.name || "",
    password: "",
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [devMsg, setDevMsg] = useState("");

  if (!user) {
    return <div style={{ padding: 24 }}>Нет данных пользователя.</div>;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    setError("");

    const res = await updateProfile({
      name: form.name,
      password: form.password,
    });

    setSaving(false);

    if (!res.ok) {
      setError(res.message || "Ошибка сохранения");
    } else {
      setMsg("Профиль сохранён");
      setForm((f) => ({ ...f, password: "" }));
    }
  };

  const handleMakeMeAdmin = async () => {
    setDevMsg("Делаю вас ADMIN...");
    setError("");
    try {
      const token = localStorage.getItem("token");
      const res = await apiFetch("/dev/make-me-admin", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Ошибка при повышении до ADMIN");
      }

      // Обновим локального пользователя и перезагрузим страницу
      localStorage.setItem("user", JSON.stringify(data.user));
      setDevMsg("Теперь вы ADMIN. Обновляю страницу...");
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (e) {
      console.error(e);
      setDevMsg("");
      setError(e.message);
    }
  };

  const isDevOwner =
    user.email &&
    user.email.toLowerCase() === "dvinskihsergej9@gmail.com".toLowerCase();

  return (
    <div style={{ padding: 24 }}>
      <h1>Профиль</h1>
      <p>Здесь вы можете изменить имя и пароль.</p>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          maxWidth: 480,
        }}
      >
        <p>
          <b>Email:</b> {user.email}
          <br />
          <b>Роль:</b> {user.role}
        </p>

        {error && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              borderRadius: 4,
              background: "#ffe6e6",
              color: "#b00020",
            }}
          >
            {error}
          </div>
        )}
        {msg && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              borderRadius: 4,
              background: "#ecfdf3",
              color: "#166534",
            }}
          >
            {msg}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 8 }}>
            <label>
              Имя
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>
              Новый пароль (если нужно)
              <input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
          </div>

          <button type="submit" disabled={saving}>
            {saving ? "Сохраняю..." : "Сохранить"}
          </button>
        </form>
      </div>

      {/* DEV-блок: сделать себя ADMIN — только для твоего email */}
      {isDevOwner && user.role !== "ADMIN" && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: "#fef3c7",
            borderRadius: 8,
            maxWidth: 480,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Dev-функция: сделать себя ADMIN</h3>
          <p style={{ fontSize: 14 }}>
            Эта кнопка доступна только для владельца портала
            (<code>dvinskihsergej9@gmail.com</code>) и только в дев-среде.
          </p>
          <button onClick={handleMakeMeAdmin} disabled={!!devMsg}>
            Сделать меня ADMIN
          </button>
          {devMsg && (
            <p style={{ marginTop: 8, fontSize: 13, color: "#92400e" }}>
              {devMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
