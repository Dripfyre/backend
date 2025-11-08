const transcriptionService = require('../services/transcription.service');
const coordinatorAgent = require('../agents/coordinator.agent');
const sessionService = require('../services/session.service');
const storageService = require('../services/storage.service');
const logger = require('../utils/logger');

/**
 * EDIT API
 * Voice transcribe + process everything
 */
const editWithVoice = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    console.log("🚀 ~ editWithVoice ~ sessionId:", sessionId)
    const audioFiles = req.files;
    console.log("🚀 ~ editWithVoice ~ audioFiles:", audioFiles)

    // Get session
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    let transcript = null;
    let intent = null;

    // If audio file provided, transcribe it
    if (audioFiles && audioFiles.length > 0) {
      const audioFile = audioFiles[0];
      
      logger.info(`Transcribing voice for session ${sessionId}`);
      
      // Transcribe audio
      const transcriptionResult = await transcriptionService.transcribe(audioFile.buffer);
      transcript = transcriptionResult.transcript;

      // Parse intent from transcript
      intent = transcriptionService.parseIntent(transcript);

      // Save transcript to session
      await sessionService.addTranscriptToSession(sessionId, {
        ...transcriptionResult,
        parsedIntent: intent,
      });

      logger.info(`Voice transcribed: "${transcript}"`);
    } else {
      // If no audio, check if there's a previous transcript
      if (session.metadata.voiceTranscripts && session.metadata.voiceTranscripts.length > 0) {
        const latestTranscript = session.metadata.voiceTranscripts[session.metadata.voiceTranscripts.length - 1];
        transcript = latestTranscript.transcript;
        intent = latestTranscript.parsedIntent;
      } else {
        return res.status(400).json({
          success: false,
          message: 'No audio file provided and no previous transcript found',
        });
      }
    }

    // Check if user wants to GENERATE a new image (not edit existing)
    const wantsNewImage = detectImageGenerationRequest(transcript);
    
    if (wantsNewImage) {
      logger.info('User wants to GENERATE a new image, not edit existing');
      
      // Generate new image using Imagen 3
      const aiGenerationService = require('../services/ai-generation.service');
      
      try {
        const imagePrompt = extractImagePrompt(transcript);
        logger.info(`Generating new image with prompt: "${imagePrompt}"`);
        
        const generatedImage = await aiGenerationService.generateImage(imagePrompt, {
          style: intent.style || 'photorealistic',
          aspectRatio: '1:1',
        });
        
        // Download and save the generated image
        const axios = require('axios');
        const imageUrl = generatedImage.images[0].url;
        
        let imageBuffer;
        if (imageUrl.startsWith('data:')) {
          // Base64 image
          const base64Data = imageUrl.split(',')[1];
          imageBuffer = Buffer.from(base64Data, 'base64');
        } else {
          // URL image
          const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          imageBuffer = Buffer.from(response.data);
        }
        
        // Save generated image FIRST
        const savedMedia = await storageService.uploadFile({
          buffer: imageBuffer,
          originalname: `generated_${Date.now()}.jpg`,
          mimetype: 'image/jpeg',
          size: imageBuffer.length,
        }, 'processed');
        
        logger.info(`Generated image saved: ${savedMedia.url}`);
        
        // Only delete old processed images AFTER new image is successfully saved
        if (session.metadata.processedContent?.processedMedia) {
          logger.info('Deleting old processed images after new generated image was saved');
          for (const oldProcessedUrl of session.metadata.processedContent.processedMedia) {
            try {
              await storageService.deleteFile(oldProcessedUrl);
              logger.info(`Deleted old processed image: ${oldProcessedUrl}`);
            } catch (error) {
              logger.error(`Error deleting old processed image ${oldProcessedUrl}:`, error);
            }
          }
        }
        
        // Continue with normal flow but use generated image
        const mediaFiles = [{
          fileId: savedMedia.fileId,
          url: savedMedia.url,
          mimetype: 'image/jpeg',
          buffer: imageBuffer,
        }];
        
        // Get conversation history for context-aware refinement
        const conversationHistory = {
          caption: sessionService.getConversationHistoryForAgent(session, 'caption'),
          hashtags: sessionService.getConversationHistoryForAgent(session, 'hashtags'),
        };

        // Process with AI agents for caption and hashtags
        const result = await coordinatorAgent.orchestrate(intent, mediaFiles, conversationHistory);
        
        // Only include fields that were actually generated
        const processedContent = {
          intent,
          transcript,
          processedMedia: [savedMedia.url],
          originalMedia: session.metadata.uploadedMedia.map(m => m.url),
          generatedImage: savedMedia.url, // Mark as generated
          processedAt: new Date().toISOString(),
          autoGenerated: false,
          voiceEdited: true,
        };

        // Only add caption fields if they were generated
        if (result.caption !== undefined) {
          processedContent.caption = result.caption;
        }
        if (result.captionVariations !== undefined) {
          processedContent.captionVariations = result.captionVariations;
        }

        // Only add hashtag fields if they were generated
        if (result.hashtags !== undefined) {
          processedContent.hashtags = result.hashtags;
        }
        if (result.hashtagsFormatted !== undefined) {
          processedContent.hashtagsFormatted = result.hashtagsFormatted;
        }
        
        await sessionService.storeProcessedContent(sessionId, processedContent);

        // Update conversation history for context-aware refinement
        if (result.caption !== undefined) {
          await sessionService.addToConversationHistory(
            sessionId,
            'caption',
            transcript, // User's request
            result.caption // AI's response
          );
        }

        if (result.hashtags !== undefined) {
          await sessionService.addToConversationHistory(
            sessionId,
            'hashtags',
            transcript, // User's request
            result.hashtagsFormatted || result.hashtags.join(' ') // AI's response
          );
        }
        
        // Return new generated image
        const base64 = imageBuffer.toString('base64');
        return res.json({
          success: true,
          data: {
            sessionId,
            images: [{
              url: savedMedia.url,
              base64: `data:image/jpeg;base64,${base64}`,
              mimeType: 'image/jpeg',
            }],
            caption: result.caption,
            hashtags: result.hashtagsFormatted,
            generated: true, // Flag to indicate new image was generated
          }
        });
      } catch (error) {
        logger.error('Image generation error:', error);
        // Fall through to normal edit flow
      }
    }

    // Get media from session - use processed images if they exist, otherwise use uploaded images
    // This enables iterative editing: each edit builds on the previous edit
    const fs = require('fs');
    const path = require('path');
    
    let imagesToUse = [];
    const hasProcessedImages = session.metadata.processedContent?.processedMedia && 
                               session.metadata.processedContent.processedMedia.length > 0;
    
    if (hasProcessedImages) {
      // Use previously processed images for iterative editing
      logger.info(`Using ${session.metadata.processedContent.processedMedia.length} processed images from previous edit`);
      imagesToUse = session.metadata.processedContent.processedMedia.map((url, index) => ({
        fileId: `processed_${index}`,
        url: url,
        mimeType: 'image/jpeg',
        fileName: path.basename(url),
      }));
    } else {
      // Use original uploaded images for first edit
      logger.info(`Using ${session.metadata.uploadedMedia.length} original uploaded images`);
      imagesToUse = session.metadata.uploadedMedia;
    }
    
    const mediaFiles = [];
    for (const media of imagesToUse) {
      try {
        // Load the actual image file from disk
        const filePath = path.join(process.cwd(), media.url);
        
        let buffer = null;
        if (fs.existsSync(filePath)) {
          buffer = fs.readFileSync(filePath);
          logger.info(`Loaded image buffer for ${media.fileName || path.basename(media.url)}: ${buffer.length} bytes`);
        } else {
          logger.warn(`Image file not found: ${filePath}`);
        }
        
        mediaFiles.push({
          fileId: media.fileId,
          url: media.url,
          mimetype: media.mimeType || 'image/jpeg',
          buffer: buffer,
        });
      } catch (error) {
        logger.error(`Error loading image ${media.fileName || media.url}:`, error);
        mediaFiles.push({
          fileId: media.fileId,
          url: media.url,
          mimetype: media.mimeType || 'image/jpeg',
          buffer: null,
        });
      }
    }

    // Get conversation history for context-aware refinement
    const conversationHistory = {
      caption: sessionService.getConversationHistoryForAgent(session, 'caption'),
      hashtags: sessionService.getConversationHistoryForAgent(session, 'hashtags'),
    };

    // Process with AI agents with conversation history
    logger.info(`Processing content with AI for session ${sessionId}`);
    const result = await coordinatorAgent.orchestrate(intent, mediaFiles, conversationHistory);

    // Save processed media FIRST before deleting old ones
    const processedMediaUrls = [];
    if (result.processedMedia && Array.isArray(result.processedMedia) && result.processedMedia.length > 0) {
      for (const media of result.processedMedia) {
        if (media && media.buffer && media.buffer.length > 0) {
          try {
            const savedMedia = await storageService.uploadFile({
              buffer: media.buffer,
              originalname: `processed_${media.originalFileId}.jpg`,
              mimetype: 'image/jpeg',
              size: media.buffer.length,
            }, 'processed');
            processedMediaUrls.push(savedMedia.url);
            logger.info(`Saved new processed media: ${savedMedia.url}`);
          } catch (error) {
            logger.error('Error saving processed media:', error);
          }
        }
      }
    }

    // Only delete old processed images AFTER new ones are successfully saved (for iterative editing)
    if (hasProcessedImages && processedMediaUrls.length > 0) {
      logger.info('Deleting old processed images after new ones were saved');
      for (const oldProcessedUrl of session.metadata.processedContent.processedMedia) {
        try {
          await storageService.deleteFile(oldProcessedUrl);
          logger.info(`Deleted old processed image: ${oldProcessedUrl}`);
        } catch (error) {
          logger.error(`Error deleting old processed image ${oldProcessedUrl}:`, error);
        }
      }
    }

    // Store processed content in session (this updates existing content)
    // Only include fields that were actually generated to avoid overwriting existing data
    const processedContent = {
      intent,
      transcript,
      processedMedia: processedMediaUrls.length > 0 ? processedMediaUrls : session.metadata.uploadedMedia.map(m => m.url),
      originalMedia: session.metadata.uploadedMedia.map(m => m.url),
      processedAt: new Date().toISOString(),
      autoGenerated: false, // This was customized by user
      voiceEdited: true, // Flag to show user provided voice input
    };

    // Only add caption fields if they were generated
    if (result.caption !== undefined) {
      processedContent.caption = result.caption;
    }
    if (result.captionVariations !== undefined) {
      processedContent.captionVariations = result.captionVariations;
    }

    // Only add hashtag fields if they were generated
    if (result.hashtags !== undefined) {
      processedContent.hashtags = result.hashtags;
    }
    if (result.hashtagsFormatted !== undefined) {
      processedContent.hashtagsFormatted = result.hashtagsFormatted;
    }

    await sessionService.storeProcessedContent(sessionId, processedContent);

    // Update conversation history for context-aware refinement
    if (result.caption !== undefined) {
      await sessionService.addToConversationHistory(
        sessionId,
        'caption',
        transcript, // User's request
        result.caption // AI's response
      );
    }

    if (result.hashtags !== undefined) {
      await sessionService.addToConversationHistory(
        sessionId,
        'hashtags',
        transcript, // User's request
        result.hashtagsFormatted || result.hashtags.join(' ') // AI's response
      );
    }

    logger.info(`Content processed successfully for session ${sessionId}`);

    // Convert images to base64 for easy frontend rendering
    const imagesBase64 = [];
    const imagesToConvert = processedContent.processedMedia.length > 0 
      ? processedContent.processedMedia 
      : processedContent.originalMedia;
    
    for (const imageUrl of imagesToConvert) {
      try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(process.cwd(), imageUrl);
        
        if (fs.existsSync(filePath)) {
          const imageBuffer = fs.readFileSync(filePath);
          const base64 = imageBuffer.toString('base64');
          const mimeType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
          
          imagesBase64.push({
            url: imageUrl,
            base64: `data:${mimeType};base64,${base64}`,
            mimeType: mimeType,
          });
        }
      } catch (error) {
        logger.error(`Error converting image to base64: ${imageUrl}`, error);
      }
    }

    // Simple response matching sync API format
    res.json({
      success: true,
      data: {
        sessionId,
        images: imagesBase64,
        caption: result.caption,
        hashtags: result.hashtagsFormatted,
      }
    });
  } catch (error) {
    logger.error('Edit with voice error:', error);
    next(error);
  }
};

