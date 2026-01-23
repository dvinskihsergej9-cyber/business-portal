export default function Contacts() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Контакты</h1>
        <p className="page-subtitle">Реквизиты и связь.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div>ООО «Название компании» (заполните).</div>
        <div>ИНН: 0000000000</div>
        <div>Email: support@example.com</div>
        <div>Телефон: +7 (000) 000-00-00</div>
        <div>Адрес: г. ..., ул. ..., д. ...</div>
      </div>
    </div>
  );
}
