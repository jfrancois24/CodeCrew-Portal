const { transaction } = require('../db');

class EnrollmentError extends Error {}

function findCourse(db, courseId) {
  return db
    .prepare(
      `SELECT c.*, p.name AS program_name, p.status AS program_status,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolled_count
       FROM courses c JOIN programs p ON p.id = c.program_id WHERE c.id = ?`
    )
    .get(courseId);
}

// Signs a student up for a course. Admins may pass override to bypass program status,
// capacity, and a previous instructor removal.
function enroll(db, { studentId, courseId, actorId, override = false }) {
  return transaction(db, () => {
    const course = findCourse(db, courseId);
    if (!course) throw new EnrollmentError('That course could not be found.');
    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentId);
    if (!student || !student.active) throw new EnrollmentError('That student account is not active.');
    if (!override && course.program_status !== 'open') {
      throw new EnrollmentError(`${course.program_name} is not open for sign-ups right now.`);
    }

    const existing = db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?').get(studentId, courseId);
    if (existing && existing.status === 'active') {
      throw new EnrollmentError(`${student.first_name} is already signed up for ${course.title}.`);
    }
    if (existing && existing.status === 'removed' && !override) {
      throw new EnrollmentError(
        `${student.first_name} was removed from ${course.title} by the instructor. Please contact CodeCrew staff to re-enroll.`
      );
    }
    if (!override && course.capacity !== null && course.enrolled_count >= course.capacity) {
      throw new EnrollmentError(`${course.title} is full.`);
    }

    if (existing) {
      db.prepare(
        `UPDATE enrollments SET status = 'active', enrolled_by = ?, enrolled_at = datetime('now'),
           ended_by = NULL, ended_at = NULL, end_reason = NULL
         WHERE id = ?`
      ).run(actorId, existing.id);
    } else {
      db.prepare('INSERT INTO enrollments (student_id, course_id, enrolled_by) VALUES (?, ?, ?)').run(
        studentId,
        courseId,
        actorId
      );
    }
    return { course, student };
  });
}

// Ends an active enrollment. status is 'dropped' (student/parent chose to leave) or 'removed' (staff action).
function endEnrollment(db, { studentId, courseId, actorId, status, reason = null }) {
  const result = db
    .prepare(
      `UPDATE enrollments SET status = ?, ended_by = ?, ended_at = datetime('now'), end_reason = ?
       WHERE student_id = ? AND course_id = ? AND status = 'active'`
    )
    .run(status, actorId, reason, studentId, courseId);
  if (result.changes === 0) throw new EnrollmentError('That student is not currently enrolled in this course.');
}

function activeEnrollmentsFor(db, studentId) {
  return db
    .prepare(
      `SELECT c.*, p.name AS program_name, p.start_date, p.end_date, e.enrolled_at,
              i.first_name AS instructor_first, i.last_name AS instructor_last
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN programs p ON p.id = c.program_id
       LEFT JOIN users i ON i.id = c.instructor_id
       WHERE e.student_id = ? AND e.status = 'active'
       ORDER BY p.start_date, c.title`
    )
    .all(studentId);
}

module.exports = { EnrollmentError, enroll, endEnrollment, findCourse, activeEnrollmentsFor };
