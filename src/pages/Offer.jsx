import { Link, useNavigate } from "react-router-dom";

export default function Offer() {
  const navigate = useNavigate();

  return (
    <div className="page legal-page">
      <div className="legal-topbar">
        <button type="button" className="legal-back-btn" onClick={() => navigate("/login")}>
          ← Ко входу
        </button>
        <div className="legal-brand">
          <img src="/logo-mark.png" alt="Логотип СкладОнлайн" />
          <span>СкладОнлайн</span>
        </div>
      </div>

      <div className="legal-hero">
        <span className="legal-badge">Документы</span>
        <h1 className="page-title">Публичная оферта</h1>
        <p className="page-subtitle">Предоставление доступа к цифровому сервису «СкладОнлайн».</p>
      </div>

      <div className="legal-grid">
        <div className="legal-card" style={{ display: "grid", gap: 10 }}>
          <p>Исполнитель: ИП Двинских Сергей Сергеевич, ИНН 743402272974, ОГРНИП 326745600045736.</p>
          <p>Адрес регистрации: г. Куса, ул. Розы Люксембург, д. 34, кв. 1.</p>
          <p>
            Предмет договора: предоставление доступа к цифровой услуге «СкладОнлайн» —
            веб-сервису для учёта склада и операций с товаром.
          </p>
          <p>Стоимость: Старт 1 ₽, Базовый 1000 ₽, Проф 2600 ₽ за 30 дней доступа.</p>
          <p>Доступ предоставляется автоматически после подтверждения оплаты.</p>
          <p>
            Возврат возможен в течение 7 календарных дней по обращению на email/телефон,
            если доступ не был предоставлен или не использовался.
          </p>
          <p>
            Контакты для обращений: <Link to="/contacts" className="legal-link">страница «Контакты»</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
