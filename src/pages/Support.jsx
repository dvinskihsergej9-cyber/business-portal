import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const SUPPORT_EMAIL = "noreplyskladonline@mail.ru";

function buildMailSubject(companyName) {
  return `[${companyName}] Обращение в поддержку`;
}

function buildMailBody({ companyName, userName }) {
  return [
    `Компания: ${companyName}`,
    `Контакт: ${userName}`,
    "",
    "Опишите проблему:",
    "Что не работает, где и при каких действиях.",
    "",
    "Приложите скриншоты (или видео), если это возможно.",
    "",
  ].join("\n");
}

export default function Support() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [copyResult, setCopyResult] = useState("");

  const canUseSupport = Boolean(
    user?.role === "ADMIN" && user?.isSystemOwner !== true
  );

  if (!canUseSupport) {
    return <Navigate to="/403" replace />;
  }

  const companyName = String(user?.organization?.name || "Компания").trim();
  const userName = String(user?.name || "Не указано").trim();
  const subject = useMemo(() => buildMailSubject(companyName), [companyName]);
  const body = useMemo(
    () =>
      buildMailBody({
        companyName,
        userName,
      }),
    [companyName, userName]
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
            Обращения отправляются по электронной почте. В ответ получите письмо и
            дальнейшие шаги.
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
        <div className="support-mail__section-title">Куда писать</div>
        <p className="support-mail__text">
          Адрес поддержки:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="support-mail__email">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <p className="support-mail__hint">
          Рекомендуем отправлять письмо по кнопке ниже: тема и шаблон уже будут
          заполнены.
        </p>
        <div className="support-mail__actions">
          <a href={mailtoHref} className="btn primary support-mail__primary-link">
            Открыть почтовое приложение
          </a>
          <button type="button" className="btn" onClick={copyTemplate}>
            Скопировать шаблон письма
          </button>
        </div>
        {copyResult ? <div className="alert support-mail__alert">{copyResult}</div> : null}
      </section>

      <section className="card support-mail__card">
        <div className="support-mail__section-title">Что указать в письме</div>
        <ul className="support-mail__list">
          <li>Кратко опишите, что не работает.</li>
          <li>Укажите, где именно возникла проблема.</li>
          <li>Прикрепите скриншоты или видео.</li>
        </ul>
        <div className="support-mail__template-wrap">
          <div className="support-mail__template-title">Готовый шаблон</div>
          <pre className="support-mail__template">{`Кому: ${SUPPORT_EMAIL}
Тема: ${subject}

${body}`}</pre>
        </div>
      </section>
    </div>
  );
}
