const GenerationSession = require('../models/GenerationSession');

const getSessions = async (req, res) => {
  try {
    const sessions = await GenerationSession.find()
      .sort({ createdAt: -1 })
      .select('topic status createdAt cards');
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getSessionById = async (req, res) => {
  try {
    const session = await GenerationSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getSessions, getSessionById };
