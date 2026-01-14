import { useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";

/**
 * Печатная форма инвентаризации (акт ревизионной проверки)
 * includeZero = true  → печатать все позиции
 * includeZero = false → печатать только позиции с остатком > 0
 */
function openInventoryAuditActWindow(items, includeZero) {
  if (!Array.isArray(items) || items.length === 0) return;

  // 1. Фильтруем список в зависимости от галочки
  const itemsForPrint = items.filter((it) => {
    const stock = it.currentStock ?? 0;
    return includeZero ? true : stock > 0;
  });

  // Если после фильтрации ничего не осталось — предупредим
  if (itemsForPrint.length === 0) {
    alert("Нет позиций для печати акта.");
    return;
  }

  const dateStr = new Date().toLocaleDateString("ru-RU");

  // 2. Строки таблицы строим по itemsForPrint
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
  <title>Инвентаризационная ведомость от ${dateStr}</title>
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
    <h1>Инвентаризационная ведомость (ревизионная проверка)</h1>
    <div class="meta">
      Дата проведения инвентаризации: ${dateStr}<br/>
      Склад: ______________________________
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:25px;">№</th>
          <th>Наименование товара</th>
          <th style="width:60px;">SKU</th>
          <th style="width:40px;">Ед.</th>
          <th style="width:70px;">Остаток по учёту</th>
          <th style="width:80px;">Фактический остаток</th>
          <th style="width:70px;">Разница</th>
          <th style="width:110px;">Подпись</th>
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
        <div>(должность, подпись, Ф.И.О.)</div>
      </div>
      <div class="sign">
        <div>Члены комиссии</div>
        <div class="sign-line"></div>
        <div>(подписи, Ф.И.О.)</div>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">Печать</button>
  </div>
</body>
</html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Разрешите всплывающие окна в браузере, чтобы распечатать ведомость.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * Таб “Текущие остатки”
 */
export default function StockAuditTab() {
  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [includeZeroInPrint, setIncludeZeroInPrint] = useState(false); // ← галочка

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
          throw new Error(
            "Ответ сервера не похож на JSON при загрузке остатков"
          );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePrint = () => {
    if (!items.length) {
      alert("Нет данных по остаткам для печати.");
      return;
    }
    // Передаём флаг includeZeroInPrint
    openInventoryAuditActWindow(items, includeZeroInPrint);
  };

  // Фильтрация по коду (SKU) и названию для таблицы на экране
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
      <div
        className="card1c__header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Левая часть: заголовок + галочка */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span>Текущие остатки</span>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontSize: 13,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={includeZeroInPrint}
              onChange={(e) => setIncludeZeroInPrint(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            Нулевые остатки включить в акт
          </label>
        </div>

        {/* Правая часть: кнопка печати */}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={handlePrint}
        >
          Печать инвентаризационной ведомости
        </button>
      </div>

      <div className="card1c__body">
        {/* Поиск по коду / названию */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 8,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 13 }}>Поиск по коду / названию:</span>
          <input
            type="text"
            className="form__input"
            style={{ maxWidth: 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Введите SKU или часть названия..."
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
              ? "Нет товаров в номенклатуре."
              : "По вашему запросу ничего не найдено."}
          </p>
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
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                    }}
                  >
                    Наименование
                  </th>
                  <th
                    style={{
                      border: "1px solid #d4d4d4",
                      padding: "4px 6px",
                      width: 80,
                    }}
                  >
                    SKU
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
