const express = require('express');
const router = express.Router();
const sessionRoutes = require('./session.routes');
const socialRoutes = require('./social.routes');
const mvpRoutes = require('./mvp.routes');

// MVP API routes (simple 3 endpoints)
router.use('/v1', mvpRoutes);

// Full API routes (for advanced features)
router.use('/session', sessionRoutes);
router.use('/social', socialRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'DripFyre API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to DripFyre API',
    version: '1.0.0',
    mvp: {
      description: 'Simple 3-endpoint MVP API',
      endpoints: {
        upload: 'POST /api/v1/:sessionId/upload - Upload images/videos',
        edit: 'POST /api/v1/:sessionId/edit - Voice transcribe & AI process',
        sync: 'GET /api/v1/:sessionId/sync - Get current status',
      },
    },
    full: {
      description: 'Full featured API (advanced)',
      session: {
        create: 'POST /api/session/create',
        status: 'GET /api/session/:sessionId/status',
        upload: 'POST /api/session/:sessionId/upload',
        transcribe: 'POST /api/session/:sessionId/transcribe',
        process: 'POST /api/session/:sessionId/process',
        generate: 'POST /api/session/:sessionId/generate',
        download: 'GET /api/session/:sessionId/download',
      },
      social: {
        instagramAuth: 'GET /api/social/auth/instagram/url',
        facebookAuth: 'GET /api/social/auth/facebook/url',
        publish: 'POST /api/social/:sessionId/publish/:platform',
      },
    },
    documentation: '/api-docs',
  });
});

module.exports = router;

