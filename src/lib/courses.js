const { text, optional, positiveInt } = require('./forms');

// Reads the course form. Instructors may only change the teaching details; admins may change everything.
function readCourseForm(db, body, { admin }) {
  const values = {
    title: text(body.title),
    description: optional(body.description),
    schedule: optional(body.schedule),
    location: optional(body.location),
  };
  const errors = [];
  if (!values.title) errors.push('Course title is required.');

  if (admin) {
    const capacityText = text(body.capacity);
    values.capacity = capacityText ? positiveInt(capacityText) : null;
    if (capacityText && !values.capacity) errors.push('Capacity must be a whole number greater than zero.');

    values.instructor_id = positiveInt(body.instructor_id);
    if (
      values.instructor_id &&
      !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'instructor' AND active = 1").get(values.instructor_id)
    ) {
      errors.push('Choose an active instructor.');
    }

    values.program_id = positiveInt(body.program_id);
    if (!values.program_id || !db.prepare('SELECT 1 FROM programs WHERE id = ?').get(values.program_id)) {
      errors.push('Choose a program.');
    }
  }
  return { values, errors };
}

function activeInstructors(db) {
  return db
    .prepare("SELECT id, first_name, last_name FROM users WHERE role = 'instructor' AND active = 1 ORDER BY first_name, last_name")
    .all();
}

module.exports = { readCourseForm, activeInstructors };
