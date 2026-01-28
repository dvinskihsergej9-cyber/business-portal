export default function Refund() {
  return (
    <div className="page">
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
          sergeydvin0998@mail.ru, если доступ не был предоставлен/не использовался.
        </div>
        <div>
          Если доступ был предоставлен и сервис использовался — возврат не производится.
        </div>
      </div>
    </div>
  );
}
