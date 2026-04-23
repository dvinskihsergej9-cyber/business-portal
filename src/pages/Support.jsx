import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const SUPPORT_EMAIL = "noreplyskladonline@mail.ru";

const PLAN_LABELS = {
  "start-30": "Старт",
  "basic-30": "Базовый",
  "pro-30": "Проф",
  "platform-owner": "Владелец платформы",
};

const REQUEST_TYPES = [
  {
    id: "TECHNICAL",
    label: "Технический вопрос",
    subjectTag: "Техподдержка",
    automationOnly: false,
  },
  {
    id: "BILLING",
    label: "Оплата и тариф",
    subjectTag: "Биллинг",
    automationOnly: false,
  },
  {
    id: "ACCESS",
    label: "Доступ и права",
    subjectTag: "Доступ",
    automationOnly: false,
  },
  {
    id: "INTEGRATION",
    label: "Запрос автоматизации",
    subjectTag: "Автоматизация",
    automationOnly: true,
  },
  {
    id: "OTHER",
    label: "Другое",
    subjectTag: "Другое",
    automationOnly: false,
  },
];

const PRIORITY_OPTIONS = [
  { id: "NORMAL", label: "Обычный", subjectTag: "Нормальный" },
  { id: "HIGH", label: "Высокий", subjectTag: "Высокий" },
  { id: "URGENT", label: "Срочный", subjectTag: "Срочный" },
];

function normalizePlanId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized && PLAN_LABELS[normalized]) return normalized;
  return "start-30";
}

function resolvePlanFeatures(planId) {
  if (planId === "basic-30") {
    return {
      prioritySupport: false,
      customAutomation: false,
    };
  }
  return {
    prioritySupport: true,
    customAutomation: true,
  };
}

function resolveSupportFeatures(user, planId) {
  const apiFeatures = user?.subscription?.features;
  if (apiFeatures && typeof apiFeatures === "object") {
    return {
      prioritySupport: Boolean(apiFeatures.prioritySupport),
      customAutomation: Boolean(apiFeatures.customAutomation),
    };
  }
  return resolvePlanFeatures(planId);
}

function resolveTypeMeta(typeId) {
  return REQUEST_TYPES.find((item) => item.id === typeId) || REQUEST_TYPES[0];
}

function resolvePriorityMeta(priorityId) {
  return PRIORITY_OPTIONS.find((item) => item.id === priorityId) || PRIORITY_OPTIONS[0];
}

function buildMailSubject({ companyName, planLabel, typeTag, priorityTag }) {
  return `[Поддержка][${planLabel}][${typeTag}][${priorityTag}] ${companyName}`;
}

function buildMailBody({ companyName, userName, userEmail, planLabel, typeLabel, priorityLabel }) {
  return [
    `Компания: ${companyName}`,
    `Контакт: ${userName}`,
    `Email: ${userEmail}`,
    `Тариф: ${planLabel}`,
    `Тип обращения: ${typeLabel}`,
    `Приоритет: ${priorityLabel}`,
    "",
    "Описание:",
    "1) Что не работает / что требуется",
    "2) Где это происходит (раздел, экран, кнопка)",
    "3) Что ожидали получить и что получили фактически",
    "",
    "Для запроса автоматизации дополнительно:",
    "- Цель автоматизации",
    "- Желаемый результат и сроки",
    "",
    "Приложите скриншоты или видео, если возможно.",
  ].join("\n");
}

