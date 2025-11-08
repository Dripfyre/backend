const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const logger = require('../utils/logger');
const imagenService = require('./imagen.service');

/**
 * Simplified AI Service using Google GenAI directly
 * Replaces the agent architecture with direct API calls
 */
class AIService {
  constructor() {
    this.client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }

  /**
   * Process voice command and generate content
   * Handles caption, hashtag, image generation, and image editing based on user intent
   */
  async processVoiceCommand(transcript, imageData = null) {
    try {
      logger.info('Processing voice command with AI');

      // Use LLM to determine what user wants
      const intent = await this.parseIntentWithLLM(transcript);
      logger.info('LLM parsed intent:', intent);
      
      const result = {};

      // Handle image generation (create new image)
      if (intent.needsImageGeneration && intent.imagePrompt) {
        logger.info('User wants to generate a new image');
        const generatedImage = await this.generateImage(intent.imagePrompt);
        result.generatedImage = generatedImage;
        result.imageGenerated = true;
        
        // Also generate caption and hashtags for the new image
        // Update imageData to use the generated image for caption/hashtag generation
        if (generatedImage.imageUrl) {
          // We'll generate caption/hashtags based on the prompt
          intent.needsCaption = true;
          intent.needsHashtags = true;
        }
      }

      // Handle image editing (modify existing image)
      if (intent.needsImageEditing && intent.imagePrompt && imageData?.buffer) {
        logger.info('User wants to edit the existing image');
        const editedImage = await this.editImage(imageData.buffer, intent.imagePrompt);
        result.editedImage = editedImage;
        result.imageEdited = true;
      }

      // Generate caption and/or hashtags if needed
      if (intent.needsCaption || intent.needsHashtags || (!intent.needsImageGeneration && !intent.needsImageEditing)) {
        // Build prompt based on intent
        let prompt = '';
        
        if (intent.needsCaption && intent.needsHashtags) {
          prompt = this.buildFullContentPrompt(transcript);
        } else if (intent.needsCaption) {
          prompt = this.buildCaptionPrompt(transcript);
        } else if (intent.needsHashtags) {
          prompt = this.buildHashtagPrompt(transcript);
        } else {
          // Default: generate both
          prompt = this.buildFullContentPrompt(transcript);
        }

        // Build request parts
        const parts = [{ text: prompt }];
        
        // Add image if available (use edited/generated image if exists, otherwise original)
        const imageToAnalyze = result.editedImage?.imageBuffer || imageData?.buffer;
        if (imageToAnalyze) {
          const base64Image = imageToAnalyze.toString('base64');
          const mimeType = result.editedImage?.mimeType || imageData?.mimeType || this.detectMimeType(imageToAnalyze);
          parts.push({
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          });
        }

        // Call Gemini API for caption/hashtags
        const response = await this.client.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: [
            {
              parts: parts
            }
          ],
          config: {
            temperature: 0,
            maxOutputTokens: 1024,
          }
        });

        const content = response.text || '';

        // Parse response based on intent
        if (intent.needsCaption || (!intent.needsCaption && !intent.needsHashtags && !intent.needsImageGeneration && !intent.needsImageEditing)) {
          const captionMatch = content.match(/CAPTION:\s*(.+?)(?=HASHTAGS:|$)/s);
          if (captionMatch) {
            result.caption = this.cleanCaption(captionMatch[1].trim());
          }
        }
        
        if (intent.needsHashtags || (!intent.needsCaption && !intent.needsHashtags && !intent.needsImageGeneration && !intent.needsImageEditing)) {
          const hashtagsMatch = content.match(/HASHTAGS:\s*(.+?)$/s);
          if (hashtagsMatch) {
            const hashtags = this.cleanHashtags(hashtagsMatch[1].trim());
            result.hashtags = hashtags.split(' ');
            result.hashtagsFormatted = hashtags;
          }
        }
      }

      logger.info('AI processing complete', {
        hasCaption: !!result.caption,
        hasHashtags: !!result.hashtags,
        imageGenerated: !!result.imageGenerated,
        imageEdited: !!result.imageEdited,
      });

