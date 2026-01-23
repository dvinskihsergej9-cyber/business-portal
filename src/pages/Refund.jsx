export default function Refund() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Возврат</h1>
        <p className="page-subtitle">Порядок возврата средств.</p>
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          Возврат средств возможен в случаях, предусмотренных законом, по
          заявлению пользователя.
        </div>
        <div>
          Для запроса возврата напишите на почту, указанную в разделе
          «Контакты».
        </div>
      </div>
    </div>
  );
}
