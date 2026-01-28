import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">СкладОнлайн</h1>
        <p className="page-subtitle">
          СкладОнлайн — веб-сервис для учёта склада и работы с товарами через браузер. Поддерживает операции склада и мобильный режим для работы со сканированием/приёмкой/движением. Доступ предоставляется по подписке.
        </p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Доступ по подписке</div>
        <div>
          Стоимость: <strong>1990 ₽ / 30 дней</strong>
        </div>
        <div>
          Доступ предоставляется сразу после активации trial или оплаты. Автопродление будет добавлено позже.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="btn primary" to="/login">
            Войти
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