      return result;
    } catch (error) {
      logger.error('AI processing error:', error);
      throw error;
    }
  }

  /**
   * Parse user intent using LLM for intelligent understanding
   */
  async parseIntentWithLLM(transcript) {
    try {
      const intentPrompt = `You are an AI assistant that analyzes user requests for social media content generation.

User request: "${transcript}"

Analyze what the user wants and respond with ONLY a JSON object (no markdown, no explanation):

{
  "needsCaption": true/false,
  "needsHashtags": true/false,
  "needsImageGeneration": true/false,
  "needsImageEditing": true/false,
  "imagePrompt": "extracted prompt for image generation/editing if applicable",
  "reasoning": "brief explanation"
}

Rules:
- If user asks for "caption" or "description", set needsCaption to true
- If user asks for "hashtags" or "tags", set needsHashtags to true
- If user asks to "generate", "create new image", "make a picture of", set needsImageGeneration to true
- If user asks to "edit image", "change the image", "update photo", "make it brighter", set needsImageEditing to true
- Extract the image description/edit request into imagePrompt field
- If unclear or general request, set caption and hashtags to true (default)
- Be intelligent about context:
  * "make it funnier" → likely caption
  * "Add trending tags" → hashtags
  * "generate an image of a sunset" → needsImageGeneration with imagePrompt
  * "make the image brighter" → needsImageEditing with imagePrompt

Respond with JSON only:`;

      const response = await this.client.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: [
          {
            parts: [{ text: intentPrompt }]
          }
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 256,
        }
      });

      const content = response.text || '';
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        return {
          needsCaption: parsed.needsCaption || false,
          needsHashtags: parsed.needsHashtags || false,
          needsImageGeneration: parsed.needsImageGeneration || false,
          needsImageEditing: parsed.needsImageEditing || false,
          imagePrompt: parsed.imagePrompt || '',
          reasoning: parsed.reasoning || '',
          rawTranscript: transcript,
        };
      }
      
      // Fallback if parsing fails
      logger.warn('Failed to parse LLM intent, using default');
      return {
        needsCaption: true,
        needsHashtags: true,
        needsImageGeneration: false,
        needsImageEditing: false,
        imagePrompt: '',
        reasoning: 'Fallback to default',
        rawTranscript: transcript,
      };
    } catch (error) {
      logger.error('LLM intent parsing error:', error);
      
      // Fallback to simple keyword matching
      return this.parseIntentSimple(transcript);
    }
  }

  /**
   * Simple keyword-based intent parsing (fallback)
   */
  parseIntentSimple(transcript) {
    const lower = transcript.toLowerCase();
    
    // Detect image generation keywords
    const imageGenKeywords = ['generate image', 'create image', 'new image', 'make a picture', 'generate a photo'];
    const needsImageGeneration = imageGenKeywords.some(kw => lower.includes(kw));
    
    // Detect image editing keywords
    const imageEditKeywords = ['edit image', 'change image', 'modify image', 'update image', 'brighter', 'darker', 'filter'];
    const needsImageEditing = imageEditKeywords.some(kw => lower.includes(kw));
    
    return {
      needsCaption: lower.includes('caption') || lower.includes('description'),
      needsHashtags: lower.includes('hashtag') || lower.includes('#') || lower.includes('tag'),
      needsImageGeneration,
      needsImageEditing,
      imagePrompt: needsImageGeneration || needsImageEditing ? transcript : '',
      reasoning: 'Fallback keyword matching',
      rawTranscript: transcript,
    };
  }

  /**
   * Build prompt for full content (caption + hashtags)
   */
  buildFullContentPrompt(transcript) {
    return `You are a GenZ social media expert. Analyze the image and user request to create engaging content.

User request: "${transcript}"

Task: Generate a caption and hashtags for this Instagram post.

Output Format (STRICTLY follow this):
CAPTION: [Write an engaging caption based on the user's request. Include 2-3 relevant emojis. Keep it authentic and conversational.]
HASHTAGS: [Write 5-7 relevant hashtags separated by spaces, all starting with #]

Rules:
- Analyze the image carefully
- Follow the user's specific request
- Use authentic GenZ voice (no forced slang)
- Keep caption under 150 characters
- Hashtags should be trending and relevant

Generate now:`;
  }

  /**
   * Build prompt for caption only
   */
  buildCaptionPrompt(transcript) {
    return `You are a GenZ social media expert creating Instagram captions.

User request: "${transcript}"

Task: Generate ONLY a caption based on the user's request.

Output Format:
CAPTION: [Write the caption here with 2-3 emojis]

Rules:
- Analyze the image carefully
- Follow the user's specific request exactly
- Authentic and conversational tone
- Keep under 150 characters

Generate now:`;
  }

  /**
   * Build prompt for hashtags only
   */
  buildHashtagPrompt(transcript) {
    return `You are a GenZ social media expert creating Instagram hashtags.

User request: "${transcript}"

Task: Generate ONLY hashtags based on the user's request.

Output Format:
HASHTAGS: [Write 5-7 hashtags separated by spaces, all starting with #]

Rules:
- Analyze the image carefully
- Follow the user's specific request exactly
- Hashtags should be trending and relevant
- Mix popular and niche tags

Generate now:`;
  }

  /**
   * Generate caption and hashtags for uploaded image (fast generation)
   */
  async generateInitialContent(imageData = null, theme = 'lifestyle') {
    try {
      const prompt = `You are a GenZ social media expert. Generate content for Instagram.

Task: Analyze this image and create a caption and hashtags for the post.

Theme: ${theme}
Platform: Instagram
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

      const parts = [{ text: prompt }];
      
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

      const response = await this.client.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: [
          {
            parts: parts
          }
        ],
        config: {
          temperature: 0.7,
          maxOutputTokens: 512,
        }
      });

      const content = response.text || '';

      const captionMatch = content.match(/CAPTION:\s*(.+?)(?=HASHTAGS:|$)/s);
      const hashtagsMatch = content.match(/HASHTAGS:\s*(.+?)$/s);

      let caption = captionMatch ? captionMatch[1].trim() : 'Living my best life! ✨';
      let hashtags = hashtagsMatch ? hashtagsMatch[1].trim() : '#lifestyle #vibes #aesthetic';

      caption = this.cleanCaption(caption);
      hashtags = this.cleanHashtags(hashtags);

      return {
        caption,
        hashtags,
      };
    } catch (error) {
      logger.error('Initial content generation error:', error);
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
    caption = caption.replace(/^["']|["']$/g, '');
    caption = caption.replace(/\*\*(.*?)\*\*/g, '$1');
    caption = caption.replace(/\s+/g, ' ').trim();
    return caption;
  }

  /**
   * Clean and validate hashtags
   */
  cleanHashtags(hashtags) {
    const tags = hashtags.match(/#\w+/g) || [];
    const uniqueTags = [...new Set(tags)]
      .map(tag => tag.toLowerCase())
      .slice(0, 10);
    
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
   * Generate new image using NanoBanana (Imagen 4)
   */
  async generateImage(prompt, options = {}) {
    try {
      logger.info('Generating new image with NanoBanana (Imagen 4)', { prompt: prompt.substring(0, 50) });
      
      const result = await imagenService.generateImage(prompt, {
        aspectRatio: options.aspectRatio || '4:5',
        numberOfImages: 1,
      });
      
      logger.info('Image generation successful');
      
      return {
        imageUrl: result.images[0].url,
        mimeType: result.images[0].mimeType,
        provider: result.provider,
        model: result.model,
      };
    } catch (error) {
      logger.error('Image generation error:', error);
      throw error;
    }
  }

  /**
   * Edit existing image using NanoBanana (Gemini Vision + Imagen 4)
   */
  async editImage(imageBuffer, editPrompt, options = {}) {
    try {
      logger.info('Editing image with NanoBanana (Gemini Vision + Imagen 4)', { prompt: editPrompt });
      
      const result = await imagenService.editImage(imageBuffer, editPrompt, {
      });
      
      logger.info('Image editing successful');
      
      return {
        imageUrl: result.imageUrl,
        imageBuffer: result.imageBuffer,
        mimeType: result.mimeType,
        provider: result.provider,
        model: result.model,
        editPrompt: result.editPrompt,
      };
    } catch (error) {
      logger.error('Image editing error:', error);
      throw error;
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
}

module.exports = new AIService();

