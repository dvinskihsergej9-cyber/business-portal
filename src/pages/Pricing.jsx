import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, normalizeErrorMessage } from "../apiConfig";
import { useAuth } from "../context/AuthContext";

const PLANS = [
  {
    id: "basic-30",
    title: "Базовый",
    amount: 1990,
    currency: "RUB",
    period: "30 дней",
    description: "Полный доступ к складу, мобильному ТСД и ролям сотрудников.",
    highlight: "Популярный",
    features: [
      "Все складские сценарии",
      "Доступ для сотрудников",
      "Поддержка мобильной работы",
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

export default function Pricing() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState("");
  const [error, setError] = useState("");
  const [billingReady, setBillingReady] = useState(false);
  const [billingLoading, setBillingLoading] = useState(true);

  const canManageBilling =
    user?.isSystemOwner === true ||
    (Array.isArray(user?.roles) && user.roles.includes("ADMIN")) ||
    user?.role === "ADMIN";

  const handlePay = async (planId, paymentMethod = "sbp") => {
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
        <span className="pricing-modern__pill">SaaS-подписка</span>
        <h1 className="pricing-modern__title">Доступ к порталу для всей вашей команды</h1>
        <p className="pricing-modern__subtitle">
          Один платёж на организацию. Все сотрудники вашего бизнеса получают доступ по выданным правам.
        </p>
        <div className="pricing-modern__stats">
          <div className="pricing-modern__stat">
            <div className="pricing-modern__stat-value">30 дней</div>
            <div className="pricing-modern__stat-label">пробный период</div>
          </div>
          <div className="pricing-modern__stat">
            <div className="pricing-modern__stat-value">1 тариф</div>
            <div className="pricing-modern__stat-label">без скрытых опций</div>
          </div>
          <div className="pricing-modern__stat">
            <div className="pricing-modern__stat-value">24/7</div>
            <div className="pricing-modern__stat-label">доступ к данным</div>
          </div>
        </div>
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
          <button className="btn" onClick={handleRefresh}>
            Обновить статус
          </button>
        </section>
      )}

      {error && <div className="alert alert--error pricing-modern__alert">{error}</div>}

      <section className="pricing-modern__grid">
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
              <li>Заказы, приёмка, отбор, размещение</li>
            </ul>
            <button
              className="btn primary pricing-modern__cta"
              onClick={handleStartTrial}
              disabled={loading || !canManageBilling || !trialAvailable}
            >
              {loading ? "Активируем..." : "Начать 30 дней бесплатно"}
            </button>
            {!trialAvailable && (
              <div className="pricing-modern__hint">
                Пробный период уже использован. Выберите оплату тарифа ниже.
              </div>
            )}
          </article>
        )}

        {PLANS.map((plan) => (
          <article key={plan.id} className="pricing-modern__card pricing-modern__card--plan">
            <div className="pricing-modern__card-head">
              <h2>{plan.title}</h2>
              <span className="pricing-modern__badge pricing-modern__badge--accent">
                {plan.highlight}
              </span>
            </div>
            <p>{plan.description}</p>
            <div className="pricing-modern__price-row">
              <span className="pricing-modern__price">{formatPrice(plan.amount, plan.currency)}</span>
              <span className="pricing-modern__period">/ {plan.period}</span>
            </div>
            <ul className="pricing-modern__list">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div className="pricing-modern__actions">
              <button
                className="btn primary pricing-modern__cta"
                onClick={() => handlePay(plan.id, "sbp")}
                disabled={loading || billingLoading || !billingReady || !canManageBilling}
              >
                {loading && loadingMethod === "sbp" ? "Переход к оплате..." : "Оплатить по СБП"}
              </button>
              <button
                className="btn pricing-modern__cta pricing-modern__cta--ghost"
                onClick={() => handlePay(plan.id, "default")}
                disabled={loading || billingLoading || !billingReady || !canManageBilling}
              >
                {loading && loadingMethod === "default" ? "Переход к оплате..." : "Оплатить картой"}
              </button>
            </div>
            {!billingReady && (
              <div className="pricing-modern__hint">
                Платежи будут доступны после подключения YooKassa.
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="pricing-modern__trust">
        <div>Безопасная оплата через YooKassa</div>
        <div>Доступ управляется на уровне компании</div>
        <div>Отмена продления через администратора</div>
      </section>

      <section className="pricing-modern__faq">
        <h3>Частые вопросы</h3>
        <details>
          <summary>Кто должен оплачивать доступ?</summary>
          <p>Оплату выполняет администратор клиента. После оплаты доступ получают его сотрудники.</p>
        </details>
        <details>
          <summary>Сотрудник может сам оплатить тариф?</summary>
          <p>Нет, сотрудник видит страницу, но оплату и trial запускает только администратор компании.</p>
        </details>
        <details>
          <summary>Что будет после окончания подписки?</summary>
          <p>Доступ к рабочим разделам будет ограничен до продления подписки.</p>
        </details>
      </section>

      <div className="pricing-modern__footnote">
        Нажимая кнопку оплаты, вы подтверждаете согласие с условиями оферты и политики конфиденциальности.
      </div>
    </div>
  );
}
