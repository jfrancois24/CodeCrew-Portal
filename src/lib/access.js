// Who is related to whom: parents and children, instructors and courses, and who may message whom.

function childrenOf(db, parentId) {
  return db
    .prepare(
      `SELECT u.* FROM parent_students ps JOIN users u ON u.id = ps.student_id
       WHERE ps.parent_id = ? ORDER BY u.first_name, u.last_name`
    )
    .all(parentId);
}

function parentsOf(db, studentId) {
  return db
    .prepare(
      `SELECT u.* FROM parent_students ps JOIN users u ON u.id = ps.parent_id
       WHERE ps.student_id = ? ORDER BY u.first_name, u.last_name`
    )
    .all(studentId);
}

function isParentOf(db, parentId, studentId) {
  return !!db.prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?').get(parentId, studentId);
}

function canManageCourse(user, course) {
  if (!user || !course) return false;
  return user.role === 'admin' || (user.role === 'instructor' && course.instructor_id === user.id);
}

// The people a user may start a new conversation with. Students do not use messaging.
function messageContacts(db, user) {
  const staff = db
    .prepare(
      `SELECT id, first_name, last_name, role, 'CodeCrew staff' AS context
       FROM users WHERE role = 'admin' AND active = 1 AND id <> ? ORDER BY first_name, last_name`
    )
    .all(user.id);

  if (user.role === 'admin') {
    const others = db
      .prepare(
        `SELECT id, first_name, last_name, role, NULL AS context FROM users
         WHERE role IN ('parent', 'instructor') AND active = 1
         ORDER BY role, first_name, last_name`
      )
      .all();
    return [...staff, ...others];
  }

  if (user.role === 'instructor') {
    const parents = db
      .prepare(
        `SELECT p.id, p.first_name, p.last_name, p.role,
                'Parent of ' || GROUP_CONCAT(DISTINCT s.first_name || ' ' || s.last_name) AS context
         FROM courses c
         JOIN enrollments e ON e.course_id = c.id AND e.status = 'active'
         JOIN users s ON s.id = e.student_id
         JOIN parent_students ps ON ps.student_id = e.student_id
         JOIN users p ON p.id = ps.parent_id AND p.active = 1
         WHERE c.instructor_id = ?
         GROUP BY p.id ORDER BY p.first_name, p.last_name`
      )
      .all(user.id);
    return [...parents, ...staff];
  }

  if (user.role === 'parent') {
    const instructors = db
      .prepare(
        `SELECT i.id, i.first_name, i.last_name, i.role,
                'Instructor for ' || GROUP_CONCAT(DISTINCT c.title) AS context
         FROM parent_students ps
         JOIN enrollments e ON e.student_id = ps.student_id AND e.status = 'active'
         JOIN courses c ON c.id = e.course_id
         JOIN users i ON i.id = c.instructor_id AND i.active = 1
         WHERE ps.parent_id = ?
         GROUP BY i.id ORDER BY i.first_name, i.last_name`
      )
      .all(user.id);
    return [...instructors, ...staff];
  }

  return [];
}

// Parents of the students actively enrolled in a course (used for "message all parents").
function courseParentIds(db, courseId) {
  return db
    .prepare(
      `SELECT DISTINCT ps.parent_id AS id
       FROM enrollments e
       JOIN parent_students ps ON ps.student_id = e.student_id
       JOIN users p ON p.id = ps.parent_id AND p.active = 1
       WHERE e.course_id = ? AND e.status = 'active'`
    )
    .all(courseId)
    .map((row) => row.id);
}

module.exports = { childrenOf, parentsOf, isParentOf, canManageCourse, messageContacts, courseParentIds };
