export default function DocFlow() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Документооборот</h1>
        <p className="page-subtitle">
          Раздел для работы с договорами, актами и внутренними документами.
          Пока это рабочее место в разработке.
        </p>
      </div>

      <div className="card">
        <p style={{ fontSize: 14, color: "#4b5563" }}>
          Здесь позже появятся:
        </p>
        <ul style={{ fontSize: 14, color: "#4b5563" }}>
          <li>реестр входящих и исходящих документов;</li>
          <li>поиск по контрагентам и номерам договоров;</li>
          <li>связь документов с заявками на оплату и складом.</li>
        </ul>
      </div>
    </div>
  );
}
