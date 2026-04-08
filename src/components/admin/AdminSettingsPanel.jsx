import { useState } from "react";
import { apiFetch } from "../../apiConfig";

export default function AdminSettingsPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const handleCreateEmployee = async () => {
    try {
      setLoading(true);
      setError("");
      setResult("");
      const res = await apiFetch("/admin/create-employee", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          email: "employee@test.local",
          password: "Test12345!",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "CREATE_EMPLOYEE_ERROR");
        return;
      }
      setResult(`Created: ${data.email}`);
    } catch (err) {
      console.error("create employee error:", err);
      setError("CREATE_EMPLOYEE_ERROR");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-console__card admin-panel">
      <div className="admin-console__card-title">Portal settings</div>
      <div className="admin-console__card-text">
        System settings placeholder.
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Test EMPLOYEE</div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          Creates or updates: employee@test.local / Test12345!
        </div>
        <button
          className="btn"
          type="button"
          onClick={handleCreateEmployee}
          disabled={loading}
        >
          {loading ? "Creating..." : "Create test EMPLOYEE"}
        </button>
        {result && <div style={{ color: "#059669" }}>{result}</div>}
        {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
      </div>
    </div>
  );
}
