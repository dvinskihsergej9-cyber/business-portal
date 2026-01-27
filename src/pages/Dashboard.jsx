export default function Dashboard() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Главная</h1>
        <p className="page-subtitle">Портал для работы отделов. Новости отключены.</p>
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Быстрый старт</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", display: "grid", gap: 6 }}>
          <li>Склад: заявки, задачи, остатки, ячейки и TSD.</li>
          <li>Кадры: регистрация сотрудников и HR-процессы.</li>
          <li>Документы и остальные разделы доступны через меню.</li>
        </ul>
      </div>
    </div>
  );
}

