import axios from "axios";
import { API_BASE } from "../apiConfig";

const api = axios.create({
  baseURL: API_BASE,
});

// Add auth token to all requests when available.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
