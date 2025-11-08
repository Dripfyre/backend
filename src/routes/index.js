const express = require('express');
const router = express.Router();
const mvpRoutes = require('./mvp.routes');

// MVP API routes (simple 3 endpoints)
router.use('/v1', mvpRoutes);

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
    message: 'Welcome to DripFyre API - MVP',
    version: '1.0.0',
    endpoints: {
      upload: 'POST /api/v1/:sessionId/upload - Upload images/videos',
      edit: 'POST /api/v1/:sessionId/edit - Voice transcribe & AI process',
      sync: 'GET /api/v1/:sessionId/sync - Get current status',
      createPost: 'POST /api/v1/:sessionId/post - Create post with name',
      getPost: 'GET /api/v1/:sessionId/post - Get single post',
      deletePost: 'DELETE /api/v1/:sessionId/post - Delete post',
      timeline: 'GET /api/v1/timeline?page=1&limit=10 - Get paginated timeline',
    },
    documentation: '/api-docs',
  });
});

module.exports = router;

