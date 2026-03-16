import { useNavigate } from "react-router-dom";

export default function Contacts() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => navigate("/login")}>
          Назад ко входу
        </button>
      </div>

      <div className="page-header">
        <h1 className="page-title">Контакты</h1>
        <p className="page-subtitle">Реквизиты и связь.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div>ИП Двинских Сергей Сергеевич</div>
        <div>ИНН: 743402272974</div>
        <div>ОГРНИП: 326745600045736</div>
        <div>Email: sergeydvin0998@mail.ru</div>
        <div>Телефон: +7-909-084-03-43</div>
        <div>Адрес: г. Куса, ул. Розы Люксембург, д. 34, кв. 1</div>
        <div>Сайт: https://business-portal-weld.vercel.app</div>
      </div>
    </div>
  );
}
