const express = require('express');
const { requireRole } = require('../lib/auth');
const { messageContacts, courseParentIds, canManageCourse } = require('../lib/access');
const { findCourse } = require('../lib/enrollment');
const { transaction } = require('../db');
const { text, positiveInt, idList } = require('../lib/forms');

const MAX_SUBJECT = 200;
const MAX_BODY = 10000;

module.exports = (db) => {
  const router = express.Router();
  const messagingRoles = requireRole('parent', 'instructor', 'admin');

  function threadRoot(threadId, userId) {
    return db
      .prepare('SELECT * FROM messages WHERE id = ? AND thread_id = id AND (sender_id = ? OR recipient_id = ?)')
      .get(threadId, userId, userId);
  }

  function insertMessage({ threadId = null, senderId, recipientId, courseId, subject, body }) {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO messages (thread_id, sender_id, recipient_id, course_id, subject, body) VALUES (?, ?, ?, ?, ?, ?)')
      .run(threadId, senderId, recipientId, courseId, subject, body);
    const id = Number(lastInsertRowid);
    if (!threadId) db.prepare('UPDATE messages SET thread_id = ? WHERE id = ?').run(id, id);
    return id;
  }

  // A course the user teaches (or any course, for admins), for "message all parents in this course".
  function managedCourse(user, courseId) {
    const course = courseId ? findCourse(db, courseId) : null;
    return canManageCourse(user, course) ? course : null;
  }

  router.get('/messages', messagingRoles, (req, res) => {
    const threads = db
      .prepare(
        `SELECT r.id AS thread_id, r.subject, o.first_name AS other_first, o.last_name AS other_last, o.role AS other_role,
                c.title AS course_title,
                (SELECT MAX(id) FROM messages WHERE thread_id = r.id) AS last_id,
                (SELECT MAX(created_at) FROM messages WHERE thread_id = r.id) AS last_at,
                (SELECT COUNT(*) FROM messages WHERE thread_id = r.id AND recipient_id = $me AND read_at IS NULL) AS unread
         FROM messages r
         JOIN users o ON o.id = CASE WHEN r.sender_id = $me THEN r.recipient_id ELSE r.sender_id END
         LEFT JOIN courses c ON c.id = r.course_id
         WHERE r.id = r.thread_id AND (r.sender_id = $me OR r.recipient_id = $me)
         ORDER BY last_id DESC`
      )
      .all({ me: req.user.id });
    res.render('messages/index', { title: 'Messages', threads });
  });

  router.get('/messages/new', messagingRoles, (req, res) => {
    const contacts = messageContacts(db, req.user);
    const course = managedCourse(req.user, positiveInt(req.query.course));
    let selected = idList(req.query.to);
    if (course) selected = selected.concat(courseParentIds(db, course.id));
    res.render('messages/new', {
      title: 'New message',
      contacts,
      course,
      values: { recipient_ids: selected, subject: course ? `${course.title}: ` : '', body: '' },
      errors: [],
    });
  });

  router.post('/messages', messagingRoles, (req, res) => {
    const contacts = messageContacts(db, req.user);
    const allowed = new Set(contacts.map((c) => c.id));
    const course = managedCourse(req.user, positiveInt(req.body.course_id));
    const values = { recipient_ids: idList(req.body.recipient_ids), subject: text(req.body.subject), body: text(req.body.body) };

    const errors = [];
    if (!values.recipient_ids.length) errors.push('Choose at least one recipient.');
    if (values.recipient_ids.some((id) => !allowed.has(id))) errors.push('You can only message people on your contact list.');
    if (!values.subject) errors.push('Add a subject.');
    if (values.subject.length > MAX_SUBJECT) errors.push(`Subject must be ${MAX_SUBJECT} characters or fewer.`);
    if (!values.body) errors.push('Write a message.');
    if (values.body.length > MAX_BODY) errors.push(`Message must be ${MAX_BODY} characters or fewer.`);
    if (errors.length) {
      return res.status(422).render('messages/new', { title: 'New message', contacts, course, values, errors });
    }

    // Each recipient gets a private copy, so parents never see each other's replies or contact details.
    const threadIds = transaction(db, () =>
      values.recipient_ids.map((recipientId) =>
        insertMessage({
          senderId: req.user.id,
          recipientId,
          courseId: course ? course.id : null,
          subject: values.subject,
          body: values.body,
        })
      )
    );
    if (threadIds.length === 1) {
      req.flash('success', 'Message sent.');
      return res.redirect(`/messages/${threadIds[0]}`);
    }
    req.flash('success', `Message sent privately to ${threadIds.length} people.`);
    res.redirect('/messages');
  });

  router.get('/messages/:id', messagingRoles, (req, res) => {
    const root = threadRoot(positiveInt(req.params.id), req.user.id);
    if (!root) return res.status(404).render('error', { title: 'Conversation not found', message: 'We could not find that conversation.' });

    const otherId = root.sender_id === req.user.id ? root.recipient_id : root.sender_id;
    const other = db.prepare('SELECT id, first_name, last_name, role, active FROM users WHERE id = ?').get(otherId);
    const messages = db
      .prepare(
        `SELECT m.*, s.first_name AS sender_first, s.last_name AS sender_last
         FROM messages m JOIN users s ON s.id = m.sender_id WHERE m.thread_id = ? ORDER BY m.id`
      )
      .all(root.id);
    const course = root.course_id ? db.prepare('SELECT id, title FROM courses WHERE id = ?').get(root.course_id) : null;
    db.prepare("UPDATE messages SET read_at = datetime('now') WHERE thread_id = ? AND recipient_id = ? AND read_at IS NULL").run(
      root.id,
      req.user.id
    );
    res.render('messages/thread', { title: root.subject, root, other, messages, course });
  });

  router.post('/messages/:id/reply', messagingRoles, (req, res) => {
    const root = threadRoot(positiveInt(req.params.id), req.user.id);
    if (!root) return res.status(404).render('error', { title: 'Conversation not found', message: 'We could not find that conversation.' });
    const otherId = root.sender_id === req.user.id ? root.recipient_id : root.sender_id;
    const other = db.prepare('SELECT active FROM users WHERE id = ?').get(otherId);
    const body = text(req.body.body);

    if (!other || !other.active) req.flash('error', 'This person no longer has an active account.');
    else if (!body) req.flash('error', 'Write a reply before sending.');
    else if (body.length > MAX_BODY) req.flash('error', `Replies must be ${MAX_BODY} characters or fewer.`);
    else {
      const subject = root.subject.startsWith('Re: ') ? root.subject : `Re: ${root.subject}`;
      insertMessage({ threadId: root.id, senderId: req.user.id, recipientId: otherId, courseId: root.course_id, subject, body });
      req.flash('success', 'Reply sent.');
    }
    res.redirect(`/messages/${root.id}`);
  });

  return router;
};
