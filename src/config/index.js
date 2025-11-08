require('dotenv').config();

module.exports = {
  // Server Configuration
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  apiUrl: process.env.API_URL || 'http://localhost:3000',

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // Storage Configuration
  storage: {
    useLocal: process.env.USE_LOCAL_STORAGE === 'true',
    localPath: process.env.LOCAL_STORAGE_PATH || './uploads',
    s3: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET_NAME,
    },
  },

  // AI Services Configuration
  gemini: {
    apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY, // Optional - only for Whisper fallback
  },

  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY,
  },

  // Sarvam AI (Indian AI - Primary for transcription)
  sarvam: {
    apiKey: process.env.SARVAM_API_KEY,
    apiUrl: process.env.SARVAM_API_URL || 'https://api.sarvam.ai',
  },

  // Imagen 3 uses same Google API key as Gemini
  imagen: {
    apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  },

  // Social Media APIs
  instagram: {
    clientId: process.env.INSTAGRAM_CLIENT_ID,
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET,
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI,
  },

  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI,
  },

  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI,
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },

  // Session Configuration
  session: {
    expiryHours: parseInt(process.env.SESSION_EXPIRY_HOURS) || 24,
  },

  // File Upload Limits
  upload: {
    maxFileSize: 100 * 1024 * 1024, // 100MB
    maxFiles: 10,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedVideoTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
    allowedAudioTypes: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'],
  },
};

