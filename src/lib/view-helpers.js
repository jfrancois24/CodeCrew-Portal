const ROLE_LABELS = { student: 'Student', parent: 'Parent / Guardian', instructor: 'Instructor', admin: 'Admin' };
const STATUS_LABELS = { draft: 'Draft', open: 'Open for sign-ups', closed: 'Closed' };

function fullName(user) {
  return user ? `${user.first_name} ${user.last_name}` : '';
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

// Dates are stored as "YYYY-MM-DD" or SQLite "YYYY-MM-DD HH:MM:SS" (UTC).
function formatDate(value) {
  if (!value) return '';
  const iso = value.length <= 10 ? `${value}T00:00:00` : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function seatsLeft(course) {
  if (course.capacity === null || course.capacity === undefined) return null;
  return Math.max(course.capacity - course.enrolled_count, 0);
}

module.exports = { fullName, roleLabel, statusLabel, formatDate, formatDateTime, seatsLeft, ROLE_LABELS };
