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
    available: true,
    spotlight: true,
    bullets: [
      "Приемка, размещение, отбор, отгрузка",
      "Мобильный ТСД и сканирование",
      "Права сотрудников и SaaS-изоляция",
    ],
  },
  {
    key: "growth",
    id: null,
    title: "Бизнес",
    subtitle: "Для расширенной автоматизации",
    amount: 0,
    currency: "RUB",
    available: false,
    spotlight: false,
    bullets: [
      "Расширенная аналитика склада",
      "Дополнительные бизнес-процессы",
      "Приоритетная поддержка",
    ],
  },
  {
    key: "corp",
    id: null,
    title: "Корпоративный",
    subtitle: "Для сетей и сложных интеграций",
    amount: 0,
    currency: "RUB",
    available: false,
    spotlight: false,
    bullets: [
      "Индивидуальные условия",
      "Кастомные интеграции",
      "Выделенный SLA",
    ],
  },
];

const FEATURE_MATRIX = [
  { label: "Приемка и размещение", starter: true, growth: true, corp: true },
  { label: "Отбор и отгрузка", starter: true, growth: true, corp: true },
  { label: "Мобильный ТСД", starter: true, growth: true, corp: true },
  { label: "Журнал статусов заказов", starter: true, growth: true, corp: true },
  { label: "Расширенная аналитика", starter: false, growth: true, corp: true },
  { label: "Кастомные интеграции", starter: false, growth: false, corp: true },
  { label: "Выделенный SLA", starter: false, growth: false, corp: true },
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
    <div className="page pricing-pf">
      {!canManageBilling && (
        <div className="pricing-pf__notice">
          Оплату и запуск пробного периода выполняет администратор вашей компании.
        </div>
      )}

      {subscription?.isActive && (
        <section className="pricing-pf__active">
          <div>
            <div className="pricing-pf__active-title">Подписка активна</div>
            <div className="pricing-pf__active-subtitle">Оплачено до: {paidUntilDate}</div>
          </div>
          <button className="btn pricing-pf__mini-btn" onClick={handleRefresh}>
            Обновить статус
          </button>
        </section>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <section className="pricing-pf__hero">
        <div className="pricing-pf__brand">
          <img src="/logo-mark.png" alt="Логотип СкладОнлайн" />
          <div>
            <strong>СкладОнлайн</strong>
            <span>Подписка для вашей команды</span>
          </div>
        </div>

        <h1 className="pricing-pf__title">Тарифы</h1>

        <div className="pricing-pf__periods" role="tablist" aria-label="Период оплаты">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`pricing-pf__period-btn ${option.id === periodId ? "is-active" : ""}`}
              onClick={() => setPeriodId(option.id)}
            >
              <span>{option.label}</span>
              {option.discountPct > 0 && (
                <span className="pricing-pf__period-discount">-{option.discountPct}%</span>
              )}
            </button>
          ))}
        </div>

        <p className="pricing-pf__subtitle">
          Период: <b>{selectedPeriod.label}</b>. Один платеж на организацию, все сотрудники работают
          в единой системе по вашим правам.
        </p>
      </section>

      {showTrialCard && (
        <section className="pricing-pf__trial">
          <div>
            <div className="pricing-pf__trial-title">Пробный период 30 дней</div>
            <div className="pricing-pf__trial-text">Полный функционал без ограничений, один раз на компанию.</div>
          </div>
          <button
            className="btn pricing-pf__trial-btn"
            onClick={handleStartTrial}
            disabled={loading || !canManageBilling || !trialAvailable}
          >
            {loading ? "Активируем..." : "Начать бесплатно"}
          </button>
        </section>
      )}

      <section className="pricing-pf__cards">
        {PLAN_CARDS.map((plan) => {
          const displayAmount = plan.available ? getPeriodAmount(plan.amount, periodId) : 0;
          return (
            <article
              key={plan.key}
              className={`pricing-pf__card ${plan.spotlight ? "pricing-pf__card--spotlight" : ""}`}
            >
              <div className="pricing-pf__card-head">
                <h2>{plan.title}</h2>
                {plan.spotlight ? <span className="pricing-pf__tag">Популярный</span> : null}
              </div>

              <div className="pricing-pf__card-subtitle">{plan.subtitle}</div>

              <div className="pricing-pf__price-row">
                <div className="pricing-pf__price">
                  {plan.available ? formatPrice(displayAmount, plan.currency) : "—"}
                </div>
                <div className="pricing-pf__period">/ {getPeriodLabel(periodId)}</div>
              </div>

              <ul className="pricing-pf__bullets">
                {plan.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <div className="pricing-pf__actions">
                <button
                  className="btn pricing-pf__btn pricing-pf__btn--dark"
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
                  className="btn pricing-pf__btn pricing-pf__btn--light"
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
                <div className="pricing-pf__hint">Тариф будет подключен на следующем этапе.</div>
              )}
              {plan.available && !billingReady && (
                <div className="pricing-pf__hint">Платежи появятся после подключения YooKassa.</div>
              )}
              {plan.available && extendedPeriodSelected && (
                <div className="pricing-pf__hint">Оплата за 6/12 месяцев будет добавлена отдельным этапом.</div>
              )}
            </article>
          );
        })}
      </section>

      <section className="pricing-pf__matrix">
        <h3>Сравнение тарифов</h3>
        <div className="pricing-pf__table-wrap">
          <table className="pricing-pf__table">
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
                  <td>{mark(row.growth)}</td>
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
