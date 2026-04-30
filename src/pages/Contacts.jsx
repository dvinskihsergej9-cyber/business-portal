import { useNavigate } from "react-router-dom";

export default function Contacts() {
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
        <h1 className="page-title">Контакты и реквизиты</h1>
        <p className="page-subtitle">Официальные реквизиты и каналы связи.</p>
      </div>

      <div className="legal-grid">
        <div className="legal-card" style={{ display: "grid", gap: 8 }}>
          <p>ИП Двинских Сергей Сергеевич</p>
          <p>ИНН: 743402272974</p>
          <p>ОГРНИП: 326745600045736</p>
          <p>Email: noreplyskladonline@mail.ru</p>
          <p>Телефон: +7-909-084-03-43</p>
          <p>Юридический адрес: г. Куса, ул. Розы Люксембург, д. 34, кв. 1</p>
          <p>Фактический адрес: г. Куса, ул. Розы Люксембург, д. 34, кв. 1</p>
          <p>Поддержка: рабочие дни 09:00-18:00 (МСК), email принимается ежедневно.</p>
          <p>Сайт: https://app.skladonline74.ru</p>
        </div>
      </div>
    </div>
  );
}
