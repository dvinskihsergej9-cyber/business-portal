import { useMemo, useState } from "react";
import useIsMobile from "../hooks/useIsMobile";
import BottomSheet from "./mobile/BottomSheet";
import MobileActions from "./mobile/MobileActions";
import MobileCard from "./mobile/MobileCard";
import MobileField from "./mobile/MobileField";

export default function ResponsiveDataView({
  rows,
  data,
  columns = [],
  rowKey,
  primaryFields,
  secondaryFields,
  actions,
  renderRowDesktop,
  renderCardMobile,
  getSheetTitle,
  renderSheetContent,
  emptyMessage = "No data.",
  tableClassName = "table",
  wrapperClassName = "table-wrapper",
}) {
  const isMobile = useIsMobile();
  const [activeRow, setActiveRow] = useState(null);
  const dataRows = data || rows || [];

  const safeColumns = useMemo(
    () => columns.filter((col) => col && col.key),
    [columns]
  );

  const displayColumns = useMemo(
    () => safeColumns.filter((col) => col.label),
    [safeColumns]
  );

  const columnMap = useMemo(() => {
    const map = new Map();
    safeColumns.forEach((col) => {
      map.set(col.key, col);
    });
    return map;
  }, [safeColumns]);

  const getRowKey = (row, index) => {
    if (typeof rowKey === "function") return rowKey(row, index);
    if (typeof rowKey === "string" && row && row[rowKey] != null)
      return row[rowKey];
    return row?.id ?? index;
  };

  const resolveFields = (fields) => {
    if (!fields || !fields.length) return [];
    return fields
      .map((field) => {
        if (typeof field === "string") return columnMap.get(field);
        if (field && field.key) return field;
        return null;
      })
      .filter(Boolean);
  };

  if (!dataRows.length) {
    return <p className="text-muted">{emptyMessage}</p>;
  }

  const renderDefaultCard = ({ row, open }) => {
    const resolvedPrimary = resolveFields(primaryFields);
    const resolvedSecondary = resolveFields(secondaryFields);
    const [titleColumn, ...restColumns] = displayColumns;
    const previewColumns =
      resolvedSecondary.length > 0
        ? resolvedSecondary
        : restColumns.slice(0, 3);
    const headlineColumn =
      resolvedPrimary.length > 0 ? resolvedPrimary[0] : titleColumn;
    const subtitleColumns =
      resolvedPrimary.length > 1 ? resolvedPrimary.slice(1, 3) : [];

    return (
      <MobileCard onClick={open}>
        {headlineColumn && (
          <div className="mobile-card__title">
            {headlineColumn.render
              ? headlineColumn.render(row)
              : row[headlineColumn.key] ?? "-"}
          </div>
        )}
        {subtitleColumns.length > 0 && (
          <div className="mobile-card__header">
            {subtitleColumns.map((col) => (
              <span key={col.key}>
                {col.render ? col.render(row) : row[col.key] ?? "-"}
              </span>
            ))}
          </div>
        )}
        <div className="mobile-card__fields">
          {previewColumns.map((col) => (
            <MobileField
              key={col.key}
              label={col.label}
              value={col.render ? col.render(row) : row[col.key]}
            />
          ))}
        </div>
        {(actions || open) && (
          <MobileActions>
            {typeof actions === "function" ? actions(row) : actions}
            {open && (
              <button type="button" onClick={open}>
                Details
              </button>
            )}
          </MobileActions>
        )}
      </MobileCard>
    );
  };

  if (isMobile) {
    const cardRenderer = renderCardMobile || renderDefaultCard;
    return (
      <>
        <div className="mobile-card-list">
          {dataRows.map((row, index) =>
            cardRenderer({
              row,
              index,
              open: () => setActiveRow(row),
            })
          )}
        </div>
        <BottomSheet
          open={Boolean(activeRow)}
          title={getSheetTitle ? getSheetTitle(activeRow) : "Details"}
          onClose={() => setActiveRow(null)}
        >
          {activeRow &&
            (renderSheetContent ? (
              renderSheetContent(activeRow)
            ) : (
              <div className="mobile-sheet__fields">
                {safeColumns.map((col) => (
                  <div key={col.key} className="mobile-field">
                    <div className="mobile-field__label">{col.label}</div>
                    <div className="mobile-field__value">
                      {col.render
                        ? col.render(activeRow)
                        : activeRow[col.key] ?? "-"}
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </BottomSheet>
      </>
    );
  }

  return (
    <div className={wrapperClassName}>
      <table className={tableClassName}>
        <thead>
          <tr>
            {safeColumns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, index) =>
            renderRowDesktop ? (
              renderRowDesktop(row, index)
            ) : (
              <tr key={getRowKey(row, index)}>
                {safeColumns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
