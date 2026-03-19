import { useEffect, useMemo, useState } from "react";
import { apiFetch, normalizeErrorMessage } from "../../apiConfig";

export default function AdminMarketingSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [meta, setMeta] = useState({ consentAt: null, unsubscribedAt: null });

  const statusText = useMemo(() => {
    if (enabled) {
      return meta?.consentAt
        ? `Включено с ${new Date(meta.consentAt).toLocaleString("ru-RU")}.`
        : "Включено.";
    }
    if (meta?.unsubscribedAt) {
      return `Отключено с ${new Date(meta.unsubscribedAt).toLocaleString("ru-RU")}.`;
    }
    return "Отключено.";
  }, [enabled, meta]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        setSuccess("");
        const res = await apiFetch("/settings/marketing-preferences", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || "MARKETING_SETTINGS_LOAD_ERROR");
        }
        if (!active) return;
        setEnabled(Boolean(data?.enabled));
        setMeta({
          consentAt: data?.consentAt || null,
          unsubscribedAt: data?.unsubscribedAt || null,
        });
      } catch (err) {
        if (!active) return;
        setError(
          normalizeErrorMessage(err, "Не удалось загрузить настройки рассылки.")
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  const handleToggle = async () => {
    const nextValue = !enabled;
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const res = await apiFetch("/settings/marketing-preferences", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: nextValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "MARKETING_SETTINGS_SAVE_ERROR");
      }
      setEnabled(Boolean(data?.enabled));
      setMeta({
        consentAt: data?.consentAt || null,
        unsubscribedAt: data?.unsubscribedAt || null,
      });
      setSuccess(data?.message || "Настройки рассылки обновлены.");
    } catch (err) {
      setError(
        normalizeErrorMessage(err, "Не удалось сохранить настройки рассылки.")
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-console__card">
        <div className="admin-console__card-title">Рассылка</div>
        <div className="admin-muted">Загрузка настроек...</div>
      </div>
    );
  }

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Рассылка</div>
      <div className="admin-console__card-text">
        Управление получением писем с новостями и полезными материалами сервиса.
      </div>

      <div className="admin-marketing-toggle">
        <button
          type="button"
          className={
            "admin-marketing-toggle__switch" +
            (enabled ? " admin-marketing-toggle__switch--on" : "")
          }
          onClick={handleToggle}
          disabled={saving}
          aria-pressed={enabled}
          aria-label="Переключить получение рассылки"
        >
          <span className="admin-marketing-toggle__thumb" />
        </button>

        <div className="admin-marketing-toggle__content">
          <div className="admin-marketing-toggle__title">
            {enabled ? "Рассылка включена" : "Рассылка отключена"}
          </div>
          <div className="admin-marketing-toggle__meta">{statusText}</div>
        </div>
      </div>

      {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
      {success ? <div className="admin-muted">{success}</div> : null}
    </div>
  );
}

