export default function MobileActions({ children }) {
  return (
    <div
      className="mobile-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
