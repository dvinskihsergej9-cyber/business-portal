import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="page" style={{ position: "relative", zIndex: 1 }}>
      <div className="page-header">
        <h1 className="page-title">Главная</h1>
        <p className="page-subtitle">
          Добро пожаловать{user?.name ? `, ${user.name}` : ""}.
        </p>
      </div>
    </div>
  );
}