/**
 * SYNC API
 * Get current final status
 */
const syncStatus = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    const processedContent = session.metadata.processedContent;
    const uploadedMedia = session.metadata.uploadedMedia;
    const transcripts = session.metadata.voiceTranscripts;

    // Convert images to base64
    const fs = require('fs');
    const path = require('path');
    
    const convertToBase64 = (imageUrls) => {
      const result = [];
      for (const imageUrl of imageUrls) {
        try {
          const filePath = path.join(process.cwd(), imageUrl);
          if (fs.existsSync(filePath)) {
            // const imageBuffer = fs.readFileSync(filePath);
            const imageBuffer = fs.readFileSync(filePath);
            const base64 = imageBuffer.toString('base64');
            const mimeType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
            
            result.push({
              url: imageUrl,
              base64: `data:${mimeType};base64,${base64}`,
              mimeType: mimeType,
            });
          }
        } catch (error) {
          logger.error(`Error converting image to base64: ${imageUrl}`, error);
        }
      }
      return result;
    };

    // Get image URLs
    const mainImageUrls = processedContent?.processedMedia || uploadedMedia.map(m => m.url);
    const originalImageUrls = uploadedMedia.map(m => m.url);

    // Convert to base64
    const imagesBase64 = convertToBase64(mainImageUrls);
    const originalImagesBase64 = convertToBase64(originalImageUrls);

    // Simple response with only essential data
    const response = {
      success: true,
      data: {
        sessionId: session.sessionId,
        images: imagesBase64,
        caption: processedContent?.caption || null,
        hashtags: processedContent?.hashtagsFormatted || '',
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Sync status error:', error);
    next(error);
  }
};

