const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const logger = require('../utils/logger');
const storageService = require('../services/storage.service');

class ImageEditorAgent {
  constructor() {
    this.genaiClient = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genaiClient.getGenerativeModel({ 
      model: 'gemini-2.5-flash-image-preview' 
    });
  }

  /**
   * Process image based on intent - NOW USING AI-POWERED EDITING
   */
  async processImage(imageBuffer, intent, options = {}) {
    try {
      logger.info('Processing image with AI-powered editing', { intent });

      // Determine if we need AI editing or just basic operations
      const needsAIEditing = this.needsAIEditing(intent);
      
      let processedBuffer = imageBuffer;

      if (needsAIEditing) {
        // Use Gemini 2.5 Flash Image Preview for AI-powered image generation
        processedBuffer = await this.applyAIEditing(imageBuffer, intent, options);
      } else {
        // Use basic Sharp operations for simple tasks
        logger.info('Using basic operations (no AI needed)');
        
        // Resize for platform if needed
        if (intent.platform) {
          processedBuffer = await this.resizeForPlatform(processedBuffer, intent.platform, intent.action);
        }

        // Basic enhancement
        processedBuffer = await this.enhanceImage(processedBuffer);
      }

      logger.info('Image processing complete');

      return {
        buffer: processedBuffer,
        applied: needsAIEditing ? ['ai_editing', 'resize', 'enhancement'] : ['resize', 'enhancement'],
      };
    } catch (error) {
      logger.error('Image processing error:', error);
      throw error;
    }
  }

  /**
   * Determine if AI editing is needed
   * NOW: ALWAYS returns true for edit API - forces AI-powered image generation
   */
  needsAIEditing(intent) {
    const transcript = intent.rawTranscript?.toLowerCase() || '';

    // If user is only talking about hashtags or captions, no image editing needed
    const isOnlyAboutText = (
      (transcript.includes('hashtag') || transcript.includes('caption')) &&
      !transcript.includes('image') &&
      !transcript.includes('picture') &&
      !transcript.includes('photo') &&
      !transcript.includes('aesthetic') &&
      !transcript.includes('filter') &&
      !transcript.includes('bright') &&
      !transcript.includes('color') &&
      !transcript.includes('vibrant')
    );

    if (isOnlyAboutText) {
      logger.info('User request is about text (hashtags/captions), not image editing');
      return false;
    }

    // ALWAYS USE AI for any image-related edit request
    // This forces gemini-2.5-flash-image-preview to generate new images for all edit API calls
    logger.info('AI editing ENABLED - using gemini-2.5-flash-image-preview for image generation');
    return true;
  }

  /**
   * Apply AI-powered editing using Gemini 2.5 Flash Image Preview
   * Passes reference image and user prompt to update the image
   */
  async applyAIEditing(imageBuffer, intent, options = {}) {
    try {
      // Get the raw user prompt directly
      const userPrompt = intent.rawTranscript || intent.editInstructions || 'Generate an enhanced image';
      
      this.logPromptPreview('Direct user prompt to gemini-2.5-flash-image-preview', userPrompt);

      // Convert image buffer to base64
      const base64Image = imageBuffer.toString('base64');
      
      // Detect mime type from buffer
      const mimeType = this.detectMimeType(imageBuffer);

      // Generate image with reference image and prompt
      const response = await this.model.generateContent([
        userPrompt,
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType
          }
        }
      ]);
      
      logger.info('Gemini image generation response received');

