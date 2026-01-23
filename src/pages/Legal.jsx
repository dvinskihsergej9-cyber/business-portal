export default function Legal() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Юридический отдел</h1>
        <p className="page-subtitle">
          Раздел для работы юристов: согласование договоров, контроль рисков,
          замечания по контрагентам.
        </p>
      </div>

      <div className="card">
        <p style={{ fontSize: 14, color: "#4b5563" }}>
          В будущем здесь можно будет:
        </p>
        <ul style={{ fontSize: 14, color: "#4b5563" }}>
          <li>видеть список договоров, требующих проверки юриста;</li>
          <li>фиксировать комментарии и статус согласования;</li>
          <li>связывать юридические замечания с заявками и документами.</li>
        </ul>
      </div>
    </div>
  );
}
