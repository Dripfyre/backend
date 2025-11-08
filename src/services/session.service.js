const { v4: uuidv4 } = require('uuid');
const redisService = require('./redis.service');
const config = require('../config');
const logger = require('../utils/logger');

const SESSION_PREFIX = 'session:';
const SESSION_EXPIRY = config.session.expiryHours * 3600; // Convert to seconds

class SessionService {
  /**
   * Create a new session with frontend-provided ID
   */
  async createSessionWithId(sessionId) {
    const session = {
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'active',
      source: 'frontend',
      metadata: {
        uploadedMedia: [],
        processedContent: null,
        voiceTranscripts: [],
        conversationHistory: {
          caption: [],
          hashtags: [],
        },
      },
    };

    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.set(key, session, SESSION_EXPIRY);

    logger.info(`Session auto-created from frontend: ${sessionId}`);
    return session;
  }

  /**
   * Create a new session (legacy - for backend-generated IDs)
   */
  async createSession() {
    const sessionId = uuidv4();
    return await this.createSessionWithId(sessionId);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId) {
    const key = `${SESSION_PREFIX}${sessionId}`;
    const session = await redisService.get(key);
    
    if (!session) {
      logger.warn(`Session not found: ${sessionId}`);
      return null;
    }

    return session;
  }

  /**
   * Update session data
   */
  async updateSession(sessionId, updates) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    const updatedSession = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.set(key, updatedSession, SESSION_EXPIRY);

    logger.info(`Session updated: ${sessionId}`);
    return updatedSession;
  }

  /**
   * Add media to session
   */
  async addMediaToSession(sessionId, mediaInfo) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    session.metadata.uploadedMedia.push(mediaInfo);
    session.updatedAt = new Date().toISOString();

    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.set(key, session, SESSION_EXPIRY);

    logger.info(`Media added to session: ${sessionId}`);
    return session;
  }

  /**
   * Add voice transcript to session
   */
  async addTranscriptToSession(sessionId, transcript) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    session.metadata.voiceTranscripts.push({
      transcript,
      timestamp: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();

    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.set(key, session, SESSION_EXPIRY);

    logger.info(`Transcript added to session: ${sessionId}`);
    return session;
  }

  /**
   * Store processed content in session
   */
  async storeProcessedContent(sessionId, content) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    // Merge new content with existing content to preserve fields that weren't updated
    // This prevents null/undefined values from overwriting existing data
    session.metadata.processedContent = {
      ...session.metadata.processedContent, // Keep existing fields
      ...content, // Override with new fields (only what was generated)
    };
    
    session.status = 'processed';
    session.updatedAt = new Date().toISOString();

    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.set(key, session, SESSION_EXPIRY);

    logger.info(`Processed content stored in session: ${sessionId}`);
    return session;
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.delete(key);
    
    logger.info(`Session deleted: ${sessionId}`);
    return true;
  }

  /**
   * Check if session exists
   */
  async sessionExists(sessionId) {
    const key = `${SESSION_PREFIX}${sessionId}`;
    return await redisService.exists(key);
  }

  /**
   * Extend session expiry
   */
  async extendSession(sessionId) {
    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.expire(key, SESSION_EXPIRY);
    
    logger.info(`Session expiry extended: ${sessionId}`);
    return true;
  }

  /**
   * Get all sessions (for admin purposes)
   */
  async getAllSessions() {
    const keys = await redisService.keys(`${SESSION_PREFIX}*`);
    const sessions = [];

    for (const key of keys) {
      const session = await redisService.get(key);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Add to conversation history for an agent
   * This enables context-aware refinement
   */
  async addToConversationHistory(sessionId, agentType, userMessage, aiResponse) {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    // Initialize conversation history if not exists
    if (!session.metadata.conversationHistory) {
      session.metadata.conversationHistory = {
        caption: [],
        hashtags: [],
      };
    }

    if (!session.metadata.conversationHistory[agentType]) {
      session.metadata.conversationHistory[agentType] = [];
    }

    // Add user message and AI response to history
    session.metadata.conversationHistory[agentType].push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    session.metadata.conversationHistory[agentType].push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 10 messages (5 exchanges) to avoid token overflow
    if (session.metadata.conversationHistory[agentType].length > 10) {
      session.metadata.conversationHistory[agentType] = 
        session.metadata.conversationHistory[agentType].slice(-10);
    }

    session.updatedAt = new Date().toISOString();

    const key = `${SESSION_PREFIX}${sessionId}`;
    await redisService.set(key, session, SESSION_EXPIRY);

    logger.info(`Conversation history updated for ${agentType} in session: ${sessionId}`);
    return session;
  }

  /**
   * Get conversation history for building context
   */
  getConversationHistoryForAgent(session, agentType) {
    if (!session?.metadata?.conversationHistory?.[agentType]) {
      return [];
    }

    // Convert our stored format to LangChain message format
    const { HumanMessage, AIMessage } = require('@langchain/core/messages');
    
    return session.metadata.conversationHistory[agentType].map(msg => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else {
        return new AIMessage(msg.content);
      }
    });
  }
}

module.exports = new SessionService();

