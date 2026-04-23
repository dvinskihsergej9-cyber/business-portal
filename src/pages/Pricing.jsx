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

function getBasicSkuAddonPresetFromUnits(unitsInput) {
  const units = Math.max(0, Number(unitsInput || 0) || 0);
  if (!units) return [];

  const normalizedUnits = Math.ceil(units / 50) * 50;
  const steps = Math.max(0, Math.floor(normalizedUnits / 50));
  if (!steps) return [];

  const options = [
    { sku: 50, price: 500, step: 1 },
    { sku: 100, price: 900, step: 2 },
    { sku: 200, price: 1500, step: 4 },
  ];
  const dp = Array.from({ length: steps + 1 }, () => ({ cost: Number.POSITIVE_INFINITY, pick: null }));
  dp[0] = { cost: 0, pick: null };

  for (let index = 1; index <= steps; index += 1) {
    options.forEach((option) => {
      const prev = index - option.step;
      if (prev < 0 || !Number.isFinite(dp[prev].cost)) return;
      const nextCost = dp[prev].cost + option.price;
      if (nextCost < dp[index].cost) {
        dp[index] = { cost: nextCost, pick: option };
      }
    });
  }

  if (!Number.isFinite(dp[steps].cost)) return [];

  const packages = [];
  let cursor = steps;
  while (cursor > 0) {
    const picked = dp[cursor].pick;
    if (!picked) break;
    packages.push({ sku: picked.sku, price: picked.price, label: `+${picked.sku} SKU` });
    cursor -= picked.step;
  }
  return packages;
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
  const [basicSkuAddonsTouched, setBasicSkuAddonsTouched] = useState(false);

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";
  const currentPlanId = String(user?.subscription?.plan || "").trim().toLowerCase();
  const isCurrentBasicActive =
    currentPlanId === "basic-30" && Boolean(user?.subscription?.isActive);
  const currentBasicAddonUnits =
    currentPlanId === "basic-30" ? Math.max(0, Number(user?.subscription?.skuAddonUnits || 0) || 0) : 0;
  const defaultBasicSkuAddons = getBasicSkuAddonPresetFromUnits(currentBasicAddonUnits);
  const effectiveBasicSkuAddons = basicSkuAddonsTouched ? basicSkuAddons : defaultBasicSkuAddons;
  const isBasicCarryMode =
    !basicSkuAddonsTouched && currentBasicAddonUnits > 0 && periodId === "1m";

  const extendedPeriodSelected = periodId !== "1m";
  const basicSkuAddonMonthlyAmount = effectiveBasicSkuAddons.reduce(
    (sum, value) => sum + Number(value.price || 0),
    0
  );
  const basicSkuAddonUnits = effectiveBasicSkuAddons.reduce(
    (sum, value) => sum + Number(value.sku || 0),
    0
  );

  const toggleBasicSkuAddon = (pkg) => {
    setBasicSkuAddonsTouched(true);
    setBasicSkuAddons((current) => {
      const source = basicSkuAddonsTouched ? current : defaultBasicSkuAddons;
      const index = source.findIndex(
        (entry) => Number(entry.sku) === Number(pkg.sku) && Number(entry.price) === Number(pkg.price)
      );
      if (index >= 0) {
        return source.filter((_, idx) => idx !== index);
      }
      return [...source, pkg];
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
      const selectedSkuAddons = Array.isArray(options.skuAddons) ? options.skuAddons : [];
      const isSkuAddonTopupPayment = Boolean(options.useTopup);
      const endpoint = isSkuAddonTopupPayment
        ? "/billing/yookassa/create-sku-addon-payment"
        : "/billing/yookassa/create-payment";

      const token = localStorage.getItem("token");
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planId,
          periodId,
          paymentMethod: "default",
          skuAddons: selectedSkuAddons,
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
          const addonsForPay = isBasicPlan ? effectiveBasicSkuAddons.map((entry) => entry.sku) : [];
          const isBasicTopupMode =
            isBasicPlan &&
            isCurrentBasicActive &&
            periodId === "1m" &&
            basicSkuAddonsTouched &&
            basicSkuAddonUnits > 0;
          const displayAmount = plan.available
            ? isBasicTopupMode
              ? monthlyAddonAmount
              : getPeriodAmount(plan.amount + monthlyAddonAmount, periodId)
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
              {isBasicTopupMode && (
                <div className="pricing-modern__hint">
                  Докупка SKU к действующему тарифу «Базовый» (без повторной оплаты 2990 ₽).
                </div>
              )}

              {isBasicPlan && isBasicCarryMode && !isBasicTopupMode && (
                <div className="pricing-modern__hint">
                  При продлении по умолчанию сохраняются текущие доп.пакеты SKU.
                </div>
              )}
              {isBasicPlan && (
                <div className="pricing-modern__sku-builder">
                  <div className="pricing-modern__sku-builder-title">Калькулятор SKU</div>
                  <div className="pricing-modern__sku-builder-list">
                    {BASIC_SKU_ADDON_PACKAGES.map((pkg) => {
                      const checked = effectiveBasicSkuAddons.some(
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
                      skuAddons: addonsForPay,
                      useTopup: isBasicTopupMode,
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
