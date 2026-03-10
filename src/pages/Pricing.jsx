import { useEffect, useState } from "react";
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
    id: "basic-30",
    title: "Старт",
    amount: 1990,
    currency: "RUB",
    description:
      "Базовый тариф для запуска склада: приемка, размещение, отбор, мобильный ТСД и роли сотрудников.",
    highlight: "Рекомендуем",
    available: true,
    features: [
      "Все складские сценарии",
      "Доступ для сотрудников по ролям",
      "Мобильный режим ТСД",
      "Поддержка SaaS-изоляции",
    ],
  },
  {
    id: null,
    title: "Рост",
    amount: 0,
    currency: "RUB",
    description:
      "Для расширенных процессов: больше автоматизации, расширенная аналитика и пакет дополнительных функций.",
    highlight: "Скоро",
    available: false,
    features: [
      "Расширенная аналитика",
      "Дополнительные модули склада",
      "Приоритетная поддержка",
    ],
  },
  {
    id: null,
    title: "Корпоративный",
    amount: 0,
    currency: "RUB",
    description:
      "Для сетей складов и сложных интеграций с индивидуальными условиями внедрения и сопровождения.",
    highlight: "Индивидуально",
    available: false,
    features: [
      "Индивидуальные условия",
      "Кастомные интеграции",
      "Выделенный SLA",
    ],
  },
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

function getPeriodAmount(baseAmount, periodId) {
  const monthly = Number(baseAmount || 0);
  if (periodId === "6m") return Math.round(monthly * 6 * 0.9);
  if (periodId === "12m") return Math.round(monthly * 12 * 0.7);
  return monthly;
}

function getPeriodLabel(periodId) {
  if (periodId === "6m") return "6 месяцев";
  if (periodId === "12m") return "1 год";
  return "30 дней";
}

