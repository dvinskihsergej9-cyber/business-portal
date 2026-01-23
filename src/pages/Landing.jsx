import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Business Portal</h1>
        <p className="page-subtitle">
          Онлайн-доступ к цифровым сервисам компании.
        </p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Доступ по подписке</div>
        <div>
          Стоимость: <strong>1990 ₽ / 30 дней</strong>
        </div>
        <div>
          Доступ предоставляется сразу после активации trial или оплаты.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="btn primary" to="/login">
            Войти
          </Link>
          <Link className="btn" to="/pricing">
            Тарифы
          </Link>
        </div>
      </div>

      <footer style={{ marginTop: 24, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link to="/offer">Оферта</Link>
          <Link to="/privacy">Политика</Link>
          <Link to="/contacts">Контакты</Link>
          <Link to="/refund">Возврат</Link>
        </div>
      </footer>
    </div>
  );
}
