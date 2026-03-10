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
    description:
      "Для малого и среднего склада. Закрывает ежедневные операции без лишней сложности.",
    toolsCount: 4,
    amount: 1990,
    currency: "RUB",
    highlight: "Рекомендуем",
    available: true,
    features: [
      "Приемка и размещение",
      "Отбор и отгрузка",
      "Мобильный режим ТСД",
      "Роли сотрудников",
    ],
  },
  {
    key: "growth",
    id: null,
    title: "Базовый",
    description:
      "Для растущих команд с повышенной нагрузкой и потребностью в расширенной аналитике.",
    toolsCount: 7,
    amount: 0,
    currency: "RUB",
    highlight: "Скоро",
    available: false,
    features: [
      "Расширенная аналитика",
      "Дополнительные модули склада",
      "Приоритетная поддержка",
    ],
  },
  {
    key: "corp",
    id: null,
    title: "Корпоративный",
    description:
      "Для сетей складов, сложных процессов и интеграций под индивидуальные требования.",
    toolsCount: 10,
    amount: 0,
    currency: "RUB",
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
  return "30 дней";
}

function getFirstAvailablePlanKey() {
  return PLAN_CARDS.find((plan) => plan.available)?.key || PLAN_CARDS[0].key;
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
  const [selectedPlanKey, setSelectedPlanKey] = useState(getFirstAvailablePlanKey());

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";

  const selectedPlan = useMemo(
    () => PLAN_CARDS.find((plan) => plan.key === selectedPlanKey) || PLAN_CARDS[0],
    [selectedPlanKey]
  );

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
    <div className="page pricing-rs">
      {!canManageBilling && (
        <div className="pricing-rs__notice">
          Оплату и запуск пробного периода выполняет администратор вашей компании.
        </div>
      )}

      {subscription?.isActive && (
        <section className="pricing-rs__active">
          <div>
            <div className="pricing-rs__active-title">Подписка активна</div>
            <div className="pricing-rs__active-subtitle">Оплачено до: {paidUntilDate}</div>
          </div>
          <button className="btn pricing-rs__mini-btn" onClick={handleRefresh}>
            Обновить статус
          </button>
        </section>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <section className="pricing-rs__panel">
        <div className="pricing-rs__brand">
          <img src="/logo-mark.png" alt="Логотип СкладОнлайн" />
          <div className="pricing-rs__brand-text">
            <strong>СкладОнлайн</strong>
            <span>Подписка и тарифы</span>
          </div>
        </div>

        <h1 className="pricing-rs__title">Цены</h1>

        <div className="pricing-rs__periods" role="tablist" aria-label="Период оплаты">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`pricing-rs__period-btn ${option.id === periodId ? "is-active" : ""}`}
              onClick={() => setPeriodId(option.id)}
            >
              <span>{option.label}</span>
              {option.discountPct > 0 && (
                <span className="pricing-rs__period-discount">-{option.discountPct}%</span>
              )}
            </button>
          ))}
        </div>

        <div className="pricing-rs__range">
          <div className="pricing-rs__range-label">20 000 операций</div>
          <div className="pricing-rs__range-track" aria-hidden="true">
            <span className="pricing-rs__range-thumb" />
          </div>
        </div>

        <div className="pricing-rs__layout">
          <div className="pricing-rs__plans" role="listbox" aria-label="Список тарифов">
            {PLAN_CARDS.map((plan) => {
              const displayAmount = plan.available
                ? getPeriodAmount(plan.amount, periodId)
                : 0;
              const regularAmount = plan.available
                ? Number(plan.amount) * getPeriodMonths(periodId)
                : 0;
              const showOldPrice = plan.available && selectedPeriod.discountPct > 0;

              return (
                <button
                  key={plan.key}
                  type="button"
                  className={`pricing-rs__plan ${plan.key === selectedPlan.key ? "is-active" : ""}`}
                  onClick={() => setSelectedPlanKey(plan.key)}
                >
                  <div className="pricing-rs__plan-head">
                    <span className="pricing-rs__radio" aria-hidden="true" />
                    <div>
                      <div className="pricing-rs__plan-title">{plan.title}</div>
                      <div className="pricing-rs__plan-tools">{plan.toolsCount} инструментов</div>
                    </div>
                  </div>

                  <div className="pricing-rs__plan-price-row">
                    <div className="pricing-rs__plan-price">
                      {plan.available ? formatPrice(displayAmount, plan.currency) : "—"}
                    </div>
                    {showOldPrice ? (
                      <div className="pricing-rs__plan-old">
                        {formatPrice(regularAmount, plan.currency)}
                      </div>
                    ) : null}
                  </div>

                  {showOldPrice ? (
                    <div className="pricing-rs__plan-discount">
                      Скидка {selectedPeriod.discountPct}% при оплате за {getPeriodLabel(periodId).toLowerCase()}
                    </div>
                  ) : (
                    <div className="pricing-rs__plan-discount pricing-rs__plan-discount--empty">&nbsp;</div>
                  )}
                </button>
              );
            })}
          </div>

          <aside className="pricing-rs__details">
            <h2 className="pricing-rs__details-title">
              Инструменты, включенные в тариф «{selectedPlan.title}»
            </h2>
            <p className="pricing-rs__details-desc">{selectedPlan.description}</p>

            <ul className="pricing-rs__features">
              {selectedPlan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>

            <div className="pricing-rs__actions">
              <button
                className="btn pricing-rs__btn pricing-rs__btn--dark"
                onClick={() => handlePay(selectedPlan.id, "sbp")}
                disabled={
                  !selectedPlan.available ||
                  extendedPeriodSelected ||
                  loading ||
                  billingLoading ||
                  !billingReady ||
                  !canManageBilling
                }
              >
                {selectedPlan.available
                  ? loading && loadingMethod === "sbp"
                    ? "Переход к оплате..."
                    : "Оплатить по СБП"
                  : "Скоро"}
              </button>

              <button
                className="btn pricing-rs__btn pricing-rs__btn--light"
                onClick={() => handlePay(selectedPlan.id, "default")}
                disabled={
                  !selectedPlan.available ||
                  extendedPeriodSelected ||
                  loading ||
                  billingLoading ||
                  !billingReady ||
                  !canManageBilling
                }
              >
                {selectedPlan.available
                  ? loading && loadingMethod === "default"
                    ? "Переход к оплате..."
                    : "Оплатить картой"
                  : "Недоступно"}
              </button>
            </div>

            {showTrialCard && (
              <div className="pricing-rs__trial">
                <button
                  className="btn pricing-rs__btn pricing-rs__btn--dark"
                  onClick={handleStartTrial}
                  disabled={loading || !canManageBilling || !trialAvailable}
                >
                  {loading ? "Активируем..." : "Начать 30 дней бесплатно"}
                </button>
              </div>
            )}

            {!billingReady && selectedPlan.available && (
              <div className="pricing-rs__hint">
                Платежи будут доступны после подключения YooKassa.
              </div>
            )}

            {extendedPeriodSelected && selectedPlan.available && (
              <div className="pricing-rs__hint">
                Оплата за 6 месяцев и 1 год будет подключена следующим этапом.
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
