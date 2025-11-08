const express = require('express');
const router = express.Router();
const socialController = require('../controllers/social.controller');
const { validateSession } = require('../middleware/session.middleware');

// OAuth URLs
router.get('/auth/instagram/url', socialController.getInstagramAuthUrl);
router.get('/auth/facebook/url', socialController.getFacebookAuthUrl);

// OAuth callbacks
router.get('/auth/instagram/callback', socialController.instagramCallback);
router.get('/auth/facebook/callback', socialController.facebookCallback);

// Publish content
router.post(
  '/:sessionId/publish/:platform',
  validateSession,
  socialController.publishContent
);

module.exports = router;

