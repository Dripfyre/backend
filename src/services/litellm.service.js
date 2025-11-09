const config = require('../config');
const logger = require('../utils/logger');

/**
 * Fast LiteLLM Service for Quick Caption & Hashtag Generation
 * Used in upload flow for instant results
 */
class LiteLLMService {
  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.modelName = 'gemini-2.5-flash-image';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  /**
   * Generate caption and hashtags in one call (super fast)
   * Now analyzes the actual image!
   */
  async generateCaptionAndHashtags(intent = {}, imageData = null) {
    try {
      const prompt = `You are a GenZ social media expert. Generate content for Instagram.

Task: Analyze this image and create a caption and hashtags for the post.

Theme: ${intent.theme || 'lifestyle'}
Platform: ${intent.platform || 'Instagram'}
Style: Engaging, authentic GenZ voice

Output Format (STRICTLY follow this):
CAPTION: [Write a short, engaging caption here with 2-3 emojis. Keep it under 150 characters. Be authentic and relatable.]
HASHTAGS: [Write 5-7 hashtags separated by spaces, all starting with #]

Rules:
- Analyze the image carefully and describe what you see
- Caption should be conversational and authentic
- Use GenZ language naturally (no forced slang)
- Include 2-3 relevant emojis in caption
- Hashtags should be trending and relevant to the image content
- Keep it simple and direct

Generate now:`;

      let content;

      // Build request body
      const parts = [{ text: prompt }];
      
      // If image buffer is provided, use vision capabilities
      if (imageData?.buffer) {
        const base64Image = imageData.buffer.toString('base64');
        const mimeType = imageData.mimeType || this.detectMimeType(imageData.buffer);
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        });
      }

      // Make direct API call to Gemini
      const url = `${this.baseUrl}/${this.modelName}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: parts
          }],
          generationConfig: {
            temperature: 0.7,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      content = data.candidates[0]?.content?.parts[0]?.text || '';

      // Parse response
      const captionMatch = content.match(/CAPTION:\s*(.+?)(?=HASHTAGS:|$)/s);
      const hashtagsMatch = content.match(/HASHTAGS:\s*(.+?)$/s);

      let caption = captionMatch ? captionMatch[1].trim() : 'Living my best life! ✨';
      let hashtags = hashtagsMatch ? hashtagsMatch[1].trim() : '#lifestyle #vibes #aesthetic';

      // Clean up caption
      caption = this.cleanCaption(caption);
      
      // Clean up hashtags
      hashtags = this.cleanHashtags(hashtags);

      logger.info('Fast generation complete', {
        withImage: !!imageData?.buffer,
        captionLength: caption.length,
        hashtagCount: hashtags.split(' ').length,
      });

      return {
        caption,
        hashtags,
      };
    } catch (error) {
      logger.error('LiteLLM generation error:', error);
      
      // Fallback to default content
      return {
        caption: 'Living my best life! ✨ Every moment counts.',
        hashtags: '#lifestyle #motivation #vibes #aesthetic #foryou',
      };
    }
  }

  /**
   * Clean caption from AI artifacts
   */
  cleanCaption(caption) {
    // Remove quotes
    caption = caption.replace(/^["']|["']$/g, '');
    
    // Remove any markdown
    caption = caption.replace(/\*\*(.*?)\*\*/g, '$1');
    
    // Clean up extra spaces
    caption = caption.replace(/\s+/g, ' ').trim();
    
    return caption;
  }

  /**
   * Clean and validate hashtags
   */
  cleanHashtags(hashtags) {
    // Extract all hashtags
    const tags = hashtags.match(/#\w+/g) || [];
    
    // Clean and deduplicate
    const uniqueTags = [...new Set(tags)]
      .map(tag => tag.toLowerCase())
      .slice(0, 10); // Max 10
    
    // Ensure we have at least 5 hashtags
    const defaultTags = ['#lifestyle', '#vibes', '#aesthetic', '#trending', '#foryou'];
    while (uniqueTags.length < 5) {
      const nextDefault = defaultTags[uniqueTags.length];
      if (!uniqueTags.includes(nextDefault)) {
        uniqueTags.push(nextDefault);
      }
    }
    
    return uniqueTags.join(' ');
  }

  /**
   * Check if service is configured
   */
  isConfigured() {
    return !!config.gemini.apiKey;
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
}

module.exports = new LiteLLMService();