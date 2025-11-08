const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/session.controller');
const uploadController = require('../controllers/upload.controller');
const actionController = require('../controllers/action.controller');
const downloadController = require('../controllers/download.controller');
const { validateSession } = require('../middleware/session.middleware');
const { uploadSingle, uploadMultiple } = require('../middleware/upload.middleware');
const { uploadLimiter, strictLimiter } = require('../middleware/rateLimit.middleware');

// Session management
// Note: Frontend generates session IDs, backend creates them on first use
router.post('/create', sessionController.createSession); // Optional - for testing
router.get('/:sessionId/status', validateSession, sessionController.getSessionStatus);
router.get('/:sessionId', validateSession, sessionController.getSessionDetails);
router.delete('/:sessionId', validateSession, sessionController.deleteSession);

// Media upload
router.post(
  '/:sessionId/upload',
  validateSession,
  uploadLimiter,
  uploadMultiple('files', 10),
  uploadController.uploadMedia
);

router.get('/:sessionId/media', validateSession, uploadController.getSessionMedia);

router.delete(
  '/:sessionId/media/:mediaId',
  validateSession,
  uploadController.deleteMedia
);

// AI Image editing (NanoBanana)
router.post(
  '/:sessionId/media/:mediaId/edit',
  validateSession,
  strictLimiter,
  uploadController.editImage
);

// Voice transcription
router.post(
  '/:sessionId/transcribe',
  validateSession,
  uploadSingle('audio'),
  actionController.transcribeVoice
);

// Content processing
router.post(
  '/:sessionId/process',
  validateSession,
  strictLimiter,
  actionController.processContent
);

// AI image generation
router.post(
  '/:sessionId/generate',
  validateSession,
  strictLimiter,
  actionController.generateImage
);

// Recommendations
router.get(
  '/:sessionId/recommendations',
  validateSession,
  actionController.getRecommendations
);

// Download & Export
router.get(
  '/:sessionId/download',
  validateSession,
  downloadController.downloadContent
);

router.get(
  '/:sessionId/export',
  validateSession,
  downloadController.exportForPlatform
);

router.get(
  '/:sessionId/share',
  validateSession,
  downloadController.getShareableLink
);

module.exports = router;