export default function Support() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [copyResult, setCopyResult] = useState("");
  const [requestType, setRequestType] = useState("TECHNICAL");
  const [requestPriority, setRequestPriority] = useState("NORMAL");

  const canUseSupport = Boolean(user?.role === "ADMIN");

  if (!canUseSupport) {
    return <Navigate to="/403" replace />;
  }

  const currentPlanId = user?.isSystemOwner
    ? "platform-owner"
    : normalizePlanId(user?.subscription?.plan);
  const planLabel = PLAN_LABELS[currentPlanId] || "Старт";
  const planFeatures = resolveSupportFeatures(user, currentPlanId);

  const availableTypes = useMemo(
    () =>
      REQUEST_TYPES.filter((item) => {
        if (item.automationOnly && !planFeatures.customAutomation) return false;
        return true;
      }),
    [planFeatures.customAutomation]
  );

  const availablePriorities = useMemo(
    () =>
      PRIORITY_OPTIONS.filter((item) => {
        if (!planFeatures.prioritySupport && (item.id === "HIGH" || item.id === "URGENT")) {
          return false;
        }
        return true;
      }),
    [planFeatures.prioritySupport]
  );

  useEffect(() => {
    if (!availableTypes.some((item) => item.id === requestType)) {
      setRequestType(availableTypes[0]?.id || "TECHNICAL");
    }
  }, [availableTypes, requestType]);

  useEffect(() => {
    if (!availablePriorities.some((item) => item.id === requestPriority)) {
      setRequestPriority("NORMAL");
    }
  }, [availablePriorities, requestPriority]);

  const companyName = String(user?.organization?.name || "Компания").trim();
  const userName = String(user?.name || "Не указано").trim();
  const userEmail = String(user?.email || user?.login || "Не указан").trim();
  const typeMeta = resolveTypeMeta(requestType);
  const priorityMeta = resolvePriorityMeta(requestPriority);

  const subject = useMemo(
    () =>
      buildMailSubject({
        companyName,
        planLabel,
        typeTag: typeMeta.subjectTag,
        priorityTag: priorityMeta.subjectTag,
      }),
    [companyName, planLabel, priorityMeta.subjectTag, typeMeta.subjectTag]
  );

  const body = useMemo(
    () =>
      buildMailBody({
        companyName,
        userName,
        userEmail,
        planLabel,
        typeLabel: typeMeta.label,
        priorityLabel: priorityMeta.label,
      }),
    [companyName, planLabel, priorityMeta.label, typeMeta.label, userEmail, userName]
  );

  const mailtoHref = useMemo(
    () =>
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(body)}`,
    [body, subject]
  );

  const copyTemplate = async () => {
    const text = `Кому: ${SUPPORT_EMAIL}\nТема: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyResult("Шаблон письма скопирован.");
    } catch {
      setCopyResult("Не удалось скопировать шаблон. Скопируйте текст вручную.");
    }
  };

  return (
    <div className="page support-mail">
      <div className="page-header support-mail__header">
        <div>
          <h1 className="page-title">Поддержка</h1>
          <p className="page-subtitle">
            Обращения отправляются по e-mail с автоматическими тегами тарифа, типа и приоритета.
          </p>
        </div>
        <button
          type="button"
          className="btn support-mail__back-btn"
          onClick={() => navigate(-1)}
        >
          Назад
        </button>
      </div>

      <section className="card support-mail__card">
        <div className="support-mail__section-title">Параметры обращения</div>
        <div className="support-mail__meta-grid">
          <label className="support-mail__field">
            <span>Тариф</span>
            <input type="text" value={planLabel} readOnly />
          </label>

          <label className="support-mail__field">
            <span>Тип обращения</span>
            <select value={requestType} onChange={(event) => setRequestType(event.target.value)}>
              {availableTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="support-mail__field">
            <span>Приоритет</span>
            <select
              value={requestPriority}
              onChange={(event) => setRequestPriority(event.target.value)}
            >
              {availablePriorities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!planFeatures.customAutomation ? (
          <p className="support-mail__hint">
            На тарифе «Базовый» запрос индивидуальной автоматизации недоступен.
          </p>
        ) : null}

        {!planFeatures.prioritySupport ? (
          <p className="support-mail__hint">
            Для тарифа «Базовый» доступен только обычный приоритет обращения.
          </p>
        ) : null}
      </section>

      <section className="card support-mail__card">
        <div className="support-mail__section-title">Куда писать</div>
        <p className="support-mail__text">
          Адрес поддержки:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="support-mail__email">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="support-mail__hint">
          Откройте почтовое приложение по кнопке ниже: тема и шаблон заполняются автоматически.
        </p>
        <div className="support-mail__actions">
          <a href={mailtoHref} className="btn primary support-mail__primary-link">
            Открыть почтовое приложение
          </a>
        </div>
      </section>

      <section className="card support-mail__card">
        <div className="support-mail__section-title">Готовый шаблон</div>
        <ul className="support-mail__list">
          <li>Проверьте корректность темы и типа обращения.</li>
          <li>Добавьте детали шагов и ожидаемого результата.</li>
          <li>Приложите скриншоты или видео.</li>
        </ul>
        <div className="support-mail__template-wrap">
          <div className="support-mail__template-title-row">
            <div className="support-mail__template-title">Шаблон письма</div>
            <button
              type="button"
              className="support-mail__copy-icon-btn"
              onClick={copyTemplate}
              aria-label="Скопировать шаблон письма"
              title="Скопировать шаблон письма"
            >
              ⧉
            </button>
          </div>
          <pre className="support-mail__template">{`Кому: ${SUPPORT_EMAIL}
Тема: ${subject}

${body}`}</pre>
        </div>
        {copyResult ? <div className="alert support-mail__alert">{copyResult}</div> : null}
      </section>
    </div>
  );
}