export default function Pricing() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);
  const [periodId, setPeriodId] = useState("1m");

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";

  const extendedPeriodSelected = periodId !== "1m";


  const handlePay = async (planId) => {
    if (!planId) {
      setError("Этот тариф пока недоступен для онлайн-оплаты.");
      return;
    }

    if (extendedPeriodSelected) {
      setError("Онлайн-оплата пока доступна только для периода 1 месяц.");
      return;
    }

    if (!canManageBilling) {
      setError("Оплату выполняет администратор вашей компании.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const token = localStorage.getItem("token");
      const res = await apiFetch("/billing/yookassa/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId, paymentMethod: "sbp" }),
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

  const subscription = user?.subscription;
  const trialAvailable = !subscription?.isActive && !subscription?.trialUsed;
  const showTrialCard = !subscription?.isActive;
  const paidUntilDate = subscription?.paidUntil
    ? new Date(subscription.paidUntil).toLocaleDateString("ru-RU")
    : "—";

  const handleRefresh = async () => {
    await refreshUser();
    navigate("/warehouse");
  };

  return (
    <div className="page pricing-modern">
      <section className="pricing-modern__hero">
        <div className="pricing-modern__brand">
          <img src="/logo-mark.png" alt="Логотип СкладОнлайн" />
          <span>СкладОнлайн</span>
        </div>
        <span className="pricing-modern__pill">SaaS-подписка</span>
        <h1 className="pricing-modern__title pricing-modern__title--center">Цены</h1>

        <div className="pricing-modern__periods" role="tablist" aria-label="Период оплаты">
          {PERIOD_OPTIONS.map((option) => (
            <div
              key={option.id}
              role="button"
              tabIndex={0}
              aria-pressed={option.id === periodId}
              className={`pricing-modern__period-btn ${option.id === periodId ? "is-active" : ""}`}
              onClick={() => setPeriodId(option.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setPeriodId(option.id);
                }
              }}
            >
              <span>{option.label}</span>
              {option.discountPct > 0 && (
                <span className="pricing-modern__period-discount">-{option.discountPct}%</span>
              )}
            </div>
          ))}
        </div>

        <p className="pricing-modern__subtitle pricing-modern__subtitle--center">
          Один платеж на организацию. Все сотрудники работают в единой системе
          по назначенным правам.
        </p>
      </section>

      {!canManageBilling && (
        <div className="pricing-modern__notice">
          Оплату и запуск пробного периода выполняет администратор вашей компании.
        </div>
      )}

      {subscription?.isActive && (
        <section className="pricing-modern__active">
          <div>
            <div className="pricing-modern__active-title">Подписка активна</div>
            <div className="pricing-modern__active-subtitle">Оплачено до: {paidUntilDate}</div>
          </div>
          <button className="btn pricing-modern__status-btn" onClick={handleRefresh}>
            Обновить статус
          </button>
        </section>
      )}

      {error && <div className="alert alert--error pricing-modern__alert">{error}</div>}

      <section className="pricing-modern__grid pricing-modern__grid--plans">
        {showTrialCard && (
          <article className="pricing-modern__card pricing-modern__card--trial">
            <div className="pricing-modern__card-head">
              <h2>Пробный период</h2>
              <span className="pricing-modern__badge">Бесплатно</span>
            </div>
            <p>Один раз на 30 дней. Полный функционал без ограничений.</p>
            <ul className="pricing-modern__list">
              <li>Склад и мобильный ТСД</li>
              <li>Права сотрудников</li>
              <li>Заказы, приемка, отбор, размещение</li>
            </ul>
            <div className="pricing-modern__actions pricing-modern__actions--single">
              <button
                className="btn pricing-modern__cta pricing-modern__cta--dark"
                onClick={handleStartTrial}
                disabled={loading || !canManageBilling || !trialAvailable}
              >
                {loading ? "Оплатить" : "Оплатить"}
              </button>
            </div>
            {!trialAvailable && (
              <div className="pricing-modern__hint">
                Пробный период уже использован. Выберите оплату тарифа ниже.
              </div>
            )}
          </article>
        )}

        {PLAN_CARDS.map((plan) => {
          const displayAmount = plan.available
            ? getPeriodAmount(plan.amount, periodId)
            : 0;
          const canPayCurrentPlan =
            plan.available && !extendedPeriodSelected && billingReady && canManageBilling;

          return (
            <article
              key={plan.title}
              className={`pricing-modern__card pricing-modern__card--plan ${
                plan.available ? "pricing-modern__card--featured" : ""
              }`}
            >
              <div className="pricing-modern__card-head">
                <h2>{plan.title}</h2>
                <span className="pricing-modern__badge pricing-modern__badge--accent">
                  {plan.highlight}
                </span>
              </div>

              <p>{plan.description}</p>

              <div className="pricing-modern__price-row">
                <span className="pricing-modern__price">
                  {plan.available ? formatPrice(displayAmount, plan.currency) : "—"}
                </span>
                <span className="pricing-modern__period">/ {getPeriodLabel(periodId)}</span>
              </div>

              <ul className="pricing-modern__list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="pricing-modern__actions pricing-modern__actions--single">
                <button
                  className="btn pricing-modern__cta pricing-modern__cta--dark"
                  onClick={() => handlePay(plan.id)}
                  disabled={
                    !plan.available ||
                    extendedPeriodSelected ||
                    loading ||
                    billingLoading ||
                    !billingReady ||
                    !canManageBilling
                  }
                >
                  {loading ? "Оплатить" : "Оплатить"}
                </button>
              </div>

              {plan.available && !billingReady && (
                <div className="pricing-modern__hint">
                  Платежи будут доступны после подключения YooKassa.
                </div>
              )}

              {plan.available && extendedPeriodSelected && (
                <div className="pricing-modern__hint">
                  Оплата за 6 месяцев и 1 год будет подключена следующим этапом.
                </div>
              )}

              {!plan.available && (
                <div className="pricing-modern__hint">
                  Этот пакет можно подключить на следующем этапе развития биллинга.
                </div>
              )}

              {plan.available && canPayCurrentPlan && (
                <div className="pricing-modern__hint">Платеж пройдет через YooKassa.</div>
              )}
            </article>
          );
        })}
      </section>

      <section className="pricing-modern__trust">
        <div>Безопасная оплата через YooKassa</div>
        <div>Доступ управляется на уровне компании</div>
        <div>Оплату запускает только администратор</div>
      </section>

      <section className="pricing-modern__faq">
        <h3>Частые вопросы</h3>
        <details>
          <summary>Кто должен оплачивать доступ?</summary>
          <p>
            Оплату выполняет администратор клиента. После оплаты доступ получают
            сотрудники его компании.
          </p>
        </details>
        <details>
          <summary>Сотрудник может сам оплатить тариф?</summary>
          <p>Нет, оплату и запуск trial делает только администратор компании.</p>
        </details>
        <details>
          <summary>Что будет после окончания подписки?</summary>
          <p>Доступ к рабочим разделам будет ограничен до продления подписки.</p>
        </details>
      </section>

      <div className="pricing-modern__footnote">
        Нажимая кнопку оплаты, вы подтверждаете согласие с условиями оферты и
        политикой конфиденциальности.
      </div>
    </div>
  );
}
