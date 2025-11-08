const transcriptionService = require('../services/transcription.service');
const aiService = require('../services/ai.service');
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

    // Get image data for AI processing
    const imageData = mediaFiles.length > 0 && mediaFiles[0].buffer
      ? { buffer: mediaFiles[0].buffer, mimeType: mediaFiles[0].mimetype }
      : null;

    // Process with AI service
    logger.info(`Processing content with AI for session ${sessionId}`);
    const result = await aiService.processVoiceCommand(transcript, imageData);

    // Handle generated or edited images from NanoBanana
    const processedMediaUrls = [];
    
    // If new image was generated
    if (result.imageGenerated && result.generatedImage) {
      logger.info('Saving generated image from NanoBanana');
      try {
        // Download and save the generated image
        const axios = require('axios');
        const imageUrl = result.generatedImage.imageUrl;
        
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
        
        // Save generated image
        const savedMedia = await storageService.uploadFile({
          buffer: imageBuffer,
          originalname: `generated_${Date.now()}.jpg`,
          mimetype: result.generatedImage.mimeType || 'image/jpeg',
          size: imageBuffer.length,
        }, 'processed');
        
        processedMediaUrls.push(savedMedia.url);
        logger.info(`Generated image saved: ${savedMedia.url}`);
      } catch (error) {
        logger.error('Error saving generated image:', error);
      }
    }
    
    // If existing image was edited
    if (result.imageEdited && result.editedImage) {
      logger.info('Saving edited image from NanoBanana');
      try {
        // Get image buffer (could be from imageUrl or imageBuffer)
        let imageBuffer = result.editedImage.imageBuffer;
        
        if (!imageBuffer && result.editedImage.imageUrl) {
          const imageUrl = result.editedImage.imageUrl;
          
          if (imageUrl.startsWith('data:')) {
            const base64Data = imageUrl.split(',')[1];
            imageBuffer = Buffer.from(base64Data, 'base64');
          } else {
            const axios = require('axios');
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
          }
        }
        
        if (imageBuffer) {
          const savedMedia = await storageService.uploadFile({
            buffer: imageBuffer,
            originalname: `edited_${Date.now()}.jpg`,
            mimetype: result.editedImage.mimeType || 'image/jpeg',
            size: imageBuffer.length,
          }, 'processed');
          
          processedMediaUrls.push(savedMedia.url);
          logger.info(`Edited image saved: ${savedMedia.url}`);
        }
      } catch (error) {
        logger.error('Error saving edited image:', error);
      }
    }

    // Save processed media FIRST before deleting old ones
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

    // Only delete old processed images if NEW images were generated/edited
    // This prevents deletion when only captions/hashtags are updated
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
    } else if (processedMediaUrls.length === 0 && hasProcessedImages) {
      logger.info('No new images generated - keeping existing processed images');
    }

    // Store processed content in session (this updates existing content)
    // Only include fields that were actually generated to avoid overwriting existing data
    const processedContent = {
      intent,
      transcript,
      // Keep processed images: use new ones if generated/edited, otherwise keep existing processed images, or fall back to original
      processedMedia: processedMediaUrls.length > 0 
        ? processedMediaUrls  // New images were generated/edited
        : (hasProcessedImages 
            ? session.metadata.processedContent.processedMedia  // Keep existing processed images
            : session.metadata.uploadedMedia.map(m => m.url)),  // Fall back to original uploaded images
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

module.exports = {
  editWithVoice,
  syncStatus,
};

