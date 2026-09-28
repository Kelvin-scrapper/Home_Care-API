const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  list,
  filterOptions,
  detail,
  create,
  update,
  exportVisits,
  remove,
  listDeleted,
  restore,
  listFollowUps,
  setFollowUp,
} = require('../controllers/visitsController');

const router = express.Router();

const FIELD_STAFF = ['Volunteer/CHW', 'Coordinator/Field officer'];

router.get('/', authenticate, list);
router.get('/export', authenticate, exportVisits);
router.get('/filter-options', authenticate, filterOptions);
router.get('/follow-ups', authenticate, listFollowUps);
router.get('/deleted', authenticate, requireRole('Admin'), listDeleted);
router.get('/:id', authenticate, detail);
router.post('/', authenticate, requireRole(...FIELD_STAFF), create);
router.patch('/:id', authenticate, requireRole(...FIELD_STAFF), update);
router.delete('/:id', authenticate, requireRole('Admin'), remove);
router.post('/:id/restore', authenticate, requireRole('Admin'), restore);
router.post('/:id/follow-up', authenticate, requireRole(...FIELD_STAFF), setFollowUp);
router.delete('/:id/follow-up', authenticate, requireRole(...FIELD_STAFF), setFollowUp);

module.exports = router;