/**
 * Detect if user wants to GENERATE a new image
 */
function detectImageGenerationRequest(transcript) {
  if (!transcript) return false;
  
  const lower = transcript.toLowerCase();
  
  // Keywords that indicate generation (not editing)
  const generationKeywords = [
    'generate new image',
    'create new image',
    'generate image',
    'create image',
    'generate a new',
    'create a new',
    'make a new image',
    'new image of',
    'generate picture',
    'create picture',
  ];
  
  return generationKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Extract the image prompt from transcript
 */
function extractImagePrompt(transcript) {
  if (!transcript) return 'a beautiful image';
  
  // Remove generation keywords and extract the subject
  const lower = transcript.toLowerCase();
  
  const patterns = [
    /generate (?:new )?(?:image|picture) (?:of|about|for) (.*)/i,
    /create (?:new )?(?:image|picture) (?:of|about|for) (.*)/i,
    /new image (?:of|about|for) (.*)/i,
    /make (?:a |an )?(?:new )?image (?:of|about|for) (.*)/i,
  ];
  
  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // Fallback: remove common prefixes
  return transcript
    .replace(/^(generate|create|make) (?:new |a |an )?(?:image|picture) ?(?:of|about|for)? ?/i, '')
    .trim() || 'a beautiful image';
}

module.exports = {
  editWithVoice,
  syncStatus,
  detectImageGenerationRequest,
  extractImagePrompt,
};

