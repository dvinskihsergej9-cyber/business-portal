import axios from "axios";
import { API_BASE } from "../apiConfig";

const api = axios.create({
  baseURL: API_BASE,
});

// Автоматически вставляет токен в каждый запрос
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
