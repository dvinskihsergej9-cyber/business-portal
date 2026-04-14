import { useNavigate } from "react-router-dom";

export default function Refund() {
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
        <h1 className="page-title">Возврат</h1>
        <p className="page-subtitle">Порядок возврата средств по цифровой услуге.</p>
      </div>

      <div className="legal-grid">
        <div className="legal-card" style={{ display: "grid", gap: 10 }}>
          <p>Услуга является цифровой: предоставляется доступ к функционалу «СкладОнлайн».</p>
          <p>
            Пользователь вправе отказаться от услуги до момента предоставления доступа -
            в этом случае производится возврат 100% суммы оплаты.
          </p>
          <p>
            Возврат возможен в течение 7 календарных дней по обращению на
            sergeydvin0998@mail.ru или +7-909-084-03-43,
            если доступ не был предоставлен или не использовался.
          </p>
          <p>Если доступ был предоставлен и сервис использовался, возврат не производится.</p>
          <p>
            Для обращения укажите email аккаунта, дату и сумму платежа, а также идентификатор
            платежа из чека или уведомления.
          </p>
          <p>
            Срок рассмотрения обращения - до 10 рабочих дней. При положительном решении
            возврат выполняется тем же способом оплаты.
          </p>
          <p>
            Рекомендуем сохранять чеки и иные документы, подтверждающие оплату.
          </p>
        </div>
      </div>
    </div>
  );
}
