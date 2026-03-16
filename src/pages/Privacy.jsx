import { useNavigate } from "react-router-dom";

export default function Privacy() {
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
        <h1 className="page-title">Политика конфиденциальности</h1>
        <p className="page-subtitle">Обработка персональных данных пользователей.</p>
      </div>

      <div className="legal-grid">
        <div className="legal-card" style={{ display: "grid", gap: 10 }}>
          <p>Оператор: ИП Двинских Сергей Сергеевич, ИНН 743402272974, ОГРНИП 326745600045736.</p>
          <p>
            Мы обрабатываем персональные данные только для предоставления доступа к сервису,
            исполнения обязательств и связи с пользователями.
          </p>
          <p>
            Данные не передаются третьим лицам, кроме случаев, предусмотренных законом,
            и операций оплаты через платёжного провайдера.
          </p>
          <p>По вопросам обработки данных используйте контакты, указанные в разделе «Контакты».</p>
        </div>
      </div>
    </div>
  );
}
