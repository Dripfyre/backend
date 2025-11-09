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

      // Handle image editing (modify existing image)
      if (intent.needsImageEditing && intent.imagePrompt && imageData?.buffer) {
        logger.info('User wants to edit the existing image');
        const editedImage = await this.editImage(imageData.buffer, intent.imagePrompt);
        result.editedImage = editedImage;
        result.imageEdited = true;
      }

      // Generate caption and/or hashtags if needed
      if (intent.needsCaption || intent.needsHashtags || !intent.needsImageEditing) {
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
          model: 'gemini-2.5-flash',
          contents: [
            {
              parts: parts
            }
          ],
          config: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          }
        });

        const content = response.text || '';

        // Parse response based on intent
        if (intent.needsCaption || (!intent.needsCaption && !intent.needsHashtags && !intent.needsImageEditing)) {
          const captionMatch = content.match(/CAPTION:\s*(.+?)(?=HASHTAGS:|$)/s);
          if (captionMatch) {
            result.caption = this.cleanCaption(captionMatch[1].trim());
          }
        }
        
        if (intent.needsHashtags || (!intent.needsCaption && !intent.needsImageEditing)) {
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
  "needsImageEditing": true/false,
  "imagePrompt": "extracted prompt for image generation/editing if applicable",
  "reasoning": "brief explanation"
}

Rules:
- If user asks for "caption" or "description", set needsCaption to true
- If user asks for "hashtags" or "tags", set needsHashtags to true
- If user asks to create a new image, "edit image", "change the image", "update photo", "make it brighter", set needsImageEditing to true
- Extract the image description/edit request into imagePrompt field
- If unclear or general request, set caption and hashtags to true (default)
- Be intelligent about context:
  * "make it funnier" → likely caption
  * "Add trending tags" → hashtags
  * "make the image brighter" → needsImageEditing with imagePrompt
Respond with JSON only:`;

      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            parts: [{ text: intentPrompt }]
          }
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 2560,
          responseMimeType: 'application/json',
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
    
    // Detect image editing keywords
    const imageEditKeywords = ['edit image', 'change image', 'modify image', 'update image', 'brighter', 'darker', 'filter'];
    const needsImageEditing = imageEditKeywords.some(kw => lower.includes(kw));
    
    return {
      needsCaption: lower.includes('caption') || lower.includes('description'),
      needsHashtags: lower.includes('hashtag') || lower.includes('#') || lower.includes('tag'),
      needsImageEditing,
      imagePrompt: needsImageEditing ? transcript : '',
      reasoning: 'Fallback keyword matching',
      rawTranscript: transcript,
    };
  }

  /**
   * Build prompt for full content (caption + hashtags)
   */
  buildFullContentPrompt(transcript) {
    // Extract number of hashtags from transcript if specified
    const numberMatch = transcript.match(/(\d+)\s+hashtag/i);
    const requestedCount = numberMatch ? parseInt(numberMatch[1]) : null;
    
    let hashtagGuideline = '';
    if (requestedCount) {
      hashtagGuideline = `HASHTAGS: [EXACTLY ${requestedCount} trending, relevant hashtag${requestedCount > 1 ? 's' : ''} separated by spaces — all start with #]`;
    } else {
      hashtagGuideline = `HASHTAGS: [5-7 trending, relevant hashtags separated by spaces — all start with #]`;
    }
    
    return `
  You are a sharp, GenZ social media strategist who crafts viral Instagram content. 
  The user has shared an image and a voice/text request below. 
  Your task: analyze the image and request to produce a caption + hashtags that feel authentic, trendy, and emotionally aligned.
  
  USER REQUEST: "${transcript}"
  
  OUTPUT FORMAT (STRICT — do not add extra words, emojis, or explanations):
  CAPTION: [short, catchy caption with 2-3 well-placed emojis — under 150 characters, use a natural GenZ tone, avoid clichés]
  ${hashtagGuideline}
  
  GUIDELINES:
  - Think like a GenZ creator: honest, expressive, sometimes witty but never forced.
  - Relate caption to mood, vibe, or visual energy of the image.
  - If the user's request implies emotion (chill, bold, romantic, aesthetic, etc.), reflect that in tone.
  - Hashtags: match context and respect the requested number if specified (e.g. #vibes #aesthetic #chillmood).
  - NEVER include markdown, quotes, or any text outside the specified format.
  
  Generate now:
  `;
  }
  

  /**
   * Build prompt for caption only
   */
  buildCaptionPrompt(transcript) {
    return `
  You are a GenZ social media copywriter known for writing short, punchy, and relatable Instagram captions. 
  Analyze the image and follow the user's specific request.
  
  USER REQUEST: "${transcript}"
  
  OUTPUT FORMAT:
  CAPTION: [2–3 emojis included, under 150 characters, authentic tone]
  
  GUIDELINES:
  - Keep it conversational, playful, or emotionally real depending on vibe.
  - Avoid marketing or robotic language.
  - Match the caption style to what a 20-year-old creator would post.
  - Reflect the user’s intent precisely (funny, aesthetic, emotional, sarcastic, etc.).
  - Output only the CAPTION line.
  
  Generate now:
  `;
  }
  

  /**
   * Build prompt for hashtags only
   */
  buildHashtagPrompt(transcript) {
    
    return `
  You are a GenZ social media strategist specializing in creating trending Instagram hashtags.
  
  USER REQUEST: "${transcript}"
  
  TASK: Generate ONLY hashtags based on the user's request and the image analysis.
  
  OUTPUT FORMAT:
  HASHTAGS: [Relevant hashtags separated by spaces, all starting with # — no numbering, no line breaks]
  
  GUIDELINES:
  - Match hashtags to mood/tone (e.g., if it's travel: #wanderlust #sunsetvibes).
  - Keep them lowercase and natural — no random or unrelated tags.
  - DO NOT add any explanation or text other than the output format.
  
  Generate now:
  `;
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

    //   const parts = [{ text: prompt }];
      
    //   if (imageData?.buffer) {
    //     const base64Image = imageData.buffer.toString('base64');
    //     const mimeType = imageData.mimeType || this.detectMimeType(imageData.buffer);
    //     parts.push({
    //       inlineData: {
    //         mimeType: mimeType,
    //         data: base64Image
    //       }
    //     });
    //   }

      const response = await this.client.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: imageData.mimeType,
                  data: imageData.buffer.toString('base64'),
                },
              },
            ]
          }
        ],
        config: {
          temperature: 0.7,  // Deterministic output for consistency
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