      // Extract image from response
      if (response && response.response) {
        const result = response.response;
        
        // Check if response contains image data
        if (result.candidates && result.candidates[0]) {
          const candidate = result.candidates[0];
          
          // Handle different response formats
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              // Check for inline data (base64)
              if (part.inlineData) {
                const base64Data = part.inlineData.data;
                return Buffer.from(base64Data, 'base64');
              }
              
              // Check for file data
              if (part.fileData) {
                // Fetch from file URI
                const axios = require('axios');
                const response = await axios.get(part.fileData.fileUri, { 
                  responseType: 'arraybuffer' 
                });
                return Buffer.from(response.data);
              }
            }
          }
        }
      }

      // If no image was generated, fall back to basic processing
      logger.warn('No image generated from Gemini, falling back to basic processing');
      return await this.basicProcessing(imageBuffer, intent);
    } catch (error) {
      logger.error('AI image generation failed, falling back to basic processing:', error);
      // Fallback to basic processing if AI editing fails
      return await this.basicProcessing(imageBuffer, intent);
    }
  }

  /**
   * Detect MIME type from image buffer
   */
  detectMimeType(buffer) {
    // Check magic numbers to detect image type
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      return 'image/webp';
    }
    // Default to JPEG if unknown
    return 'image/jpeg';
  }

  logPromptPreview(label, prompt) {
    if (!prompt) return;

    const preview = prompt.length > 600 ? `${prompt.slice(0, 600)}...` : prompt;
    logger.info(label, { preview });
  }

  /**
   * Basic processing fallback (no AI)
   */
  async basicProcessing(imageBuffer, intent) {
    let processed = imageBuffer;

    // Resize for platform
    if (intent.platform) {
      processed = await this.resizeForPlatform(processed, intent.platform, intent.action);
    }

    // Basic enhancement
    processed = await this.enhanceImage(processed);

    return processed;
  }

  /**
   * Edit uploaded image based on user request
   * This is the main entry point for user-initiated edits
   */
  async editUploadedImage(imageBuffer, editRequest, options = {}) {
    try {
      logger.info('Editing uploaded image with request:', editRequest);

      // Create intent object from edit request
      const intent = {
        rawTranscript: editRequest,
        editInstructions: editRequest,
        platform: options.platform,
        action: options.action,
        style: options.style,
        mood: options.mood,
      };

      // Use AI-powered editing
      const result = await this.applyAIEditing(imageBuffer, intent, options);

      return {
        buffer: result,
        editApplied: editRequest,
        method: 'ai_powered',
      };
    } catch (error) {
      logger.error('Image edit error:', error);
      throw error;
    }
  }

  /**
   * Resize for specific platform
   */
  async resizeForPlatform(buffer, platform, action) {
    try {
      let dimensions;

      if (platform === 'instagram') {
        if (action === 'create_reel' || action === 'create_story') {
          dimensions = { width: 1080, height: 1920 }; // 9:16
        } else {
          dimensions = { width: 1080, height: 1080 }; // 1:1
        }
      } else if (platform === 'facebook') {
        dimensions = { width: 1200, height: 630 }; // Facebook recommended
      } else if (platform === 'youtube') {
        dimensions = { width: 1280, height: 720 }; // 16:9
      } else {
        dimensions = { width: 1080, height: 1080 }; // Default square
      }

      const resized = await sharp(buffer)
        .resize(dimensions.width, dimensions.height, {
          fit: 'cover',
          position: 'center',
        })
        .toBuffer();

      return resized;
    } catch (error) {
      logger.error('Platform resize error:', error);
      return buffer;
    }
  }

  /**
   * Enhance image quality
   */
  async enhanceImage(buffer) {
    try {
      const enhanced = await sharp(buffer)
        .sharpen()
        .normalize()
        .toBuffer();

      return enhanced;
    } catch (error) {
      logger.error('Enhancement error:', error);
      return buffer;
    }
  }

  /**
   * Add text overlay to image
   */
  async addTextOverlay(buffer, text, options = {}) {
    try {
      const {
        position = 'center',
        fontSize = 72,
        color = 'white',
      } = options;

      // Create SVG text overlay
      const svg = `
        <svg width="1080" height="200">
          <text
            x="50%"
            y="50%"
            text-anchor="middle"
            font-size="${fontSize}"
            fill="${color}"
            font-family="Arial, sans-serif"
            font-weight="bold"
          >
            ${text}
          </text>
        </svg>
      `;

      const svgBuffer = Buffer.from(svg);

      const composite = await sharp(buffer)
        .composite([{
          input: svgBuffer,
          gravity: position,
        }])
        .toBuffer();

      return composite;
    } catch (error) {
      logger.error('Text overlay error:', error);
      return buffer;
    }
  }

  /**
   * Create collage from multiple images
   */
  async createCollage(imageBuffers, layout = 'grid') {
    try {
      // Simple 2x2 grid layout
      if (imageBuffers.length >= 4) {
        const resized = await Promise.all(
          imageBuffers.slice(0, 4).map(buffer =>
            sharp(buffer)
              .resize(540, 540)
              .toBuffer()
          )
        );

        const collage = await sharp({
          create: {
            width: 1080,
            height: 1080,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        })
          .composite([
            { input: resized[0], top: 0, left: 0 },
            { input: resized[1], top: 0, left: 540 },
            { input: resized[2], top: 540, left: 0 },
            { input: resized[3], top: 540, left: 540 },
          ])
          .jpeg()
          .toBuffer();

        return collage;
      }

      return imageBuffers[0];
    } catch (error) {
      logger.error('Collage creation error:', error);
      return imageBuffers[0];
    }
  }
}

module.exports = new ImageEditorAgent();

