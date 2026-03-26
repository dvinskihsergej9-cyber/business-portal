import { Link, useNavigate } from "react-router-dom";

export default function Landing() {
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
        <span className="legal-badge">О сервисе</span>
        <h1 className="page-title">СкладОнлайн</h1>
        <p className="page-subtitle">
          Веб-сервис для учёта склада и работы с товарами через браузер и мобильный режим ТСД.
        </p>
      </div>

      <div className="legal-grid">
        <div className="legal-card" style={{ display: "grid", gap: 10 }}>
          <p>
            Доступ предоставляется по подписке. Тарифы: Старт 1 ₽, Базовый 1000 ₽,
            Проф 2600 ₽ за 30 дней.
          </p>
          <p>
            После оплаты доступ открывается автоматически для сотрудников вашей организации
            с учётом назначенных прав.
          </p>
          <div className="legal-links">
            <Link to="/offer" className="legal-link">Оферта</Link>
            <Link to="/privacy" className="legal-link">Политика</Link>
            <Link to="/contacts" className="legal-link">Контакты</Link>
            <Link to="/refund" className="legal-link">Возврат</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
