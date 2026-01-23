export default function Privacy() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Политика конфиденциальности</h1>
        <p className="page-subtitle">Обработка персональных данных.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          Мы обрабатываем персональные данные пользователей для предоставления
          доступа к сервису и исполнения обязательств.
        </div>
        <div>
          Данные не передаются третьим лицам, за исключением случаев,
          предусмотренных законом и платежными процедурами.
        </div>
        <div>
          По вопросам обработки данных свяжитесь с нами через страницу
          контактов.
        </div>
      </div>
    </div>
  );
}
