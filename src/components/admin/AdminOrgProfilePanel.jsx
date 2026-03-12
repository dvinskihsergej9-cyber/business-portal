import { useEffect, useMemo, useState } from "react";
import { API_BASE, normalizeErrorMessage } from "../../apiConfig";

const EMPTY_FORM = {
  orgName: "",
  legalAddress: "",
  actualAddress: "",
  inn: "",
  kpp: "",
  phone: "",
  purchaseOrderEmailTemplate: "",
};

export default function AdminOrgProfilePanel() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const authHeaders = useMemo(() => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(`${API_BASE}/settings/org-profile`, {
          headers: authHeaders,
        });
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (!res.ok) {
          throw new Error(data?.message || "ORG_PROFILE_GET_ERROR");
        }
        const profile = data?.profile || null;
        if (!active) return;
        setForm({
          orgName: profile?.orgName || "",
          legalAddress: profile?.legalAddress || "",
          actualAddress: profile?.actualAddress || "",
          inn: profile?.inn || "",
          kpp: profile?.kpp || "",
          phone: profile?.phone || "",
          purchaseOrderEmailTemplate: profile?.purchaseOrderEmailTemplate || "",
        });
      } catch (err) {
        if (!active) return;
        setError(
          normalizeErrorMessage(err, "Не удалось загрузить реквизиты организации.")
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      active = false;
    };
  }, [authHeaders]);

  const setField = (key) => (event) => {
    const nextValue = event.target.value;
    setForm((prev) => ({ ...prev, [key]: nextValue }));
  };

  const handleSave = async () => {
    const payload = {
      orgName: String(form.orgName || "").trim(),
      legalAddress: String(form.legalAddress || "").trim(),
      actualAddress: String(form.actualAddress || "").trim(),
      inn: String(form.inn || "").trim(),
      kpp: String(form.kpp || "").trim(),
      phone: String(form.phone || "").trim(),
      purchaseOrderEmailTemplate: String(
        form.purchaseOrderEmailTemplate || ""
      ),
    };

    if (
      !payload.orgName ||
      !payload.legalAddress ||
      !payload.actualAddress ||
      !payload.inn ||
      !payload.kpp
    ) {
      setSuccess("");
      setError(
        "Заполните обязательные поля: Организация, Юр. адрес, Факт. адрес, ИНН, КПП."
      );
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");
      const res = await fetch(`${API_BASE}/settings/org-profile`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "ORG_PROFILE_SAVE_ERROR");
      }
      const profile = data?.profile || payload;
      setForm({
        orgName: profile?.orgName || "",
        legalAddress: profile?.legalAddress || "",
        actualAddress: profile?.actualAddress || "",
        inn: profile?.inn || "",
        kpp: profile?.kpp || "",
        phone: profile?.phone || "",
        purchaseOrderEmailTemplate: profile?.purchaseOrderEmailTemplate || "",
      });
      setSuccess("Реквизиты сохранены.");
    } catch (err) {
      setError(
        normalizeErrorMessage(err, "Не удалось сохранить реквизиты организации.")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-console__card">
      <div className="admin-console__card-title">Реквизиты организации</div>
      <div className="admin-console__card-text">
        Эти данные автоматически подставляются в акт расхождений при приемке.
      </div>

      {loading ? (
        <div className="admin-muted">Загрузка реквизитов...</div>
      ) : (
        <div className="admin-form" style={{ marginTop: 14 }}>
          <div className="admin-form__row">
            <div>
              <label className="admin-label">Организация</label>
              <input
                className="admin-input"
                value={form.orgName}
                onChange={setField("orgName")}
                placeholder='Например: ООО "Ромашка"'
              />
            </div>
            <div>
              <label className="admin-label">Телефон</label>
              <input
                className="admin-input"
                value={form.phone}
                onChange={setField("phone")}
                placeholder="+7 (999) 123-45-67"
              />
            </div>
          </div>

          <div className="admin-form__row">
            <div>
              <label className="admin-label">Юридический адрес</label>
              <input
                className="admin-input"
                value={form.legalAddress}
                onChange={setField("legalAddress")}
              />
            </div>
            <div>
              <label className="admin-label">Фактический адрес</label>
              <input
                className="admin-input"
                value={form.actualAddress}
                onChange={setField("actualAddress")}
              />
            </div>
          </div>

          <div className="admin-form__row">
            <div>
              <label className="admin-label">ИНН</label>
              <input
                className="admin-input"
                value={form.inn}
                onChange={setField("inn")}
              />
            </div>
            <div>
              <label className="admin-label">КПП</label>
              <input
                className="admin-input"
                value={form.kpp}
                onChange={setField("kpp")}
              />
            </div>
          </div>

          <div>
            <label className="admin-label">Шаблон письма поставщику (необязательно)</label>
            <textarea
              className="admin-input"
              value={form.purchaseOrderEmailTemplate}
              onChange={setField("purchaseOrderEmailTemplate")}
              rows={8}
              placeholder={
                "Здравствуйте, {{supplierName}}!\n\n" +
                "Просим обработать заказ № {{orderNumber}} от {{orderDate}}.\n\n" +
                "Позиции:\n{{lines}}\n\n" +
                "Итого: {{totalAmount}} ₽\n\n" +
                "С уважением,\nСкладОнлайн"
              }
              style={{ resize: "vertical", minHeight: 180 }}
            />
            <div className="admin-muted" style={{ marginTop: 6 }}>
              Переменные: {"{{supplierName}}"}, {"{{orderNumber}}"}, {"{{orderDate}}"}, {"{{lines}}"}, {"{{totalAmount}}"}.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Сохранение..." : "Сохранить реквизиты"}
            </button>
          </div>

          {error ? <div className="admin-alert admin-alert--error">{error}</div> : null}
          {success ? <div className="admin-muted">{success}</div> : null}
        </div>
      )}
    </div>
  );
}

