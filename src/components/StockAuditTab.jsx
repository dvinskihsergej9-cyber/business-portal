import { useEffect, useState } from "react";
import useIsMobile from "../hooks/useIsMobile";
import { apiFetch } from "../apiConfig";

function openInventoryAuditActWindow(items, includeZero) {
  if (!Array.isArray(items) || items.length === 0) return;

  const itemsForPrint = items.filter((it) => {
    const stock = it.currentStock ?? 0;
    return includeZero ? true : stock > 0;
  });

  if (itemsForPrint.length === 0) {
    alert("Нет остатков для печати акта.");
    return;
  }

  const dateStr = new Date().toLocaleDateString("ru-RU");

  const rowsHtml = itemsForPrint
    .map((it, index) => {
      const stock = it.currentStock ?? "";
      const sku = it.sku || "";
      const unit = it.unit || "";

      return `
        <tr>
          <td style="text-align:center;">${index + 1}</td>
          <td>${it.name || ""}</td>
          <td style="text-align:center;">${sku}</td>
          <td style="text-align:center;">${unit}</td>
          <td style="text-align:right;">${stock}</td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      `;
    })
    .join("");

  const html = `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Акт инвентаризации от ${dateStr}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 20px;
      font-family: "Times New Roman", serif;
      font-size: 12px;
      color: #000;
    }
    .a4 {
      width: 190mm;
      margin: 0 auto;
    }
    h1 {
      font-size: 16px;
      text-align: center;
      margin: 0 0 10px;
    }
    .meta {
      margin-bottom: 10px;
      font-size: 11px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 11px;
    }
    th, td {
      border: 1px solid #000;
      padding: 3px 4px;
    }
    th {
      text-align: center;
    }
    .sign-row {
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      gap: 20px;
    }
    .sign {
      flex: 1;
      font-size: 11px;
    }
    .sign-line {
      border-bottom: 1px solid #000;
      margin: 18px 0 4px;
    }
    .print-btn {
      margin-top: 16px;
      padding: 6px 16px;
      font-size: 13px;
    }
    @media print {
      .print-btn { display: none; }
      body { margin: 0; }
      .a4 { width: auto; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="a4">
    <h1>Акт инвентаризации (по текущим остаткам)</h1>
    <div class="meta">
      Дата инвентаризации: ${dateStr}<br/>
      Склад: ______________________________
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:25px;">№</th>
          <th>Наименование товара</th>
          <th style="width:60px;">Артикул</th>
          <th style="width:40px;">Ед.</th>
          <th style="width:70px;">Остаток</th>
          <th style="width:80px;">Фактический остаток</th>
          <th style="width:70px;">Разница</th>
          <th style="width:110px;">Примечание</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="sign-row">
      <div class="sign">
        <div>Материально ответственное лицо</div>
        <div class="sign-line"></div>
        <div>(ФИО, подпись, дата)</div>
      </div>
      <div class="sign">
        <div>Член комиссии</div>
        <div class="sign-line"></div>
        <div>(ФИО, подпись, дата)</div>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">Печать</button>
  </div>
</body>
</html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert(
      "Пожалуйста, разрешите всплывающие окна, чтобы распечатать акт инвентаризации."
    );
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export default function StockAuditTab() {
  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };
  const isMobile = useIsMobile();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [includeZeroInPrint, setIncludeZeroInPrint] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");

        const res = await apiFetch("/inventory/stock", {
          headers: authHeaders,
        });

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error("Не удалось прочитать ответ от сервера.");
        }

        if (!res.ok) {
          throw new Error(data?.message || "Ошибка загрузки остатков");
        }

        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handlePrint = () => {
    if (!items.length) {
      alert("Нет остатков для печати акта.");
      return;
    }
    openInventoryAuditActWindow(items, includeZeroInPrint);
  };

  const trimmedSearch = search.trim().toLowerCase();
  const visibleItems = trimmedSearch
    ? items.filter((it) => {
        const sku = String(it.sku || "").toLowerCase();
        const name = String(it.name || "").toLowerCase();
        return sku.includes(trimmedSearch) || name.includes(trimmedSearch);
      })
    : items;

  return (
    <div className="card card--1c">
      <div className="card1c__header inventory-header">
        <div className="inventory-header__left">
          <span>Текущие остатки</span>
          <label className="inventory-header__checkbox">
            <input
              type="checkbox"
              checked={includeZeroInPrint}
              onChange={(e) => setIncludeZeroInPrint(e.target.checked)}
            />
            Показывать нулевые остатки при печати
          </label>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm inventory-header__btn"
          onClick={handlePrint}
        >
          Печать акта инвентаризации
        </button>
      </div>

      <div className="card1c__body">
        <div className="inventory-search">
          <span>Поиск по артикулу или названию:</span>
          <input
            type="text"
            className="form__input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Введите артикул или название товара"
          />
        </div>

        {error && (
          <div className="alert alert--danger" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}

        {loading ? (
          <p>Загрузка остатков...</p>
        ) : !visibleItems.length ? (
          <p className="text-muted">
            {items.length === 0
              ? "Остатков пока нет в системе."
              : "Поиск не дал результатов."}
          </p>
        ) : isMobile ? (
          <div className="mobile-inventory-cards">
            {visibleItems.map((it, index) => (
              <div key={it.id} className="card mobile-inventory-card">
                <div className="card__body">
                  <div className="mobile-inventory-title">
                    {index + 1}. {it.name || "-"}
                  </div>
                  <div className="mobile-inventory-meta">
                    <div>
                      <div className="mobile-inventory-label">Артикул</div>
                      <div className="mobile-inventory-text">{it.sku || "-"}</div>
                    </div>
                    <div>
                      <div className="mobile-inventory-label">Ед.</div>
                      <div>{it.unit || "-"}</div>
                    </div>
                  </div>
                  <div className="mobile-inventory-meta">
                    <div>
                      <div className="mobile-inventory-label">Остаток</div>
                      <div
                        className={
                          it.currentStock <= 0 ? "mobile-inventory-stock--low" : ""
                        }
                      >
                        {it.currentStock ?? "-"}
                      </div>
                    </div>
                    <div>
                      <div className="mobile-inventory-label">Мин.</div>
                      <div>{it.minStock ?? "-"}</div>
                    </div>
                    <div>
                      <div className="mobile-inventory-label">Макс.</div>
                      <div>{it.maxStock ?? "-"}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrapper">
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 30,
                    }}
                  >
                    №
                  </th>
                  <th style={{ border: "1px solid #d4d4d4", padding: "4px 6px" }}>
                    Наименование
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 80,
                    }}
                  >
                    Артикул
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 50,
                    }}
                  >
                    Ед.
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 70,
                    }}
                  >
                    Остаток
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 70,
                    }}
                  >
                    Мин.
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 70,
                    }}
                  >
                    Макс.
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((it, index) => (
                  <tr key={it.id}>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "center",
                      }}
                    >
                      {index + 1}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={it.name}
                    >
                      {it.name}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "center",
                      }}
                    >
                      {it.sku}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "center",
                      }}
                    >
                      {it.unit}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "right",
                        color: it.currentStock <= 0 ? "#b91c1c" : undefined,
                        fontWeight: it.currentStock <= 0 ? 600 : 400,
                      }}
                    >
                      {it.currentStock}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "right",
                      }}
                    >
                      {it.minStock ?? "-"}
                    </td>
                    <td
                      style={{
                        border: "1px solid #e0e0e0",
                        padding: "3px 4px",
                        textAlign: "right",
                      }}
                    >
                      {it.maxStock ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
