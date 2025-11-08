const transcriptionService = require('../services/transcription.service');
const aiGenerationService = require('../services/ai-generation.service');
const coordinatorAgent = require('../agents/coordinator.agent');
const sessionService = require('../services/session.service');
const storageService = require('../services/storage.service');
const logger = require('../utils/logger');

/**
 * Transcribe voice intent
 */
const transcribeVoice = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const audioFile = req.file;
    const { language, useWhisper, useDeepgram } = req.body;

    if (!audioFile) {
      return res.status(400).json({
        success: false,
        message: 'No audio file provided',
      });
    }

    // Transcribe audio with options
    const result = await transcriptionService.transcribe(audioFile.buffer, {
      language, // Optional: 'en-IN', 'hi-IN', 'ta-IN', etc.
      useWhisper: useWhisper === 'true',
      useDeepgram: useDeepgram === 'true',
    });

    // Parse intent from transcript
    const intent = transcriptionService.parseIntent(result.transcript);

    // Save transcript to session
    await sessionService.addTranscriptToSession(sessionId, {
      ...result,
      parsedIntent: intent,
    });

    logger.info(`Voice transcribed for session ${sessionId}`, {
      provider: result.provider,
      language: result.language,
    });

    res.json({
      success: true,
      message: 'Voice transcribed successfully',
      data: {
        transcript: result.transcript,
        confidence: result.confidence,
        language: result.language,
        detectedLanguage: intent.detectedLanguage,
        intent,
        provider: result.provider,
      },
    });
  } catch (error) {
    logger.error('Transcribe voice error:', error);
    next(error);
  }
};

/**
 * Process content with AI agents
 */
const processContent = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { intent, useVoiceIntent = false } = req.body;

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    // Determine intent source
    let finalIntent;
    if (useVoiceIntent && session.metadata.voiceTranscripts.length > 0) {
      // Use latest voice transcript
      const latestTranscript = session.metadata.voiceTranscripts[session.metadata.voiceTranscripts.length - 1];
      finalIntent = latestTranscript.parsedIntent;
    } else if (intent) {
      // Parse text intent
      finalIntent = transcriptionService.parseIntent(intent);
    } else {
      return res.status(400).json({
        success: false,
        message: 'No intent provided',
      });
    }

    // Get uploaded media
    const mediaFiles = session.metadata.uploadedMedia.map(media => ({
      fileId: media.fileId,
      url: media.url,
      mimetype: media.mimeType,
      buffer: null, // Will be loaded if needed
    }));

    // Load media buffers for processing
    for (const file of mediaFiles) {
      if (file.mimetype.startsWith('image/')) {
        // Load image buffer (simplified - in production, load from storage)
        file.buffer = Buffer.from([]); // Placeholder
      }
    }

    // Orchestrate AI agents
    logger.info('Starting AI orchestration');
    const result = await coordinatorAgent.orchestrate(finalIntent, mediaFiles);

    // Save processed media
    const processedMediaUrls = [];
    if (result.processedMedia && result.processedMedia.length > 0) {
      for (const media of result.processedMedia) {
        const savedMedia = await storageService.uploadFile({
          buffer: media.buffer,
          originalname: `processed_${media.originalFileId}.jpg`,
          mimetype: 'image/jpeg',
          size: media.buffer.length,
        }, 'processed');
        processedMediaUrls.push(savedMedia.url);
      }
    }

    // Store processed content in session
    const processedContent = {
      intent: finalIntent,
      caption: result.caption,
      captionVariations: result.captionVariations,
      hashtags: result.hashtags,
      hashtagsFormatted: result.hashtagsFormatted,
      processedMedia: processedMediaUrls,
      metadata: result.metadata,
      processedAt: new Date().toISOString(),
    };

    await sessionService.storeProcessedContent(sessionId, processedContent);

    logger.info(`Content processed for session ${sessionId}`);

    res.json({
      success: true,
      message: 'Content processed successfully',
      data: processedContent,
    });
  } catch (error) {
    logger.error('Process content error:', error);
    next(error);
  }
};

/**
 * Generate AI image
 */
const generateImage = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { prompt, style = 'default', aspectRatio = '1:1', provider = 'dalle' } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required',
      });
    }

    // Generate image
    const result = await aiGenerationService.generateImage(prompt, {
      style,
      aspectRatio,
      provider,
    });

    // Save to session
    const imageInfo = {
      mediaId: require('uuid').v4(),
      url: result.images[0].url,
      type: 'ai-generated',
      prompt,
      style,
      aspectRatio,
      provider: result.provider,
      generatedAt: new Date().toISOString(),
    };

    await sessionService.addMediaToSession(sessionId, imageInfo);

    logger.info(`AI image generated for session ${sessionId}`);

    res.json({
      success: true,
      message: 'Image generated successfully',
      data: {
        images: result.images,
        provider: result.provider,
        savedTo: imageInfo.mediaId,
      },
    });
  } catch (error) {
    logger.error('Generate image error:', error);
    next(error);
  }
};

/**
 * Get content recommendations
 */
const getRecommendations = async (req, res, next) => {
  try {
    const session = req.session;

    if (!session.metadata.processedContent) {
      return res.status(400).json({
        success: false,
        message: 'No processed content found. Process content first.',
      });
    }

    const recommendations = await coordinatorAgent.getRecommendations(
      session.metadata.processedContent.intent,
      session.metadata.processedContent
    );

    res.json({
      success: true,
      data: {
        recommendations,
      },
    });
  } catch (error) {
    logger.error('Get recommendations error:', error);
    next(error);
  }
};

module.exports = {
  transcribeVoice,
  processContent,
  generateImage,
  getRecommendations,
};

