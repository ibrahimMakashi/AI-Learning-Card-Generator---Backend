const express = require('express');
const router = express.Router();
const { getSessions, getSessionById } = require('../controllers/sessionController');

router.get('/', getSessions);
router.get('/:id', getSessionById);

module.exports = router;
