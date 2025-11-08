const express = require('express');
const router = express.Router();
const { validateSession } = require('../middleware/session.middleware');
const { uploadMultiple } = require('../middleware/upload.middleware');
const { uploadLimiter, strictLimiter } = require('../middleware/rateLimit.middleware');
const uploadController = require('../controllers/upload.controller');
const mvpController = require('../controllers/mvp.controller');

// MVP API - Simple 3 endpoints

/**
 * 1. UPLOAD API
 * Upload images or videos
 * POST /:sessionId/upload
 */
router.post(
  '/:sessionId/upload',
  validateSession,
  uploadLimiter,
  uploadMultiple('files', 10),
  uploadController.uploadMedia
);

/**
 * 2. EDIT API (Voice Transcribe + Process)
 * Send voice to update/edit everything (caption, hashtags, image edits)
 * POST /:sessionId/edit
 */
router.post(
  '/:sessionId/edit',
  validateSession,
  strictLimiter,
  uploadMultiple('audio', 1),
  mvpController.editWithVoice
);

/**
 * 3. SYNC API
 * Get current final status (images, captions, hashtags)
 * GET /:sessionId/sync
 */
router.get(
  '/:sessionId/sync',
  validateSession,
  mvpController.syncStatus
);

module.exports = router;

