// src/apiConfig.js
const rawBase = import.meta.env.VITE_API_BASE;
const fallbackBase = `${window.location.protocol}//${window.location.hostname}:3001`;
const base = rawBase || fallbackBase;

export const API_BASE = base.endsWith("/api") ? base : `${base.replace(/\/$/, "")}/api`;
