const GenerationSession = require('../models/GenerationSession');
const { generateCard }   = require('../services/openaiService');

const send = (ws, data) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
};

const friendlyError = (reason, cardNumber) => {
  if (reason === 'INTENTIONAL')      return `Card ${cardNumber} was randomly chosen to fail in order to demonstrate the retry feature. Click "Retry" to regenerate it.`;
  if (reason === 'PARSE_ERROR')      return `The AI returned an unreadable response for card ${cardNumber}. This is usually temporary — try retrying.`;
  if (reason === 'INVALID_STRUCTURE')return `The AI's response for card ${cardNumber} was missing required fields. Try retrying for a fresh response.`;
  if (reason?.toLowerCase().includes('rate limit')) return `The AI service is busy right now (rate limit). Wait a moment and retry card ${cardNumber}.`;
  if (reason?.toLowerCase().includes('api key'))    return `There is an API key configuration issue. Please contact support.`;
  return `Something went wrong while generating card ${cardNumber}. Please try retrying.`;
};

/** Check if an error is from an AbortController abort. */
const isAbortError = (err) =>
  err?.name === 'AbortError' ||
  err?.name === 'APIUserAbortError' ||
  err?.code === 'ERR_CANCELED' ||
  err?.message === 'Request was aborted.';

/**
 * Per-client state:
 *   controller – AbortController for the active OpenAI request
 *   sessionId  – active session's Mongo id (so STOP can save it)
 */
const clientStates = new Map();

const handleGenerate = async (ws, { topic, mode, cardCount }) => {
  const total = Math.min(Math.max(parseInt(cardCount) || 3, 1), 10);

  // Fresh AbortController for this generation run
  const controller = new AbortController();
  clientStates.set(ws, { controller, sessionId: null });

  // Pick ONE random card to fail in failure mode
  const failCard = mode === 'failure' ? Math.floor(Math.random() * total) + 1 : null;

  let session;
  let anyFailed = false;

  try {
    session = await GenerationSession.create({ topic, totalCards: total, status: 'pending', cards: [] });
    clientStates.get(ws).sessionId = session._id.toString();
    send(ws, { type: 'SESSION_CREATED', sessionId: session._id.toString() });

    for (let cardNumber = 1; cardNumber <= total; cardNumber++) {
      // Intentional failure for the chosen card
      if (cardNumber === failCard) {
        anyFailed = true;
        session.cards.push({ cardNumber, title: '', concept: '', funFact: '', status: 'failed' });
        session.markModified('cards');
        await session.save();
        send(ws, {
          type: 'ERROR',
          cardNumber,
          message: friendlyError('INTENTIONAL', cardNumber),
          sessionId: session._id.toString()
        });
        continue; // keep generating remaining cards
      }

      try {
        // ─── Pass the AbortSignal — abort() cancels this fetch immediately ───
        const cardData = await generateCard(topic, cardNumber, controller.signal);

        session.cards.push({
          cardNumber, title: cardData.title, concept: cardData.concept,
          funFact: cardData.funFact, status: 'completed'
        });
        session.markModified('cards');
        await session.save();
        send(ws, { type: 'CARD', cardNumber, data: cardData });

      } catch (err) {
        // ── Abort = user clicked Stop mid-card ──
        if (isAbortError(err)) {
          const savedCount = session.cards.filter(c => c.status === 'completed').length;
          session.status = 'stopped';
          await session.save().catch(() => {});
          send(ws, {
            type: 'STOPPED',
            sessionId: session._id.toString(),
            completedCards: savedCount,
            total
          });
          return; // exit — do not send COMPLETE
        }

        // Regular generation error — log and continue with remaining cards
        console.error(`Card ${cardNumber} error:`, err.message);
        anyFailed = true;
        session.cards.push({ cardNumber, title: '', concept: '', funFact: '', status: 'failed' });
        session.markModified('cards');
        await session.save();
        send(ws, {
          type: 'ERROR',
          cardNumber,
          message: friendlyError(err.message, cardNumber),
          sessionId: session._id.toString()
        });
        // continue generating remaining cards
      }
    }

    // All cards processed
    session.status = anyFailed ? 'failed' : 'completed';
    await session.save();
    send(ws, { type: 'COMPLETE', anyFailed });

  } catch (err) {
    if (isAbortError(err)) return; // already handled inside the loop
    console.error('handleGenerate critical error:', err.message);
    send(ws, { type: 'ERROR', cardNumber: null, message: 'A server error occurred. Please try again.' });
    if (session) { session.status = 'failed'; await session.save().catch(() => {}); }
  }
};

const handleStop = (ws) => {
  const state = clientStates.get(ws);
  if (state?.controller) {
    state.controller.abort(); // ← immediately cancels the active OpenAI HTTP request
  }
  // Client gets either STOPPED (from the abort catch above) or STOP_ACK if nothing was running
  send(ws, { type: 'STOP_ACK' });
};

const handleRetry = async (ws, { sessionId, cardNumber }) => {
  const controller = new AbortController();
  // Store so a subsequent Stop can cancel a retry too
  const state = clientStates.get(ws);
  if (state) state.controller = controller;

  try {
    const session = await GenerationSession.findById(sessionId);
    if (!session) {
      send(ws, { type: 'ERROR', cardNumber, message: 'Session not found. Please start a new generation.' });
      return;
    }

    const cardData = await generateCard(session.topic, cardNumber, controller.signal);

    const idx = session.cards.findIndex((c) => c.cardNumber === cardNumber);
    const updated = { cardNumber, title: cardData.title, concept: cardData.concept, funFact: cardData.funFact, status: 'completed' };
    if (idx >= 0) session.cards[idx] = updated; else session.cards.push(updated);

    const allDone = session.cards.length >= session.totalCards &&
      session.cards.every((c) => c.status === 'completed');
    session.status = allDone ? 'completed' : 'failed';
    session.markModified('cards');
    await session.save();

    send(ws, { type: 'CARD', cardNumber, data: cardData });
    if (allDone) send(ws, { type: 'COMPLETE', anyFailed: false });
  } catch (err) {
    if (isAbortError(err)) return;
    console.error('handleRetry error:', err.message);
    send(ws, { type: 'ERROR', cardNumber, message: friendlyError(err.message, cardNumber) });
  }
};

const setupWebSocket = (wss) => {
  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    clientStates.set(ws, { controller: null, sessionId: null });

    ws.on('message', async (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { send(ws, { type: 'ERROR', message: 'Invalid message format' }); return; }

      switch (message.type) {
        case 'GENERATE': await handleGenerate(ws, message); break;
        case 'STOP':           handleStop(ws);              break;
        case 'RETRY':    await handleRetry(ws, message);    break;
        default:
          send(ws, { type: 'ERROR', message: `Unknown message type: ${message.type}` });
      }
    });

    ws.on('close', () => {
      // Cancel any active request when client disconnects
      clientStates.get(ws)?.controller?.abort();
      clientStates.delete(ws);
      console.log('WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      clientStates.get(ws)?.controller?.abort();
      clientStates.delete(ws);
      console.error('WebSocket error:', err.message);
    });
  });
};

module.exports = { setupWebSocket };
