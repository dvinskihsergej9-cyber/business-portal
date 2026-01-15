import { useMemo, useState } from "react";
import useIsMobile from "../hooks/useIsMobile";
import BottomSheet from "./mobile/BottomSheet";
import MobileActions from "./mobile/MobileActions";
import MobileCard from "./mobile/MobileCard";
import MobileField from "./mobile/MobileField";

export default function ResponsiveDataView({
  rows = [],
  columns = [],
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

  const safeColumns = useMemo(
    () => columns.filter((col) => col && col.key),
    [columns]
  );

  const displayColumns = useMemo(
    () => safeColumns.filter((col) => col.label),
    [safeColumns]
  );

  if (!rows.length) {
    return <p className="text-muted">{emptyMessage}</p>;
  }

  const renderDefaultCard = ({ row, open }) => {
    const [titleColumn, ...restColumns] = displayColumns;
    const previewColumns = restColumns.slice(0, 3);

    return (
      <MobileCard onClick={open}>
        {titleColumn && (
          <div className="mobile-card__title">
            {titleColumn.render
              ? titleColumn.render(row)
              : row[titleColumn.key] ?? "-"}
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
        <MobileActions>
          <button type="button" onClick={open}>
            Details
          </button>
        </MobileActions>
      </MobileCard>
    );
  };

  if (isMobile) {
    const cardRenderer = renderCardMobile || renderDefaultCard;
    return (
      <>
        <div className="mobile-card-list">
          {rows.map((row, index) =>
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
          {rows.map((row, index) =>
            renderRowDesktop ? (
              renderRowDesktop(row, index)
            ) : (
              <tr key={row.id || index}>
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
