export default function Offer() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Публичная оферта</h1>
        <p className="page-subtitle">
          Предоставление доступа к цифровому сервису.
        </p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          Предмет договора: предоставление доступа к цифровой услуге Business
          Portal.
        </div>
        <div>Стоимость: 1990 ₽ за 30 дней доступа.</div>
        <div>
          Доступ предоставляется автоматически после активации trial или
          подтверждения оплаты.
        </div>
        <div>
          Возврат: цифровая услуга считается оказанной в момент предоставления
          доступа. Возврат возможен в случаях, предусмотренных законом, по
          заявлению пользователя.
        </div>
        <div>
          Контакты для обращений указаны на странице{" "}
          <a href="/contacts">Контакты</a>.
        </div>
      </div>
    </div>
  );
}
