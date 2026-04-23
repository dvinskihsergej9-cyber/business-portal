import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const PERIOD_OPTIONS = [
  { id: "1m", label: "1 месяц", discountPct: 0 },
  { id: "6m", label: "6 месяцев", discountPct: 10 },
  { id: "12m", label: "1 год", discountPct: 30 },
];

const BASIC_SKU_ADDON_PACKAGES = [
  { sku: 50, price: 500, label: "+50 SKU" },
  { sku: 100, price: 900, label: "+100 SKU" },
  { sku: 200, price: 1500, label: "+200 SKU" },
];

const PLAN_CARDS = [
  {
    id: "start-30",
    title: "Старт",
    amount: 1,
    currency: "RUB",
    description: "Полный функционал с минимальными лимитами для старта.",
    highlight: "Пробный запуск",
    available: true,
    features: [
      "До 2 активных сотрудников в компании",
      "50 SKU (номенклатур) включено",
      "Полный доступ ко всем разделам склада",
      "Полный мобильный ТСД и роли сотрудников",
      "Тариф доступен только один раз",
    ],
  },
  {
    id: "basic-30",
    title: "Базовый",
    amount: 2990,
    currency: "RUB",
    description: "Урезанный функционал для базовых процессов и первых операций.",
    highlight: "Оптимальный",
    available: true,
    features: [
      "До 5 активных сотрудников в компании",
      "100 SKU включено",
      "Без блокировки остатков",
      "Без кросс-докинга",
      "Без биллинга сборки",
      "Стандартная поддержка (в рабочее время)",
      "Индивидуальные автоматизации не включены",
      "Можно докупать пакеты SKU",
    ],
  },
  {
    id: "pro-30",
    title: "Проф",
    amount: 4990,
    currency: "RUB",
    description: "Полный функционал для активной команды и масштабирования процессов.",
    highlight: "Максимум",
    available: true,
    features: [
      "До 30 активных сотрудников в компании",
      "500 SKU включено",
      "Полный доступ ко всем разделам склада",
      "Полный мобильный ТСД и роли сотрудников",
      "Блокировка остатков, кросс-докинг и биллинг сборки включены",
      "Приоритетная поддержка",
      "Индивидуальные автоматизации под клиента",
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
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);
  const [periodId, setPeriodId] = useState("1m");
  const [basicSkuAddons, setBasicSkuAddons] = useState([]);

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";

  const extendedPeriodSelected = periodId !== "1m";
  const basicSkuAddonMonthlyAmount = basicSkuAddons.reduce(
    (sum, value) => sum + Number(value.price || 0),
    0
  );
  const basicSkuAddonUnits = basicSkuAddons.reduce(
    (sum, value) => sum + Number(value.sku || 0),
    0
  );

  const toggleBasicSkuAddon = (pkg) => {
    setBasicSkuAddons((current) => {
      const index = current.findIndex(
        (entry) => Number(entry.sku) === Number(pkg.sku) && Number(entry.price) === Number(pkg.price)
      );
      if (index >= 0) {
        return current.filter((_, idx) => idx !== index);
      }
      return [...current, pkg];
    });
  };

  const handlePay = async (planId, options = {}) => {
    if (!planId) {
      setError("Этот тариф пока недоступен для онлайн-оплаты.");
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
        body: JSON.stringify({
          planId,
          periodId,
          paymentMethod: "default",
          skuAddons: Array.isArray(options.skuAddons) ? options.skuAddons : [],
        }),
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
  const paidUntilDate = subscription?.paidUntil
    ? new Date(subscription.paidUntil).toLocaleDateString("ru-RU")
    : "—";
  const canUseSupport = Boolean(user?.role === "ADMIN");
  const visiblePlanCards = PLAN_CARDS.filter(
    (plan) => periodId === "1m" || plan.id !== "start-30"
  );

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/warehouse");
  };

  const handleOpenSupport = () => {
    navigate("/support");
  };

  return (
    <div className="page pricing-modern">
      <section className="pricing-modern__hero">
        <div className="pricing-modern__top-actions">
          <button
            type="button"
            className="pricing-modern__back-login"
            onClick={handleBack}
          >
            Назад
          </button>
          {canUseSupport ? (
            <button
              type="button"
              className="pricing-modern__back-login pricing-modern__support-link"
              onClick={handleOpenSupport}
            >
              Поддержка
            </button>
          ) : null}
        </div>

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
          Оплату выполняет администратор вашей компании.
        </div>
      )}

      {subscription?.isActive && (
        <section className="pricing-modern__active">
          <div>
            <div className="pricing-modern__active-title">Подписка активна</div>
            <div className="pricing-modern__active-subtitle">Оплачено до: {paidUntilDate}</div>
          </div>
        </section>
      )}

      {error && <div className="alert alert--error pricing-modern__alert">{error}</div>}

      {extendedPeriodSelected && (
        <div className="pricing-modern__notice">
          Тариф «Старт» доступен только на период 1 месяц.
        </div>
      )}

      <section className="pricing-modern__grid pricing-modern__grid--plans">
        {visiblePlanCards.map((plan) => {
          const isBasicPlan = plan.id === "basic-30";
          const monthlyAddonAmount = isBasicPlan ? basicSkuAddonMonthlyAmount : 0;
          const displayAmount = plan.available
            ? getPeriodAmount(plan.amount + monthlyAddonAmount, periodId)
            : 0;
          const canPayCurrentPlan =
            plan.available && billingReady && canManageBilling;

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

              {isBasicPlan && (
                <div className="pricing-modern__sku-builder">
                  <div className="pricing-modern__sku-builder-title">Калькулятор SKU</div>
                  <div className="pricing-modern__sku-builder-list">
                    {BASIC_SKU_ADDON_PACKAGES.map((pkg) => {
                      const checked = basicSkuAddons.some(
                        (entry) => Number(entry.sku) === Number(pkg.sku) && Number(entry.price) === Number(pkg.price)
                      );
                      return (
                        <button
                          key={`${pkg.sku}-${pkg.price}`}
                          type="button"
                          className={`pricing-modern__sku-chip ${checked ? "is-active" : ""}`}
                          onClick={() => toggleBasicSkuAddon(pkg)}
                        >
                          <span>{pkg.label}</span>
                          <span>+{formatPrice(pkg.price, "RUB")}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pricing-modern__sku-summary">
                    Дополнительно: +{basicSkuAddonUnits} SKU / +{formatPrice(basicSkuAddonMonthlyAmount, "RUB")} в месяц
                  </div>
                </div>
              )}

              <ul className="pricing-modern__list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="pricing-modern__actions pricing-modern__actions--single">
                <button
                  className="btn pricing-modern__cta pricing-modern__cta--dark"
                  onClick={() =>
                    handlePay(plan.id, {
                      skuAddons: isBasicPlan ? basicSkuAddons.map((entry) => entry.sku) : [],
                    })
                  }
                  disabled={
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

              {plan.available && canPayCurrentPlan && (
                <div className="pricing-modern__hint">
                  Платеж пройдет через YooKassa, способ оплаты выбирается на странице оплаты.
                </div>
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
          <p>Нет, оплату делает только администратор компании.</p>
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
