import axios from "axios";
import { API_BASE, normalizeErrorMessage } from "../apiConfig";

const api = axios.create({
  baseURL: API_BASE,
});

// Автоматически подставляет токен в каждый запрос.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = normalizeErrorMessage(error, "Не удалось выполнить запрос.");
    return Promise.reject(new Error(message));
  }
);

export default api;
