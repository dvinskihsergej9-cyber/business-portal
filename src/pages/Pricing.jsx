import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const PERIOD_OPTIONS = [
  { id: "1m", label: "1 месяц", discountPct: 0 },
  { id: "6m", label: "6 месяцев", discountPct: 10 },
  { id: "12m", label: "1 год", discountPct: 30 },
];

const PLAN_CARDS = [
  {
    key: "starter",
    id: "basic-30",
    title: "Стартовый",
    subtitle: "Для малого и среднего склада",
    amount: 1990,
    currency: "RUB",
    spotlight: true,
    available: true,
    bullets: [
      "Приемка, размещение, отбор, отгрузка",
      "Мобильный ТСД и сканирование",
      "Журнал статусов и контроль действий",
      "Роли сотрудников и SaaS-изоляция",
    ],
  },
  {
    key: "business",
    id: null,
    title: "Бизнес",
    subtitle: "Для расширенных процессов",
    amount: 3990,
    currency: "RUB",
    spotlight: false,
    available: false,
    bullets: [
      "Расширенная аналитика и KPI",
      "Автоматизация складских сценариев",
      "Дополнительные интеграции",
      "Приоритетная поддержка",
    ],
  },
  {
    key: "corp",
    id: null,
    title: "Корпоративный",
    subtitle: "Для сетей и сложных интеграций",
    amount: null,
    currency: "RUB",
    spotlight: false,
    available: false,
    bullets: [
      "Индивидуальные условия внедрения",
      "Кастомные интеграции",
      "Выделенный SLA",
      "Персональный технический менеджер",
    ],
  },
];

const FEATURE_MATRIX = [
  { label: "Приемка и размещение", starter: true, business: true, corp: true },
  { label: "Отбор и отгрузка", starter: true, business: true, corp: true },
  { label: "Мобильный ТСД", starter: true, business: true, corp: true },
  { label: "Журнал статусов заказов", starter: true, business: true, corp: true },
  { label: "Расширенная аналитика", starter: false, business: true, corp: true },
  { label: "Интеграции с внешними системами", starter: false, business: true, corp: true },
  { label: "Выделенный SLA", starter: false, business: false, corp: true },
];

function formatPrice(amount, currency) {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(amount || 0));
  } catch {
    return `${amount} ${currency}`;
  }
}

function getPeriodMonths(periodId) {
  if (periodId === "6m") return 6;
  if (periodId === "12m") return 12;
  return 1;
}

function getPeriodAmount(baseAmount, periodId) {
  if (baseAmount === null || baseAmount === undefined) return null;
  const monthly = Number(baseAmount || 0);
  const months = getPeriodMonths(periodId);
  if (months === 6) return Math.round(monthly * months * 0.9);
  if (months === 12) return Math.round(monthly * months * 0.7);
  return monthly;
}

function getPeriodLabel(periodId) {
  if (periodId === "6m") return "6 месяцев";
  if (periodId === "12m") return "1 год";
  return "1 месяц";
}

function mark(value) {
  return value ? "✓" : "—";
}

