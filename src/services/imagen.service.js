const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const logger = require('../utils/logger');

class ImagenService {
  constructor() {
    this.apiKey = config.imagen.apiKey;
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  /**
   * Generate image using Google Imagen 4 (NanoBanana)
   */
  async generateImage(prompt, options = {}) {
    try {
      const {
        numberOfImages = 1,
        aspectRatio = '4:5',
      } = options;

      logger.info('Generating image with Imagen 4', {
        prompt: prompt.substring(0, 50),
        numberOfImages,
        aspectRatio,
      });

      // Use the correct Google GenAI SDK method
      const response = await this.client.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        numberOfImages: numberOfImages,
        aspectRatio: aspectRatio,
      });

      // Process generated images
      const images = response.generatedImages.map((generatedImage) => {
        const imageBytes = generatedImage.image.imageBytes;
        const base64Image = Buffer.from(imageBytes, 'base64').toString('base64');
        
        return {
          url: `data:image/png;base64,${base64Image}`,
          imageBytes: imageBytes,
          mimeType: 'image/png',
        };
      });

      logger.info('Imagen 4 generation successful', {
        prompt: prompt.substring(0, 50),
        numberOfImages: images.length,
      });

      return {
        images,
        provider: 'imagen-4',
        model: 'imagen-4.0-generate-001',
      };
    } catch (error) {
      logger.error('Imagen 4 generation error:', error);
      throw new Error(`Failed to generate image with Imagen 4: ${error.message}`);
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
   * Edit image using Gemini Vision + Imagen 4 generation
   * 
   * Uses a conservative approach:
   * 1. Gemini Vision analyzes the entire image in detail
   * 2. Creates a comprehensive prompt that describes everything in the original
   * 3. Adds ONLY the specific requested change
   * 4. Imagen 4 generates a new image that preserves all unchanged elements
   * 
   * This ensures minimal changes - only what's explicitly requested is modified.
   */
  async editImage(imageBuffer, editPrompt, options = {}) {
    try {
      const {
        aspectRatio = '4:5',
      } = options;

      logger.info('Editing image with Gemini Vision + Imagen 4 (conservative mode)', { 
        prompt: editPrompt.substring(0, 50),
        aspectRatio 
      });

      // Convert image to base64
      const base64Image = imageBuffer.toString('base64');
      
      // Detect mime type
      const mimeType = this.detectMimeType(imageBuffer);

      // Create analysis prompt for Gemini - very conservative editing
      const analysisPrompt = `You are an expert image analyst. Analyze this image in detail.

User wants to edit ONLY this: "${editPrompt}"

CRITICAL INSTRUCTIONS:
1. Keep EVERYTHING exactly the same EXCEPT for the specific edit requested: ${editPrompt}
2. The edit should be MINIMAL and PRECISE - change ONLY what was asked
3. All other elements must remain IDENTICAL - same positions, same colors, same objects, same style, same composition
4. Be very specific about what stays the same and what changes

Example: If user says "make it brighter", describe the entire scene but add "with increased brightness and enhanced lighting"

Create a detailed image generation prompt that preserves the original image while applying ONLY the requested edit.
Return ONLY the generation prompt, no explanation. Be detailed to ensure accuracy.`;

      // Analyze image with Gemini (using same client instance)
      // const response = await this.client.models.generateContent({
      //   model: 'gemini-2.5-flash-image',
      //   contents: [
      //     {
      //       parts: [
      //         { text: analysisPrompt },
      //         {
      //           inlineData: {
      //             mimeType: mimeType,
      //             data: base64Image
      //           }
      //         }
      //       ]
      //     }
      //   ],
      //   config: {
      //     temperature: 0,  // Deterministic output for consistency
      //     maxOutputTokens: 1024,  // Allow detailed description for accuracy
      //   }
      // });

      const enhancedPrompt = analysisPrompt.trim();
      // logger.info('Gemini generated conservative edit prompt:', { 
      //   originalRequest: analysisPrompt,
      //   promptLength: enhancedPrompt.length,
      //   promptPreview: enhancedPrompt.substring(0, 150)
      // });

      // Now generate new image with enhanced prompt using Imagen 4
      // Try to use reference image if supported by the API
      try {
        logger.info('Attempting image-to-image editing with reference image');

        const response = await this.client.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [
            {
              parts: [
                { text: editPrompt },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Image,
                  },
                },
              ]
            }
          ],
          config: {
            temperature: 0,  // Deterministic output for consistencyFv
          },
        });

        // Extract image from response - Gemini returns generated images in content parts
        const contentParts = response.candidates[0]?.content?.parts || [];
        const imagePart = contentParts.find(part => part.inlineData);
        
        if (!imagePart || !imagePart.inlineData) {
          throw new Error('No generated image found in response');
        }

        // Process generated image
        const generatedBase64 = imagePart.inlineData.data;
        const imageBytes = Buffer.from(generatedBase64, 'base64');
        
        const result = {
          images: [{
            url: `data:image/png;base64,${generatedBase64}`,
            imageBytes: imageBytes,
            mimeType: imagePart.inlineData.mimeType || 'image/png',
          }],
          provider: 'gemini-2.5-flash-image',
          model: 'gemini-2.5-flash-image',
        };

        logger.info('Image-to-image editing with reference image successful');
        
        return {
          imageUrl: result.images[0].url,
          imageBuffer: imageBytes,
          mimeType: result.images[0].mimeType,
          provider: 'gemini-2.5-flash-image',
          model: 'gemini-2.5-flash-image',
          editPrompt: editPrompt,
        };
      } catch (referenceError) {
        logger.warn('Reference image not supported, falling back to text-to-image:', referenceError.message);
        
        // Fallback to text-only generation
        const result = await this.generateImage(enhancedPrompt, {
          aspectRatio,
          numberOfImages: 1,
        });
        
        logger.info('Conservative image editing completed (text-to-image fallback)');
        
        return {
          imageUrl: result.images[0].url,
          imageBuffer: result.images[0].imageBytes ? Buffer.from(result.images[0].imageBytes, 'base64') : null,
          mimeType: result.images[0].mimeType,
          provider: 'gemini-vision + imagen-4',
          model: 'gemini-2.0-flash + imagen-4.0-generate-001',
          editPrompt: enhancedPrompt,
        };
      }
    } catch (error) {
      logger.error('Image editing error:', error);
      throw new Error(`Failed to edit image: ${error.message}`);
    }
  }

  /**
   * Detect MIME type from image buffer
   */
  detectMimeType(buffer) {
    if (!buffer || buffer.length < 4) {
      return 'image/jpeg';
    }

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

    return 'image/jpeg';
  }


  /**
   * Upscale/enhance image quality
   */
  async upscaleImage(imageBuffer, options = {}) {
    try {
      // Use Gemini Vision + Imagen to recreate with higher quality
      return await this.editImage(
        imageBuffer,
        'Enhance image quality, sharpen details, improve clarity while maintaining exact composition',
        options
      );
    } catch (error) {
      logger.error('Image upscaling error:', error);
      throw error;
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

