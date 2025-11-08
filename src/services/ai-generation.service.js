const imagenService = require('./imagen.service');
const config = require('../config');
const logger = require('../utils/logger');

class AIGenerationService {
  constructor() {
    // Use Google Imagen 3 (NanoBanana) for image generation
    this.imagenService = imagenService;
  }


  /**
   * Generate image using Google Imagen 3 (NanoBanana)
   */
  async generateImage(prompt, options = {}) {
    const { aspectRatio = '1:1', style = 'default', numberOfImages = 1 } = options;

    try {
      if (!this.imagenService.isConfigured()) {
        throw new Error('Google API key not configured. Please add GOOGLE_API_KEY to .env');
      }

      return await this.imagenService.generateImageWithRetry(prompt, {
        aspectRatio,
        style,
        numberOfImages,
      });
    } catch (error) {
      logger.error('Image generation error:', error);
      throw error;
    }
  }

  /**
   * Generate multiple variations
   */
  async generateVariations(prompt, count = 3, options = {}) {
    try {
      return await this.imagenService.generateVariations(prompt, count, options);
    } catch (error) {
      logger.error('Image variations error:', error);
      throw error;
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured() {
    return this.imagenService.isConfigured();
  }
}

module.exports = new AIGenerationService();

