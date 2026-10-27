// Small helpers for reading form fields.

function text(value) {
  if (value === undefined || value === null) return '';
  return String(Array.isArray(value) ? value[0] : value).trim();
}

function optional(value) {
  const t = text(value);
  return t === '' ? null : t;
}

function positiveInt(value) {
  const t = text(value);
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

function idList(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(values.map(positiveInt).filter(Boolean))];
}

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = { text, optional, positiveInt, idList, USERNAME_PATTERN, EMAIL_PATTERN };
