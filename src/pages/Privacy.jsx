import { useNavigate } from "react-router-dom";

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => navigate("/login")}>
          Назад ко входу
        </button>
      </div>

      <div className="page-header">
        <h1 className="page-title">Политика конфиденциальности</h1>
        <p className="page-subtitle">Обработка персональных данных.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          Оператор: ИП Двинских Сергей Сергеевич, ИНН 743402272974, ОГРНИП 326745600045736.
        </div>
        <div>
          Мы обрабатываем персональные данные пользователей для предоставления доступа к
          сервису «СкладОнлайн», исполнения обязательств и связи с пользователями.
        </div>
        <div>
          Данные не передаются третьим лицам, за исключением случаев, предусмотренных законом,
          и платежных процедур.
        </div>
        <div>
          По вопросам обработки данных свяжитесь с нами через страницу контактов.
        </div>
      </div>
    </div>
  );
}
