const express = require('express');
const { requireRole } = require('../lib/auth');
const { canManageCourse, parentsOf } = require('../lib/access');
const { findCourse, enroll, endEnrollment, EnrollmentError } = require('../lib/enrollment');
const { readCourseForm, activeInstructors } = require('../lib/courses');
const { text, positiveInt } = require('../lib/forms');

module.exports = (db) => {
  const router = express.Router();
  const staffOnly = requireRole('instructor', 'admin');

  // Loads the course and confirms the user teaches it (or is an admin).
  function loadCourse(req, res, next) {
    const course = findCourse(db, positiveInt(req.params.id));
    if (!course) return res.status(404).render('error', { title: 'Course not found', message: 'That course does not exist.' });
    if (!canManageCourse(req.user, course)) {
      return res.status(403).render('error', { title: 'Not allowed', message: 'You can only manage courses assigned to you.' });
    }
    req.course = course;
    next();
  }

  function renderCourse(req, res, { values = req.course, errors = [], status = 200 } = {}) {
    const course = req.course;
    const roster = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.username, u.grade_level, u.school, e.enrolled_at
         FROM enrollments e JOIN users u ON u.id = e.student_id
         WHERE e.course_id = ? AND e.status = 'active' ORDER BY u.last_name, u.first_name`
      )
      .all(course.id)
      .map((s) => ({ ...s, parents: parentsOf(db, s.id) }));
    const past = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, e.status, e.ended_at, e.end_reason
         FROM enrollments e JOIN users u ON u.id = e.student_id
         WHERE e.course_id = ? AND e.status <> 'active' ORDER BY e.ended_at DESC`
      )
      .all(course.id);

    const admin = req.user.role === 'admin';
    const adminData = admin
      ? {
          instructors: activeInstructors(db),
          programs: db.prepare('SELECT id, name FROM programs ORDER BY name').all(),
          addableStudents: db
            .prepare(
              `SELECT id, first_name, last_name, username FROM users u
               WHERE role = 'student' AND active = 1
               AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = u.id AND e.course_id = ? AND e.status = 'active')
               ORDER BY last_name, first_name`
            )
            .all(course.id),
        }
      : {};
    res.status(status).render('courses/show', { title: course.title, course, values, errors, roster, past, admin, ...adminData });
  }

  router.get('/courses/:id', staffOnly, loadCourse, (req, res) => renderCourse(req, res));

  router.post('/courses/:id', staffOnly, loadCourse, (req, res) => {
    const admin = req.user.role === 'admin';
    const { values, errors } = readCourseForm(db, req.body, { admin });
    if (errors.length) return renderCourse(req, res, { values: { ...req.course, ...values }, errors, status: 422 });

    if (admin) {
      db.prepare(
        `UPDATE courses SET title = ?, description = ?, schedule = ?, location = ?, capacity = ?,
           instructor_id = ?, program_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(values.title, values.description, values.schedule, values.location, values.capacity,
        values.instructor_id, values.program_id, req.course.id);
    } else {
      db.prepare(
        "UPDATE courses SET title = ?, description = ?, schedule = ?, location = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(values.title, values.description, values.schedule, values.location, req.course.id);
    }
    req.flash('success', 'Course details saved.');
    res.redirect(`/courses/${req.course.id}`);
  });

  router.post('/courses/:id/remove-student', staffOnly, loadCourse, (req, res) => {
    const studentId = positiveInt(req.body.student_id);
    const reason = text(req.body.reason) || null;
    try {
      endEnrollment(db, { studentId, courseId: req.course.id, actorId: req.user.id, status: 'removed', reason });
      req.flash('success', 'The student was removed from this course.');
    } catch (err) {
      if (!(err instanceof EnrollmentError)) throw err;
      req.flash('error', err.message);
    }
    res.redirect(`/courses/${req.course.id}`);
  });

  router.post('/courses/:id/add-student', requireRole('admin'), loadCourse, (req, res) => {
    try {
      const { student } = enroll(db, {
        studentId: positiveInt(req.body.student_id),
        courseId: req.course.id,
        actorId: req.user.id,
        override: true,
      });
      req.flash('success', `${student.first_name} ${student.last_name} was added to the course.`);
    } catch (err) {
      if (!(err instanceof EnrollmentError)) throw err;
      req.flash('error', err.message);
    }
    res.redirect(`/courses/${req.course.id}`);
  });

  router.post('/courses/:id/delete', requireRole('admin'), loadCourse, (req, res) => {
    db.prepare('DELETE FROM courses WHERE id = ?').run(req.course.id);
    req.flash('success', `${req.course.title} was deleted.`);
    res.redirect(`/admin/programs/${req.course.program_id}`);
  });

  return router;
};
