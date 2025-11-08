require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const logger = require('./utils/logger');
const redisService = require('./services/redis.service');
const routes = require('./routes');
const swaggerSpecs = require('./docs/swagger');
const { errorHandler, notFound } = require('./middleware/error.middleware');
const { apiLimiter } = require('./middleware/rateLimit.middleware');

// Create Express app
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.env === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));
}

// Rate limiting
app.use('/api/', apiLimiter);

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'DripFyre API Docs',
}));

// Static files (for local storage)
if (config.storage.useLocal) {
  app.use('/uploads', express.static(config.storage.localPath));
}

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to DripFyre API',
    version: '1.0.0',
    documentation: '/api-docs',
    api: '/api',
  });
});

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// Initialize connections and start server
const startServer = async () => {
  try {
    // Connect to Redis
    logger.info('Connecting to Redis...');
    await redisService.connect();

    // Create necessary directories
    const fs = require('fs').promises;
    await fs.mkdir('logs', { recursive: true });
    if (config.storage.useLocal) {
      await fs.mkdir(config.storage.localPath, { recursive: true });
    }

    // Start server
    const PORT = config.port;
    app.listen(PORT, () => {
      logger.info(`🚀 DripFyre API running on port ${PORT}`);
      logger.info(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
      logger.info(`🌍 Environment: ${config.env}`);
      logger.info(`💾 Storage: ${config.storage.useLocal ? 'Local' : 'S3'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await redisService.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await redisService.disconnect();
  process.exit(0);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer();

module.exports = app;

