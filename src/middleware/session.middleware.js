const sessionService = require('../services/session.service');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');
const { v4: uuidv4, validate: validateUUID } = require('uuid');

/**
 * Middleware to validate and auto-create session if needed
 * Frontend sends session ID, backend creates it on first use
 */
const validateSession = async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId || req.body.sessionId;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required. Frontend should generate and send a UUID.',
      });
    }

    // Validate UUID format
    // if (!validateUUID(sessionId)) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Invalid session ID format. Must be a valid UUID.',
    //   });
    // }

    // Get or create session
    let session = await sessionService.getSession(sessionId);

    if (!session) {
      // Auto-create session on first use
      logger.info(`Auto-creating session: ${sessionId}`);
      session = await sessionService.createSessionWithId(sessionId);
    } else {
      // Extend session expiry on activity
      await sessionService.extendSession(sessionId);
    }

    // Attach session to request
    req.session = session;
    req.sessionId = sessionId;

    next();
  } catch (error) {
    logger.error('Session validation error:', error);
    next(error);
  }
};

module.exports = {
  validateSession,
};

