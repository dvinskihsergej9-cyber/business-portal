import { useNavigate } from "react-router-dom";

export default function Refund() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => navigate("/login")}>
          Назад ко входу
        </button>
      </div>

      <div className="page-header">
        <h1 className="page-title">Возврат</h1>
        <p className="page-subtitle">Порядок возврата средств.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          Услуга является цифровой (доступ к функционалу сервиса «СкладОнлайн»).
        </div>
        <div>
          Возврат возможен в течение 7 календарных дней по обращению на email
          sergeydvin0998@mail.ru или по телефону +7-909-084-03-43,
          если доступ не был предоставлен или не использовался.
        </div>
        <div>
          Если доступ был предоставлен и сервис использовался, возврат не производится.
        </div>
      </div>
    </div>
  );
}
