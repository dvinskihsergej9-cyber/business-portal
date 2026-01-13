export default function Support() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Техническая поддержка</h1>
        <p className="page-subtitle">
          Централизованное место для обращений в IT и сервисную поддержку.
        </p>
      </div>

      <div className="card">
        <p style={{ fontSize: 14, color: "#4b5563" }}>
          В дальнейшем здесь можно реализовать:
        </p>
        <ul style={{ fontSize: 14, color: "#4b5563" }}>
          <li>создание и отслеживание заявок в поддержку;</li>
          <li>классификацию инцидентов по типам и приоритетам;</li>
          <li>статистику по обращениям и времени реакции.</li>
        </ul>
      </div>
    </div>
  );
}
