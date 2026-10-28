const express = require('express');
const { requireRole } = require('../lib/auth');
const { childrenOf, isParentOf } = require('../lib/access');
const { enroll, endEnrollment, EnrollmentError } = require('../lib/enrollment');
const { positiveInt } = require('../lib/forms');

module.exports = (db) => {
  const router = express.Router();

  // The students the signed-in user may sign up or drop: themselves (students) or their children (parents).
  function studentsFor(user) {
    return user.role === 'student' ? [user] : childrenOf(db, user.id).filter((c) => c.active);
  }

  function mayActFor(user, studentId) {
    if (user.role === 'student') return user.id === studentId;
    return user.role === 'parent' && isParentOf(db, user.id, studentId);
  }

  router.get('/programs', requireRole('student', 'parent', 'instructor', 'admin'), (req, res) => {
    const programs = db
      .prepare("SELECT * FROM programs WHERE status = 'open' ORDER BY start_date, name")
      .all()
      .map((program) => ({
        ...program,
        courses: db
          .prepare(
            `SELECT c.*, i.first_name AS instructor_first, i.last_name AS instructor_last,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolled_count
             FROM courses c LEFT JOIN users i ON i.id = c.instructor_id
             WHERE c.program_id = ? ORDER BY c.title`
          )
          .all(program.id),
      }));

    const students = ['student', 'parent'].includes(req.user.role) ? studentsFor(req.user) : [];
    // Map of "studentId:courseId" -> enrollment status, so the page can show "Signed up" etc.
    const statuses = {};
    if (students.length) {
      const rows = db
        .prepare(
          `SELECT student_id, course_id, status FROM enrollments
           WHERE student_id IN (${students.map(() => '?').join(',')})`
        )
        .all(...students.map((s) => s.id));
      for (const row of rows) statuses[`${row.student_id}:${row.course_id}`] = row.status;
    }

    res.render('programs/index', { title: 'Programs', programs, students, statuses });
  });

  router.post('/enrollments', requireRole('student', 'parent'), (req, res) => {
    const courseId = positiveInt(req.body.course_id);
    const studentId = req.user.role === 'student' ? req.user.id : positiveInt(req.body.student_id);
    if (!courseId || !studentId || !mayActFor(req.user, studentId)) {
      req.flash('error', 'You can only sign up yourself or your own children.');
      return res.redirect('/programs');
    }
    try {
      const { course, student } = enroll(db, { studentId, courseId, actorId: req.user.id });
      const who = req.user.role === 'student' ? 'You are' : `${student.first_name} is`;
      req.flash('success', `${who} signed up for ${course.title}.`);
      res.redirect('/dashboard');
    } catch (err) {
      if (!(err instanceof EnrollmentError)) throw err;
      req.flash('error', err.message);
      res.redirect('/programs');
    }
  });

  router.post('/enrollments/drop', requireRole('student', 'parent'), (req, res) => {
    const courseId = positiveInt(req.body.course_id);
    const studentId = req.user.role === 'student' ? req.user.id : positiveInt(req.body.student_id);
    if (!courseId || !studentId || !mayActFor(req.user, studentId)) {
      req.flash('error', 'You can only change your own or your children\'s sign-ups.');
      return res.redirect('/dashboard');
    }
    try {
      endEnrollment(db, { studentId, courseId, actorId: req.user.id, status: 'dropped', reason: 'Dropped by family' });
      req.flash('success', 'The course was dropped.');
    } catch (err) {
      if (!(err instanceof EnrollmentError)) throw err;
      req.flash('error', err.message);
    }
    res.redirect('/dashboard');
  });

  return router;
};
