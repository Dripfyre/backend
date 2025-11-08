const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class ImagenService {
  constructor() {
    this.apiKey = config.imagen.apiKey;
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict';
  }

  /**
   * Generate image using Google Imagen 3 (NanoBanana)
   */
  async generateImage(prompt, options = {}) {
    try {
      const {
        aspectRatio = '1:1',
        style = 'default',
        numberOfImages = 1,
      } = options;

      // Enhance prompt with style
      const enhancedPrompt = this.enhancePromptWithStyle(prompt, style);

      // Convert aspect ratio to Imagen format
      const imagenAspectRatio = this.convertAspectRatio(aspectRatio);

      const requestBody = {
        prompt: enhancedPrompt,
        number_of_images: numberOfImages,
        aspect_ratio: imagenAspectRatio,
        safety_filter_level: 'block_some',
        person_generation: 'allow_adult',
      };

      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 seconds
        }
      );

      const images = response.data.predictions.map(pred => ({
        url: pred.image_url || `data:image/png;base64,${pred.bytesBase64Encoded}`,
        mimeType: pred.mimeType || 'image/png',
      }));

      logger.info('Imagen 3 generation successful', {
        prompt: prompt.substring(0, 50),
        numberOfImages: images.length,
      });

      return {
        images,
        provider: 'imagen-3',
        model: 'imagen-3.0-generate-001',
      };
    } catch (error) {
      logger.error('Imagen 3 generation error:', error.response?.data || error.message);
      throw new Error(`Failed to generate image with Imagen 3: ${error.message}`);
    }
  }

  /**
   * Generate image with retry logic
   */
  async generateImageWithRetry(prompt, options = {}, maxRetries = 2) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await this.generateImage(prompt, options);
      } catch (error) {
        lastError = error;
        if (i < maxRetries) {
          logger.warn(`Imagen 3 attempt ${i + 1} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Convert aspect ratio to Imagen format
   */
  convertAspectRatio(aspectRatio) {
    const ratioMap = {
      '1:1': '1:1',      // Square
      '16:9': '16:9',    // Landscape
      '9:16': '9:16',    // Portrait
      '4:3': '4:3',      // Landscape
      '3:4': '3:4',      // Portrait
      '4:5': '4:5',      // Portrait (Instagram)
    };

    return ratioMap[aspectRatio] || '1:1';
  }

  /**
   * Enhance prompt with style
   */
  enhancePromptWithStyle(prompt, style) {
    const styleEnhancements = {
      aesthetic: ', aesthetic, soft lighting, pastel colors, dreamy atmosphere, instagram aesthetic, visually pleasing',
      minimal: ', minimalist, clean, simple, modern, white space, elegant, uncluttered',
      vibrant: ', vibrant colors, bold, energetic, colorful, eye-catching, dynamic, saturated',
      photorealistic: ', photorealistic, high quality, detailed, professional photography, realistic',
      artistic: ', artistic, creative, unique, expressive, stylized',
      default: ', high quality, professional, well-composed',
    };

    const enhancement = styleEnhancements[style] || styleEnhancements.default;
    return `${prompt}${enhancement}`;
  }

  /**
   * Generate multiple variations of an image
   */
  async generateVariations(prompt, count = 3, options = {}) {
    try {
      const result = await this.generateImage(prompt, {
        ...options,
        numberOfImages: count,
      });

      return result;
    } catch (error) {
      logger.error('Imagen 3 variations error:', error);
      throw error;
    }
  }

  /**
   * Edit image with prompt using Imagen 3 (image-to-image editing)
   */
  async editImage(imageBuffer, editPrompt, options = {}) {
    try {
      const {
        aspectRatio = '1:1',
        style = 'default',
        strength = 0.7, // How much to change (0.0 - 1.0)
      } = options;

      logger.info('Editing image with Imagen 3', { 
        prompt: editPrompt.substring(0, 50),
        style,
        aspectRatio 
      });

      // Enhance edit prompt with style
      const enhancedPrompt = this.enhanceEditPrompt(editPrompt, style);

      // Convert image buffer to base64
      const base64Image = imageBuffer.toString('base64');

      // Convert aspect ratio
      const imagenAspectRatio = this.convertAspectRatio(aspectRatio);

      const requestBody = {
        prompt: enhancedPrompt,
        image: {
          bytesBase64Encoded: base64Image,
        },
        number_of_images: 1,
        aspect_ratio: imagenAspectRatio,
        edit_mode: 'inpainting-insert', // or 'product-image', 'outpainting'
        safety_filter_level: 'block_some',
        person_generation: 'allow_adult',
      };

      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 90000, // 90 seconds for editing
        }
      );

      const editedImage = response.data.predictions[0];
      const imageData = editedImage.image_url 
        ? editedImage.image_url 
        : `data:image/png;base64,${editedImage.bytesBase64Encoded}`;

      logger.info('Imagen 3 editing successful');

      return {
        imageUrl: imageData,
        imageBuffer: editedImage.bytesBase64Encoded 
          ? Buffer.from(editedImage.bytesBase64Encoded, 'base64')
          : null,
        mimeType: editedImage.mimeType || 'image/png',
        provider: 'imagen-3',
        model: 'imagen-3.0-generate-001',
        editPrompt: enhancedPrompt,
      };
    } catch (error) {
      logger.error('Imagen 3 editing error:', error.response?.data || error.message);
      throw new Error(`Failed to edit image with Imagen 3: ${error.message}`);
    }
  }

  /**
   * Edit image using Gemini with vision (NanoBanana approach)
   * This uses Gemini's multimodal capabilities for more natural editing
   */
  async editImageWithGemini(imageBuffer, editPrompt, options = {}) {
    try {
      const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
      const { HumanMessage } = require('@langchain/core/messages');

      logger.info('Editing image with Gemini (NanoBanana)', { 
        prompt: editPrompt.substring(0, 50) 
      });

      // Initialize Gemini with vision
      const geminiVision = new ChatGoogleGenerativeAI({
        apiKey: this.apiKey,
        modelName: 'imagen-4.0-generate-001',
        temperature: 0.3,
      });

      // Convert image to base64
      const base64Image = imageBuffer.toString('base64');
      const mimeType = 'image/jpeg'; // Adjust based on actual image type

      // Create editing instruction prompt
      const fullPrompt = `You are an expert image editor. Analyze this image and describe the exact edits needed to: ${editPrompt}

Return a detailed prompt that can be used to regenerate this image with the requested edits applied. Include:
1. Current image description
2. Requested modifications
3. Style and mood to maintain
4. Technical details (lighting, colors, composition)

Keep the essence of the original but apply the edits naturally.`;

      // Analyze image with Gemini
      const response = await geminiVision.invoke([
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: fullPrompt,
            },
            {
              type: 'image_url',
              image_url: `data:${mimeType};base64,${base64Image}`,
            },
          ],
        }),
      ]);

      // Get the enhanced prompt from Gemini
      const enhancedEditPrompt = response.content;
      logger.info('Gemini generated edit prompt:', enhancedEditPrompt);

      // Now generate the edited image using Imagen 3
      const result = await this.generateImage(enhancedEditPrompt, {
        aspectRatio: options.aspectRatio || '1:1',
        style: options.style || 'photorealistic',
        numberOfImages: 1,
      });

      return {
        imageUrl: result.images[0].url,
        imageBuffer: null, // Will need to fetch if needed
        mimeType: result.images[0].mimeType,
        provider: 'gemini-vision + imagen-3',
        model: 'gemini-2.5-pro + imagen-3',
        originalPrompt: editPrompt,
        enhancedPrompt: enhancedEditPrompt,
      };
    } catch (error) {
      logger.error('Gemini image editing error:', error);
      throw new Error(`Failed to edit image with Gemini: ${error.message}`);
    }
  }

  /**
   * Enhance edit prompt with context
   */
  enhanceEditPrompt(prompt, style) {
    const styleEnhancements = {
      aesthetic: ' with soft aesthetic lighting, dreamy atmosphere, instagram quality',
      minimal: ' in a clean minimalist style, simple and modern',
      vibrant: ' with vibrant colors, bold and energetic',
      photorealistic: ' maintaining photorealistic quality, natural and realistic',
      artistic: ' with artistic flair, creative and expressive',
      default: ' maintaining high quality and natural look',
    };

    const enhancement = styleEnhancements[style] || styleEnhancements.default;
    return `${prompt}${enhancement}`;
  }

  /**
   * Upscale image (if available)
   */
  async upscaleImage(imageBuffer, options = {}) {
    try {
      // For now, use image editing with upscale prompt
      return await this.editImage(
        imageBuffer,
        'Enhance image quality, increase resolution, sharpen details, maintain original composition',
        { ...options, style: 'photorealistic' }
      );
    } catch (error) {
      logger.error('Image upscaling error:', error);
      throw new Error('Image upscaling not yet fully implemented for Imagen 3');
    }
  }

  /**
   * Check if API key is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }
}

module.exports = new ImagenService();

