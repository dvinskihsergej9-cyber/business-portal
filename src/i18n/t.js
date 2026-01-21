import ru from "./ru";

const translations = {
  ru,
};

export default function t(key, params = {}) {
  const dict = translations.ru || {};
  const template = dict[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : ""
  );
}
