const sessionService = require('../services/session.service');
const logger = require('../utils/logger');

/**
 * Create new session
 */
const createSession = async (req, res, next) => {
  try {
    const session = await sessionService.createSession();

    res.status(201).json({
      success: true,
      message: 'Session created successfully',
      data: {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        expiresIn: '24 hours',
      },
    });
  } catch (error) {
    logger.error('Create session error:', error);
    next(error);
  }
};

/**
 * Get session status
 */
const getSessionStatus = async (req, res, next) => {
  try {
    const session = req.session; // Already validated by middleware

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        uploadedMedia: session.metadata.uploadedMedia.length,
        hasProcessedContent: !!session.metadata.processedContent,
      },
    });
  } catch (error) {
    logger.error('Get session error:', error);
    next(error);
  }
};

/**
 * Delete session
 */
const deleteSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    await sessionService.deleteSession(sessionId);

    res.json({
      success: true,
      message: 'Session deleted successfully',
    });
  } catch (error) {
    logger.error('Delete session error:', error);
    next(error);
  }
};

/**
 * Get session details
 */
const getSessionDetails = async (req, res, next) => {
  try {
    const session = req.session; // Attached by middleware

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    logger.error('Get session details error:', error);
    next(error);
  }
};

module.exports = {
  createSession,
  getSessionStatus,
  deleteSession,
  getSessionDetails,
};

