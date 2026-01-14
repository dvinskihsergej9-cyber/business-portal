export default function MobileField({ label, value }) {
  return (
    <div className="mobile-field">
      <div className="mobile-field__label">{label}</div>
      <div className="mobile-field__value">{value ?? "-"}</div>
    </div>
  );
}
