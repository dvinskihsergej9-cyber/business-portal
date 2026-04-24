import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const PERIOD_OPTIONS = [
  { id: "1m", label: "1 РјРµСЃСЏС†", discountPct: 0 },
  { id: "6m", label: "6 РјРµСЃСЏС†РµРІ", discountPct: 10 },
  { id: "12m", label: "1 РіРѕРґ", discountPct: 30 },
];

const BASIC_SKU_ADDON_PACKAGES = [
  { sku: 50, price: 500, label: "+50 SKU" },
  { sku: 100, price: 900, label: "+100 SKU" },
  { sku: 200, price: 1500, label: "+200 SKU" },
];

const PLAN_CARDS = [
  {
    id: "start-30",
    title: "РЎС‚Р°СЂС‚",
    amount: 1,
    currency: "RUB",
    description: "РџРѕР»РЅС‹Р№ С„СѓРЅРєС†РёРѕРЅР°Р» СЃ РјРёРЅРёРјР°Р»СЊРЅС‹РјРё Р»РёРјРёС‚Р°РјРё РґР»СЏ СЃС‚Р°СЂС‚Р°.",
    highlight: "РџСЂРѕР±РЅС‹Р№ Р·Р°РїСѓСЃРє",
    available: true,
    features: [
      "Р”Рѕ 2 Р°РєС‚РёРІРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РІ РєРѕРјРїР°РЅРёРё",
      "50 SKU (РЅРѕРјРµРЅРєР»Р°С‚СѓСЂ) РІРєР»СЋС‡РµРЅРѕ",
      "РџРѕР»РЅС‹Р№ РґРѕСЃС‚СѓРї РєРѕ РІСЃРµРј СЂР°Р·РґРµР»Р°Рј СЃРєР»Р°РґР°",
      "РџРѕР»РЅС‹Р№ РјРѕР±РёР»СЊРЅС‹Р№ РўРЎР” Рё СЂРѕР»Рё СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ",
      "РўР°СЂРёС„ РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ РѕРґРёРЅ СЂР°Р·",
    ],
  },
  {
    id: "basic-30",
    title: "Р‘Р°Р·РѕРІС‹Р№",
    amount: 2990,
    currency: "RUB",
    description: "РЈСЂРµР·Р°РЅРЅС‹Р№ С„СѓРЅРєС†РёРѕРЅР°Р» РґР»СЏ Р±Р°Р·РѕРІС‹С… РїСЂРѕС†РµСЃСЃРѕРІ Рё РїРµСЂРІС‹С… РѕРїРµСЂР°С†РёР№.",
    highlight: "РћРїС‚РёРјР°Р»СЊРЅС‹Р№",
    available: true,
    features: [
      "Р”Рѕ 5 Р°РєС‚РёРІРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РІ РєРѕРјРїР°РЅРёРё",
      "100 SKU РІРєР»СЋС‡РµРЅРѕ",
      "Р‘РµР· Р±Р»РѕРєРёСЂРѕРІРєРё РѕСЃС‚Р°С‚РєРѕРІ",
      "Р‘РµР· РєСЂРѕСЃСЃ-РґРѕРєРёРЅРіР°",
      "Р‘РµР· Р±РёР»Р»РёРЅРіР° СЃР±РѕСЂРєРё",
      "РЎС‚Р°РЅРґР°СЂС‚РЅР°СЏ РїРѕРґРґРµСЂР¶РєР° (РІ СЂР°Р±РѕС‡РµРµ РІСЂРµРјСЏ)",
      "РРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹Рµ Р°РІС‚РѕРјР°С‚РёР·Р°С†РёРё РЅРµ РІРєР»СЋС‡РµРЅС‹",
      "РњРѕР¶РЅРѕ РґРѕРєСѓРїР°С‚СЊ РїР°РєРµС‚С‹ SKU",
    ],
  },
  {
    id: "pro-30",
    title: "РџСЂРѕС„",
    amount: 4990,
    currency: "RUB",
    description: "РџРѕР»РЅС‹Р№ С„СѓРЅРєС†РёРѕРЅР°Р» РґР»СЏ Р°РєС‚РёРІРЅРѕР№ РєРѕРјР°РЅРґС‹ Рё РјР°СЃС€С‚Р°Р±РёСЂРѕРІР°РЅРёСЏ РїСЂРѕС†РµСЃСЃРѕРІ.",
    highlight: "РњР°РєСЃРёРјСѓРј",
    available: true,
    features: [
      "Р”Рѕ 30 Р°РєС‚РёРІРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РІ РєРѕРјРїР°РЅРёРё",
      "500 SKU РІРєР»СЋС‡РµРЅРѕ",
      "РџРѕР»РЅС‹Р№ РґРѕСЃС‚СѓРї РєРѕ РІСЃРµРј СЂР°Р·РґРµР»Р°Рј СЃРєР»Р°РґР°",
      "РџРѕР»РЅС‹Р№ РјРѕР±РёР»СЊРЅС‹Р№ РўРЎР” Рё СЂРѕР»Рё СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ",
      "Р‘Р»РѕРєРёСЂРѕРІРєР° РѕСЃС‚Р°С‚РєРѕРІ, РєСЂРѕСЃСЃ-РґРѕРєРёРЅРі Рё Р±РёР»Р»РёРЅРі СЃР±РѕСЂРєРё РІРєР»СЋС‡РµРЅС‹",
      "РџСЂРёРѕСЂРёС‚РµС‚РЅР°СЏ РїРѕРґРґРµСЂР¶РєР°",
      "РРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹Рµ Р°РІС‚РѕРјР°С‚РёР·Р°С†РёРё РїРѕРґ РєР»РёРµРЅС‚Р°",
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
  if (periodId === "6m") return "6 РјРµСЃСЏС†РµРІ";
  if (periodId === "12m") return "1 РіРѕРґ";
  return "30 РґРЅРµР№";
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
  const [skuRenewalSummary, setSkuRenewalSummary] = useState(null);
  const [skuRenewalLoading, setSkuRenewalLoading] = useState(false);

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";
  const currentPlanId = String(user?.subscription?.plan || "").trim().toLowerCase();
  const isCurrentBasicActive =
    currentPlanId === "basic-30" && Boolean(user?.subscription?.isActive);
  const currentBasicAddonUnits =
    currentPlanId === "basic-30" ? Math.max(0, Number(user?.subscription?.skuAddonUnits || 0) || 0) : 0;
  const recommendedRenewalAddonUnits = Math.max(
    0,
    Number(skuRenewalSummary?.recommendedSkuAddonUnits || 0) || 0
  );
  const renewalOverLimitSkuCount = Math.max(
    0,
    Number(skuRenewalSummary?.overLimitSkuCount || 0) || 0
  );
  const renewalCurrentSkuCount = Math.max(
    0,
    Number(skuRenewalSummary?.currentSkuCount || 0) || 0
  );
  const renewalBaseSkuLimit = Math.max(
    0,
    Number(skuRenewalSummary?.baseSkuLimit || 0) || 0
  );
  const defaultBasicAddonUnits = Math.max(currentBasicAddonUnits, recommendedRenewalAddonUnits);
  const defaultBasicSkuAddons = getBasicSkuAddonPresetFromUnits(defaultBasicAddonUnits);
  const effectiveBasicSkuAddons = basicSkuAddonsTouched ? basicSkuAddons : defaultBasicSkuAddons;
  const isBasicCarryMode =
    !basicSkuAddonsTouched && defaultBasicAddonUnits > 0 && periodId === "1m";

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
      const selectedSkuAddonUnits = selectedSkuAddons.reduce(
        (sum, value) => sum + Math.max(0, Number(value || 0) || 0),
        0
      );
      const isSkuAddonTopupPayment = Boolean(options.useTopup);
      let acceptSkuTrim = options.acceptSkuTrim === true;
      const endpoint = isSkuAddonTopupPayment
        ? "/billing/yookassa/create-sku-addon-payment"
        : "/billing/yookassa/create-payment";

      if (
        !isSkuAddonTopupPayment &&
        String(planId || "").trim().toLowerCase() === "basic-30" &&
        renewalOverLimitSkuCount > 0 &&
        !acceptSkuTrim
      ) {
        const projectedOverLimit = Math.max(
          0,
          renewalCurrentSkuCount - (renewalBaseSkuLimit + selectedSkuAddonUnits)
        );
        if (projectedOverLimit > 0) {
          const confirmed = window.confirm(
            `Сверх лимита останется ${projectedOverLimit} SKU. Если продолжить без доп-SKU, эти SKU будут удалены после оплаты. Продолжить?`
          );
          if (!confirmed) {
            return;
          }
          acceptSkuTrim = true;
        }
      }

      const token = localStorage.getItem("token");
      let res = await apiFetch(endpoint, {
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
          acceptSkuTrim,
        }),
      });
      let data = await res.json().catch(() => ({}));

      if (!res.ok && data?.message === "SKU_TRIM_CONFIRM_REQUIRED" && !acceptSkuTrim) {
        const projectedOverLimit = Math.max(
          0,
          Number(data?.detail?.overLimitSkuCount || 0) || 0
        );
        const confirmed = window.confirm(
          `Сверх лимита останется ${projectedOverLimit} SKU. Эти SKU будут удалены после оплаты. Продолжить?`
        );
        if (!confirmed) {
          return;
        }

        res = await apiFetch(endpoint, {
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
            acceptSkuTrim: true,
          }),
        });
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        setError(normalizeErrorMessage(data?.message || "", "Не удалось инициировать оплату."));
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

  const loadSkuRenewalSummary = async () => {
    if (!canManageBilling || user?.isSystemOwner) {
      setSkuRenewalSummary(null);
      return;
    }
    try {
      setSkuRenewalLoading(true);
      const token = localStorage.getItem("token");
      const res = await apiFetch("/billing/sku-renewal-summary", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "BILLING_SKU_RENEWAL_SUMMARY_ERROR");
      }
      setSkuRenewalSummary(data || null);
    } catch (err) {
      console.error("sku renewal summary error:", err);
      setSkuRenewalSummary(null);
    } finally {
      setSkuRenewalLoading(false);
    }
  };

  useEffect(() => {
    loadBillingConfig();
  }, []);

  useEffect(() => {
    loadSkuRenewalSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageBilling, user?.isSystemOwner, user?.orgId]);

  const subscription = user?.subscription;
  const paidUntilDate = subscription?.paidUntil
    ? new Date(subscription.paidUntil).toLocaleDateString("ru-RU")
    : "вЂ”";
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
            РќР°Р·Р°Рґ
          </button>
          {canUseSupport ? (
            <button
              type="button"
              className="pricing-modern__back-login pricing-modern__support-link"
              onClick={handleOpenSupport}
            >
              РџРѕРґРґРµСЂР¶РєР°
            </button>
          ) : null}
        </div>

        <div className="pricing-modern__brand">
          <img src="/logo-mark.png" alt="Р›РѕРіРѕС‚РёРї РЎРєР»Р°РґРћРЅР»Р°Р№РЅ" />
          <span>РЎРєР»Р°РґРћРЅР»Р°Р№РЅ</span>
        </div>
        <span className="pricing-modern__pill">SaaS-РїРѕРґРїРёСЃРєР°</span>
        <h1 className="pricing-modern__title pricing-modern__title--center">Р¦РµРЅС‹</h1>

        <div className="pricing-modern__periods" role="tablist" aria-label="РџРµСЂРёРѕРґ РѕРїР»Р°С‚С‹">
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
          РћРґРёРЅ РїР»Р°С‚РµР¶ РЅР° РѕСЂРіР°РЅРёР·Р°С†РёСЋ. Р’СЃРµ СЃРѕС‚СЂСѓРґРЅРёРєРё СЂР°Р±РѕС‚Р°СЋС‚ РІ РµРґРёРЅРѕР№ СЃРёСЃС‚РµРјРµ
          РїРѕ РЅР°Р·РЅР°С‡РµРЅРЅС‹Рј РїСЂР°РІР°Рј.
        </p>
      </section>

      {!canManageBilling && (
        <div className="pricing-modern__notice">
          РћРїР»Р°С‚Сѓ РІС‹РїРѕР»РЅСЏРµС‚ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ РІР°С€РµР№ РєРѕРјРїР°РЅРёРё.
        </div>
      )}

      {subscription?.isActive && (
        <section className="pricing-modern__active">
          <div>
            <div className="pricing-modern__active-title">РџРѕРґРїРёСЃРєР° Р°РєС‚РёРІРЅР°</div>
            <div className="pricing-modern__active-subtitle">РћРїР»Р°С‡РµРЅРѕ РґРѕ: {paidUntilDate}</div>
          </div>
        </section>
      )}

      {skuRenewalLoading && (
        <div className="pricing-modern__notice">
          Проверяем текущий объем SKU для продления...
        </div>
      )}

      {!skuRenewalLoading && renewalOverLimitSkuCount > 0 && (
        <div className="alert alert--error pricing-modern__alert">
          Сейчас SKU: {renewalCurrentSkuCount}. Базовый лимит: {renewalBaseSkuLimit}. Сверх лимита:{" "}
          {renewalOverLimitSkuCount}.
          <br />
          Рекомендуется докупить минимум +{recommendedRenewalAddonUnits} SKU при продлении, иначе лишние SKU
          будут удалены после оплаты.
        </div>
      )}

      {error && <div className="alert alert--error pricing-modern__alert">{error}</div>}

      {extendedPeriodSelected && (
        <div className="pricing-modern__notice">
          РўР°СЂРёС„ В«РЎС‚Р°СЂС‚В» РґРѕСЃС‚СѓРїРµРЅ С‚РѕР»СЊРєРѕ РЅР° РїРµСЂРёРѕРґ 1 РјРµСЃСЏС†.
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
                  {plan.available ? formatPrice(displayAmount, plan.currency) : "вЂ”"}
                </span>
                <span className="pricing-modern__period">/ {getPeriodLabel(periodId)}</span>
              </div>
              {isBasicTopupMode && (
                <div className="pricing-modern__hint">
                  Р”РѕРєСѓРїРєР° SKU Рє РґРµР№СЃС‚РІСѓСЋС‰РµРјСѓ С‚Р°СЂРёС„Сѓ В«Р‘Р°Р·РѕРІС‹Р№В» (Р±РµР· РїРѕРІС‚РѕСЂРЅРѕР№ РѕРїР»Р°С‚С‹ 2990 в‚Ѕ).
                </div>
              )}

              {isBasicPlan && isBasicCarryMode && !isBasicTopupMode && (
                <div className="pricing-modern__hint">
                  Для продления автоматически подобраны доп.пакеты SKU по текущему объему номенклатуры.
                </div>
              )}
              {isBasicPlan && (
                <div className="pricing-modern__sku-builder">
                  <div className="pricing-modern__sku-builder-title">РљР°Р»СЊРєСѓР»СЏС‚РѕСЂ SKU</div>
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
                    Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ: +{basicSkuAddonUnits} SKU / +{formatPrice(basicSkuAddonMonthlyAmount, "RUB")} РІ РјРµСЃСЏС†
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
                  {loading ? "РћРїР»Р°С‚РёС‚СЊ" : "РћРїР»Р°С‚РёС‚СЊ"}
                </button>
              </div>

              {plan.available && !billingReady && (
                <div className="pricing-modern__hint">
                  РџР»Р°С‚РµР¶Рё Р±СѓРґСѓС‚ РґРѕСЃС‚СѓРїРЅС‹ РїРѕСЃР»Рµ РїРѕРґРєР»СЋС‡РµРЅРёСЏ YooKassa.
                </div>
              )}

              {plan.available && canPayCurrentPlan && (
                <div className="pricing-modern__hint">
                  РџР»Р°С‚РµР¶ РїСЂРѕР№РґРµС‚ С‡РµСЂРµР· YooKassa, СЃРїРѕСЃРѕР± РѕРїР»Р°С‚С‹ РІС‹Р±РёСЂР°РµС‚СЃСЏ РЅР° СЃС‚СЂР°РЅРёС†Рµ РѕРїР»Р°С‚С‹.
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="pricing-modern__trust">
        <div>Р‘РµР·РѕРїР°СЃРЅР°СЏ РѕРїР»Р°С‚Р° С‡РµСЂРµР· YooKassa</div>
        <div>Р”РѕСЃС‚СѓРї СѓРїСЂР°РІР»СЏРµС‚СЃСЏ РЅР° СѓСЂРѕРІРЅРµ РєРѕРјРїР°РЅРёРё</div>
        <div>РћРїР»Р°С‚Сѓ Р·Р°РїСѓСЃРєР°РµС‚ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ</div>
      </section>

      <section className="pricing-modern__faq">
        <h3>Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹</h3>
        <details>
          <summary>РљС‚Рѕ РґРѕР»Р¶РµРЅ РѕРїР»Р°С‡РёРІР°С‚СЊ РґРѕСЃС‚СѓРї?</summary>
          <p>
            РћРїР»Р°С‚Сѓ РІС‹РїРѕР»РЅСЏРµС‚ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ РєР»РёРµРЅС‚Р°. РџРѕСЃР»Рµ РѕРїР»Р°С‚С‹ РґРѕСЃС‚СѓРї РїРѕР»СѓС‡Р°СЋС‚
            СЃРѕС‚СЂСѓРґРЅРёРєРё РµРіРѕ РєРѕРјРїР°РЅРёРё.
          </p>
        </details>
        <details>
          <summary>РЎРѕС‚СЂСѓРґРЅРёРє РјРѕР¶РµС‚ СЃР°Рј РѕРїР»Р°С‚РёС‚СЊ С‚Р°СЂРёС„?</summary>
          <p>РќРµС‚, РѕРїР»Р°С‚Сѓ РґРµР»Р°РµС‚ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ РєРѕРјРїР°РЅРёРё.</p>
        </details>
        <details>
          <summary>Р§С‚Рѕ Р±СѓРґРµС‚ РїРѕСЃР»Рµ РѕРєРѕРЅС‡Р°РЅРёСЏ РїРѕРґРїРёСЃРєРё?</summary>
          <p>Р”РѕСЃС‚СѓРї Рє СЂР°Р±РѕС‡РёРј СЂР°Р·РґРµР»Р°Рј Р±СѓРґРµС‚ РѕРіСЂР°РЅРёС‡РµРЅ РґРѕ РїСЂРѕРґР»РµРЅРёСЏ РїРѕРґРїРёСЃРєРё.</p>
        </details>
      </section>

      <div className="pricing-modern__footnote">
        РќР°Р¶РёРјР°СЏ РєРЅРѕРїРєСѓ РѕРїР»Р°С‚С‹, РІС‹ РїРѕРґС‚РІРµСЂР¶РґР°РµС‚Рµ СЃРѕРіР»Р°СЃРёРµ СЃ СѓСЃР»РѕРІРёСЏРјРё РѕС„РµСЂС‚С‹ Рё
        РїРѕР»РёС‚РёРєРѕР№ РєРѕРЅС„РёРґРµРЅС†РёР°Р»СЊРЅРѕСЃС‚Рё.
      </div>
    </div>
  );
}

