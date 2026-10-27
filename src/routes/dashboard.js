const express = require('express');
const { requireLogin } = require('../lib/auth');
const { childrenOf } = require('../lib/access');
const { activeEnrollmentsFor } = require('../lib/enrollment');

module.exports = (db) => {
  const router = express.Router();

  const dashboards = {
    student(user) {
      const openPrograms = db.prepare("SELECT COUNT(*) AS n FROM programs WHERE status = 'open'").get().n;
      return { courses: activeEnrollmentsFor(db, user.id), openPrograms };
    },

    parent(user) {
      const children = childrenOf(db, user.id).map((child) => ({
        ...child,
        courses: activeEnrollmentsFor(db, child.id),
      }));
      return { children };
    },

    instructor(user) {
      const courses = db
        .prepare(
          `SELECT c.*, p.name AS program_name, p.status AS program_status, p.start_date, p.end_date,
                  (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolled_count
           FROM courses c JOIN programs p ON p.id = c.program_id
           WHERE c.instructor_id = ? ORDER BY p.start_date, c.title`
        )
        .all(user.id);
      return { courses };
    },

    admin() {
      const roleCounts = Object.fromEntries(
        db.prepare('SELECT role, COUNT(*) AS n FROM users WHERE active = 1 GROUP BY role').all().map((r) => [r.role, r.n])
      );
      const stats = {
        roleCounts,
        programs: db.prepare('SELECT COUNT(*) AS n FROM programs').get().n,
        openPrograms: db.prepare("SELECT COUNT(*) AS n FROM programs WHERE status = 'open'").get().n,
        courses: db.prepare('SELECT COUNT(*) AS n FROM courses').get().n,
        activeEnrollments: db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active'").get().n,
        unassignedCourses: db.prepare('SELECT COUNT(*) AS n FROM courses WHERE instructor_id IS NULL').get().n,
        unlinkedStudents: db
          .prepare(
            `SELECT COUNT(*) AS n FROM users u WHERE u.role = 'student' AND u.active = 1
             AND NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = u.id)`
          )
          .get().n,
      };
      const recentUsers = db
        .prepare('SELECT id, first_name, last_name, role, created_at FROM users ORDER BY id DESC LIMIT 8')
        .all();
      const recentRemovals = db
        .prepare(
          `SELECT e.ended_at, e.end_reason, s.first_name, s.last_name, c.id AS course_id, c.title
           FROM enrollments e JOIN users s ON s.id = e.student_id JOIN courses c ON c.id = e.course_id
           WHERE e.status = 'removed' ORDER BY e.ended_at DESC LIMIT 5`
        )
        .all();
      return { stats, recentUsers, recentRemovals };
    },
  };

  router.get('/dashboard', requireLogin, (req, res) => {
    const { role } = req.user;
    res.render(`dashboard/${role}`, { title: 'Dashboard', ...dashboards[role](req.user) });
  });

  return router;
};