export default function Pricing() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState("");
  const [error, setError] = useState("");
  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);
  const [periodId, setPeriodId] = useState("1m");

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";

  const selectedPeriod = useMemo(
    () => PERIOD_OPTIONS.find((option) => option.id === periodId) || PERIOD_OPTIONS[0],
    [periodId]
  );

  const subscription = user?.subscription;
  const trialAvailable = !subscription?.isActive && !subscription?.trialUsed;
  const showTrialCard = !subscription?.isActive;
  const paidUntilDate = subscription?.paidUntil
    ? new Date(subscription.paidUntil).toLocaleDateString("ru-RU")
    : "—";

  const extendedPeriodSelected = periodId !== "1m";

  const handlePay = async (planId, paymentMethod = "sbp") => {
    if (!planId) {
      setError("Этот тариф пока недоступен для онлайн-оплаты.");
      return;
    }

    if (extendedPeriodSelected) {
      setError("Оплата за 6 месяцев и 1 год будет подключена следующим этапом.");
      return;
    }

    if (!canManageBilling) {
      setError("Оплату выполняет администратор вашей компании.");
      return;
    }

    try {
      setLoading(true);
      setLoadingMethod(paymentMethod);
      setError("");
      const token = localStorage.getItem("token");

      const res = await apiFetch("/billing/yookassa/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId, paymentMethod }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(
          normalizeErrorMessage(data?.message || "", "Не удалось инициировать оплату.")
        );
        return;
      }

      if (data.confirmationUrl) {
        window.location.href = data.confirmationUrl;
        return;
      }

      setError("Не удалось получить ссылку для оплаты.");
    } catch (err) {
      console.error("create payment error:", err);
      setError("Не удалось инициировать оплату.");
    } finally {
      setLoading(false);
      setLoadingMethod("");
    }
  };

  const handleStartTrial = async () => {
    if (!canManageBilling) {
      setError("Тестовый период активирует администратор вашей компании.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const res = await apiFetch("/billing/start-trial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        setError(
          normalizeErrorMessage(
            data?.message || "",
            "Не удалось активировать пробный период."
          )
        );
        return;
      }

      await refreshUser();
      navigate("/warehouse");
    } catch (err) {
      console.error("start trial error:", err);
      setError("Не удалось активировать пробный период.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await refreshUser();
    navigate("/warehouse");
  };

  const loadBillingConfig = async () => {
    try {
      const res = await apiFetch("/billing/config");
      const data = await res.json();
      setBillingReady(Boolean(data?.yookassaEnabled));
    } catch (err) {
      console.error("billing config error:", err);
      setBillingReady(false);
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => {
    loadBillingConfig();
  }, []);

  return (
    <div className="page pricing-planfix">
      {!canManageBilling && (
        <div className="pricing-planfix__notice">
          Оплату и запуск пробного периода выполняет администратор вашей компании.
        </div>
      )}

      {subscription?.isActive && (
        <section className="pricing-planfix__active">
          <div>
            <div className="pricing-planfix__active-title">Подписка активна</div>
            <div className="pricing-planfix__active-subtitle">Оплачено до: {paidUntilDate}</div>
          </div>
          <button className="btn pricing-planfix__mini-btn" onClick={handleRefresh}>
            Обновить статус
          </button>
        </section>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <section className="pricing-planfix__hero">
        <div className="pricing-planfix__brand">
          <img src="/logo-mark.png" alt="Логотип СкладОнлайн" />
          <div>
            <strong>СкладОнлайн</strong>
            <span>Платформа управления складом</span>
          </div>
        </div>

        <h1 className="pricing-planfix__title">Тарифы</h1>

        <div className="pricing-planfix__periods" role="tablist" aria-label="Период оплаты">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`pricing-planfix__period-btn ${option.id === periodId ? "is-active" : ""}`}
              onClick={() => setPeriodId(option.id)}
            >
              <span>{option.label}</span>
              {option.discountPct > 0 && (
                <span className="pricing-planfix__period-discount">-{option.discountPct}%</span>
              )}
            </button>
          ))}
        </div>

        <p className="pricing-planfix__subtitle">
          Период оплаты: <b>{selectedPeriod.label}</b>. Один платеж на организацию и полный
          доступ для всех сотрудников по назначенным правам.
        </p>
      </section>

      {showTrialCard && (
        <section className="pricing-planfix__trial">
          <div>
            <div className="pricing-planfix__trial-title">Пробный период 30 дней</div>
            <div className="pricing-planfix__trial-text">
              Полный функционал без ограничений. Один запуск на организацию.
            </div>
          </div>
          <button
            className="btn pricing-planfix__trial-btn"
            onClick={handleStartTrial}
            disabled={loading || !canManageBilling || !trialAvailable}
          >
            {loading ? "Активируем..." : "Начать бесплатно"}
          </button>
        </section>
      )}

      <section className="pricing-planfix__cards">
        {PLAN_CARDS.map((plan) => {
          const displayAmount = getPeriodAmount(plan.amount, periodId);

          return (
            <article
              key={plan.key}
              className={`pricing-planfix__card ${plan.spotlight ? "pricing-planfix__card--spotlight" : ""}`}
            >
              <div className="pricing-planfix__card-top">
                <div>
                  <h2>{plan.title}</h2>
                  <div className="pricing-planfix__card-subtitle">{plan.subtitle}</div>
                </div>
                {plan.spotlight ? <span className="pricing-planfix__tag">Рекомендуем</span> : null}
              </div>

              <div className="pricing-planfix__price-row">
                <div className="pricing-planfix__price">
                  {displayAmount === null ? "По запросу" : formatPrice(displayAmount, plan.currency)}
                </div>
                <div className="pricing-planfix__period">/ {getPeriodLabel(periodId)}</div>
              </div>

              <ul className="pricing-planfix__bullets">
                {plan.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <div className="pricing-planfix__actions">
                <button
                  className="btn pricing-planfix__btn pricing-planfix__btn--dark"
                  onClick={() => handlePay(plan.id, "sbp")}
                  disabled={
                    !plan.available ||
                    extendedPeriodSelected ||
                    loading ||
                    billingLoading ||
                    !billingReady ||
                    !canManageBilling
                  }
                >
                  {plan.available
                    ? loading && loadingMethod === "sbp"
                      ? "Переход..."
                      : "Оплатить СБП"
                    : "Скоро"}
                </button>

                <button
                  className="btn pricing-planfix__btn pricing-planfix__btn--light"
                  onClick={() => handlePay(plan.id, "default")}
                  disabled={
                    !plan.available ||
                    extendedPeriodSelected ||
                    loading ||
                    billingLoading ||
                    !billingReady ||
                    !canManageBilling
                  }
                >
                  {plan.available
                    ? loading && loadingMethod === "default"
                      ? "Переход..."
                      : "Оплатить картой"
                    : "Недоступно"}
                </button>
              </div>

              {!plan.available && (
                <div className="pricing-planfix__hint">Подключение этого тарифа будет добавлено следующим этапом.</div>
              )}
              {plan.available && !billingReady && (
                <div className="pricing-planfix__hint">Платежи появятся после подключения YooKassa.</div>
              )}
              {plan.available && extendedPeriodSelected && (
                <div className="pricing-planfix__hint">Оплата за 6/12 месяцев будет добавлена отдельно.</div>
              )}
            </article>
          );
        })}
      </section>

      <section className="pricing-planfix__matrix">
        <h3>Сравнение возможностей</h3>
        <div className="pricing-planfix__table-wrap">
          <table className="pricing-planfix__table">
            <thead>
              <tr>
                <th>Функция</th>
                <th>Стартовый</th>
                <th>Бизнес</th>
                <th>Корпоративный</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_MATRIX.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{mark(row.starter)}</td>
                  <td>{mark(row.business)}</td>
                  <td>{mark(row.corp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
