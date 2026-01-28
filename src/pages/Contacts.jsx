export default function Contacts() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Контакты</h1>
        <p className="page-subtitle">Реквизиты и связь.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div>Самозанятый (НПД) Двинских Сергей Сергеевич</div>
        <div>ИНН: 743402272974</div>
        <div>Email: sergeydvin0998@mail.ru</div>
        <div>Телефон: 8-909-084-03-43</div>
        <div>Адрес: г. Челябинск</div>
        <div>Сайт: https://business-portal-0zeo9bgbg-sergeys-projects-9cd5c7b6.vercel.app</div>
      </div>
    </div>
  );
}
