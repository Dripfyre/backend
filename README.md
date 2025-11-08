# DripFyre Backend API

AI-powered content co-creator backend built for GenZ influencers, brands, and content creators.

## 🚀 Features

- ⚡ **Ultra-Fast Uploads**: LiteLLM generates captions in 2-3 seconds
- 🧠 **Smart Edits**: Multi-agent system for voice-driven customization (5-8s)
- 🎨 **AI-Powered Image Editing**: NanoBanana (Google Imagen 3) - ALWAYS generates new images with AI for ALL edit requests (NEW!)
- **Dual AI Architecture**:
  - LiteLLM Service (Gemini Flash) for instant uploads
  - Agent System (Gemini Pro) for custom edits
- **Multi-Agent AI System**: 
  - Caption Generator (Google Gemini 2.5 Pro - FREE)
  - Hashtag Generator with trend detection (Gemini)
  - Image Editor with AI-powered editing (NanoBanana)
  - Coordinator Agent using LangGraph (Gemini)
- **Voice Transcription**: Sarvam AI (Indian languages) + Deepgram + Whisper fallbacks
- **AI Image Generation**: Google Imagen 3 / NanoBanana (FREE!)
- **AI Image Editing**: Natural language editing - "make it brighter", "add vintage filter", etc. ⭐ ALWAYS uses AI (NanoBanana) to generate new images for every edit request
- **Social Media Integration**:
  - Instagram (Posts & Reels)
  - Facebook (Pages)
  - YouTube (Videos)
- **Media Processing**: Sharp for basic operations, AI for creative edits
- **Real-time Sessions**: Redis-based session management with auto-creation
- **File Storage**: Local storage with 2-folder structure (uploads/processed)

## 📋 Prerequisites

- Node.js 18+ 
- Redis Server
- API Keys:
  - Google API Key (FREE - Required for Gemini + Imagen 3)
  - Sarvam AI API Key (FREE tier - Required for voice)
  - Deepgram API Key (optional - $200 free for voice fallback)
  - Instagram/Facebook/YouTube OAuth credentials (optional - for social posting)

## 🛠️ Installation

1. **Clone and navigate to backend directory**
```bash
cd /home/rahul-kadu/dripfyre/backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

4. **Start Redis** (if not already running)
```bash
# On Linux/Mac
redis-server

# On Docker
docker run -d -p 6379:6379 redis
```

5. **Start the development server**
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## 📁 Project Structure

```
backend/
├── src/
│   ├── agents/               # LangGraph AI agents
│   │   ├── coordinator.agent.js
│   │   ├── captionGenerator.agent.js
│   │   ├── hashtagGenerator.agent.js
│   │   └── imageEditor.agent.js
│   ├── config/               # Configuration
│   │   └── index.js
│   ├── controllers/          # Route controllers
│   │   ├── session.controller.js
│   │   ├── upload.controller.js
│   │   ├── action.controller.js
│   │   ├── social.controller.js
│   │   └── download.controller.js
│   ├── middleware/           # Express middleware
│   │   ├── session.middleware.js
│   │   ├── upload.middleware.js
│   │   ├── error.middleware.js
│   │   └── rateLimit.middleware.js
│   ├── routes/               # API routes
│   │   ├── session.routes.js
│   │   ├── social.routes.js
│   │   └── index.js
│   ├── services/             # Business logic
│   │   ├── redis.service.js
│   │   ├── session.service.js
│   │   ├── storage.service.js
│   │   ├── transcription.service.js
│   │   ├── ai-generation.service.js
│   │   └── social.service.js
│   ├── utils/                # Utilities
│   │   ├── logger.js
│   │   ├── validators.js
│   │   └── errors.js
│   ├── docs/                 # API documentation
│   │   └── swagger.js
│   └── app.js                # Main application
├── uploads/                  # Local media storage
├── logs/                     # Application logs
├── .env                      # Environment variables
├── .gitignore
├── package.json
└── README.md
```

## 🔑 Environment Variables

A `.env` file has been created with all required variables. You need to add your API keys:

### Minimum Required (FREE):
```env
GOOGLE_API_KEY=your_key           # Get from: https://makersuite.google.com/app/apikey
SARVAM_API_KEY=your_key           # Get from: https://www.sarvam.ai/
JWT_SECRET=your_secret            # Any random string
```

**Note:** Use `GOOGLE_API_KEY` for Gemini (required by LangChain).

### Optional (FREE credits available):
```env
DEEPGRAM_API_KEY=your_key         # $200 free credits for voice
```

**Note:** Image generation now uses Imagen 3 (same key as Gemini - already included!).

See `GEMINI_SETUP.md` and `SARVAM_SETUP.md` for detailed setup guides!

## 📚 API Documentation

Once the server is running, visit:
- **Swagger UI**: http://localhost:3000/api-docs
- **API Root**: http://localhost:3000/api

## 🎯 API Endpoints

### Session Management
- `POST /api/session/create` - Create new session
- `GET /api/session/:sessionId/status` - Get session status
- `GET /api/session/:sessionId` - Get session details
- `DELETE /api/session/:sessionId` - Delete session

### Media Upload
- `POST /api/session/:sessionId/upload` - Upload media files
- `GET /api/session/:sessionId/media` - List uploaded media
- `DELETE /api/session/:sessionId/media/:mediaId` - Delete media
- `POST /api/session/:sessionId/media/:mediaId/edit` - Edit image with AI (NEW!)

### Content Processing
- `POST /api/session/:sessionId/transcribe` - Transcribe voice
- `POST /api/session/:sessionId/process` - Process content with AI
- `POST /api/session/:sessionId/generate` - Generate AI image
- `GET /api/session/:sessionId/recommendations` - Get recommendations

### Social Media
- `GET /api/social/auth/instagram/url` - Get Instagram OAuth URL
- `GET /api/social/auth/facebook/url` - Get Facebook OAuth URL
- `POST /api/social/:sessionId/publish/:platform` - Publish to social media

### Download & Export
- `GET /api/session/:sessionId/download` - Download content (JSON/ZIP)
- `GET /api/session/:sessionId/export` - Export for platform
- `GET /api/session/:sessionId/share` - Get shareable link

## 🔄 Workflow Example

```javascript
// 1. Create session
POST /api/session/create
Response: { sessionId: "uuid-123" }

