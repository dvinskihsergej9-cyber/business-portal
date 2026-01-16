import axios from "axios";
import { API_BASE, API_CONFIG_ERROR } from "../apiConfig";

const api = axios.create({
  baseURL: API_BASE,
});

// Add auth token to all requests when available.
api.interceptors.request.use((config) => {
  if (API_CONFIG_ERROR) {
    return Promise.reject(new Error(API_CONFIG_ERROR));
  }
  const url = config?.url || "";
  const isAuthRequest =
    /^\/?login$/i.test(url) ||
    /^\/?register$/i.test(url) ||
    /\/api\/login$/i.test(url) ||
    /\/api\/register$/i.test(url);
  const token = localStorage.getItem("token");
  if (token && !isAuthRequest) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
