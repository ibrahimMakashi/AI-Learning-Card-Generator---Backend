const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  cardNumber: { type: Number, required: true },
  title:     { type: String, default: '' },
  concept:   { type: String, default: '' },
  funFact:   { type: String, default: '' },
  status:    { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' }
});

const generationSessionSchema = new mongoose.Schema({
  topic:      { type: String, required: true },
  totalCards: { type: Number, default: 3 },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'stopped'],
    default: 'pending'
  },
  cards:     [cardSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GenerationSession', generationSessionSchema);