// 2. Upload media
POST /api/session/uuid-123/upload
Body: FormData with files

// 3. Transcribe voice intent (optional)
POST /api/session/uuid-123/transcribe
Body: audio file

// 4. Process content with AI agents
POST /api/session/uuid-123/process
Body: { intent: "Create an aesthetic reel about Monday motivation" }

Response: {
  caption: "Start your week strong! 💪✨...",
  hashtags: ["#mondaymotivation", "#aesthetic", ...],
  processedMedia: ["url1", "url2"],
  ...
}

// 5. (NEW!) Edit uploaded image with AI
POST /api/session/uuid-123/media/media-id-123/edit
Body: {
  editRequest: "Make it brighter and more vibrant",
  style: "aesthetic",
  mood: "happy"
}
// Response includes edited image as base64 (original file is overridden)

// 6. Publish to Instagram
POST /api/social/uuid-123/publish/instagram
Body: { accessToken: "token", ... }

// 7. Download content
GET /api/session/uuid-123/download?format=zip
```

## 🧪 Testing

```bash
# Run tests (once implemented)
npm test

# Test API with curl
curl http://localhost:3000/api/health

# Test image editing with AI
./test-image-edit.sh

# View curl examples for image editing
./curl-edit-examples.sh
```

## 📖 Additional Documentation

- **[IMAGE_EDITING_API.md](./IMAGE_EDITING_API.md)** - Complete guide to AI image editing with NanoBanana
- **[IMAGEN_SETUP.md](./IMAGEN_SETUP.md)** - Setup guide for Google Imagen 3
- **[GEMINI_SETUP.md](./GEMINI_SETUP.md)** - Setup guide for Google Gemini
- **[SARVAM_SETUP.md](./SARVAM_SETUP.md)** - Setup guide for Sarvam AI voice
- **[API_EXAMPLES.md](./API_EXAMPLES.md)** - Complete API examples
- **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)** - Frontend integration guide
- **[curl-edit-examples.sh](./curl-edit-examples.sh)** - cURL examples for image editing
- **[test-image-edit.sh](./test-image-edit.sh)** - Test script for image editing flow

## 🚀 Deployment

### Production Build

```bash
NODE_ENV=production npm start
```

### Docker (Optional)

```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "src/app.js"]
```

## 📱 React Native Integration

Your React Native app should interact with these endpoints:

```javascript
// Example API client
const API_BASE = 'http://localhost:3000/api';

// Create session
const createSession = async () => {
  const response = await fetch(`${API_BASE}/session/create`, {
    method: 'POST',
  });
  return response.json();
};

// Upload media
const uploadMedia = async (sessionId, files) => {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  
  const response = await fetch(`${API_BASE}/session/${sessionId}/upload`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
};

// Process content
const processContent = async (sessionId, intent) => {
  const response = await fetch(`${API_BASE}/session/${sessionId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent }),
  });
  return response.json();
};
```

## 🔒 Security Best Practices

1. **Never commit `.env` file**
2. **Use strong JWT secrets in production**
3. **Enable HTTPS in production**
4. **Implement rate limiting (already included)**
5. **Validate all user inputs**
6. **Keep dependencies updated**
7. **Use environment-specific configs**

## 🐛 Troubleshooting

### Redis Connection Issues
```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG
```

### Port Already in Use
```bash
# Change PORT in .env
PORT=3001
```

### File Upload Issues
```bash
# Check upload directory permissions
chmod 755 uploads/
```

## 📝 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## 📧 Support

For support, email support@dripfyre.com or open an issue on GitHub.

---

Built with ❤️ by the DripFyre Team
