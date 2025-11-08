const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const config = require('../config');
const logger = require('../utils/logger');

class CaptionGeneratorAgent {
  constructor() {
    this.llm = new ChatGoogleGenerativeAI({
      apiKey: config.gemini.apiKey,
      modelName: 'gemini-2.5-flash',
      temperature: 0.9, // Higher temperature for creative captions
    });
  }

  /**
   * Generate caption based on intent and context
   * Now supports conversation history for refinement and image analysis
   */
  async generateCaption(intent, mediaContext = {}, conversationHistory = []) {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(intent, mediaContext);

      this.logPromptPreview('system', systemPrompt);
      this.logPromptPreview('user', userPrompt);

      const messages = [
        new SystemMessage(systemPrompt),
      ];

      // Add conversation history if it exists (for refinement)
      if (conversationHistory.length > 0) {
        logger.info(`Using conversation history with ${conversationHistory.length} messages`);
        messages.push(...conversationHistory);
      }

      // Build current message with image if available
      if (mediaContext.imageBuffer && mediaContext.imageMimeType) {
        logger.info('Including image for visual analysis in caption generation');
        
        // Convert buffer to base64 for Gemini vision
        const base64Image = mediaContext.imageBuffer.toString('base64');
        const imageMimeType = mediaContext.imageMimeType || 'image/jpeg';
        
        messages.push(
          new HumanMessage({
            content: [
              {
                type: 'text',
                text: userPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMimeType};base64,${base64Image}`,
                },
              },
            ],
          })
        );
      } else {
        // No image, just text
        messages.push(new HumanMessage(userPrompt));
      }

      const response = await this.llm.invoke(messages);
      let caption = response.content.trim();
      
      // Clean up any remaining meta-text
      caption = this.cleanCaption(caption);

      logger.info('Caption generated successfully');
      
      return {
        caption,
        variations: [], // No variations needed
      };
    } catch (error) {
      logger.error('Caption generation error:', error);
      throw error;
    }
  }

  logPromptPreview(type, prompt) {
    if (!prompt) return;

    const preview = prompt.length > 600 ? `${prompt.slice(0, 600)}...` : prompt;
    logger.info('Caption agent prompt', { type, preview });
  }

  /**
   * Build system prompt for caption generation
   */
  buildSystemPrompt() {
    return `You are an expert social media content creator specializing in creating engaging, viral captions for GenZ influencers and brands.

CRITICAL RULES:
1. Return ONLY the caption text - NO explanations, NO meta-commentary, NO headers
2. Do NOT include phrases like "Here's a caption..." or "Here's what I suggest..."
3. Do NOT include section labels like "Main Hook:", "Optional:", "Hashtags:" etc.
4. The response should be READY TO COPY-PASTE directly to social media
5. Start directly with the caption content

Your captions should be:
- Authentic and relatable to GenZ audience
- Emotionally engaging with appropriate emojis (2-4 emojis naturally placed)
- Include a strong hook in the first line
- 2-3 sentences maximum
- Match the intended mood and style
- Use trending phrases and GenZ slang naturally

REFINEMENT CONTEXT:
- If there's conversation history, you're REFINING your previous work, not starting from scratch
- Apply the user's feedback directly to your previous caption
- Examples: "make it shorter" → reduce length; "add more emojis" → add emojis; "change the tone" → adjust tone
- Keep what works, change only what the user asks for

Format: Write the caption as if you're posting it yourself. No explanations. Just the caption.`;
  }

  /**
   * Build user prompt with intent and context
   */
  buildUserPrompt(intent, mediaContext) {
    const {
      rawTranscript,
      action,
      style,
      theme,
      mood,
      platform,
    } = intent;

    let prompt = `User request: "${rawTranscript}"\n\n`;
    prompt += `Context:\n`;

    if (action) prompt += `- Type: ${action}\n`;
    if (theme) prompt += `- Theme: ${theme}\n`;
    if (mood) prompt += `- Mood: ${mood}\n`;
    if (style) prompt += `- Style: ${style}\n`;
    if (platform) prompt += `- Platform: ${platform}\n`;

    if (mediaContext.hasImage) {
      if (mediaContext.imageBuffer) {
        prompt += `- Media: Image (provided for visual analysis - analyze the image to create a relevant, engaging caption)\n`;
      } else {
        prompt += `- Media: Image\n`;
      }
    }
    if (mediaContext.hasVideo) {
      prompt += `- Media: Video\n`;
    }

    prompt += `\nAnalyze the image (if provided) and write a caption that perfectly matches both the visual content and the user's request. Start directly with the caption text - no explanations, no labels, just the ready-to-post caption:`;

    return prompt;
  }

  /**
   * Clean caption from AI meta-text and formatting
   */
  cleanCaption(caption) {
    // Remove common AI meta-phrases
    const metaPhrases = [
      /^Here'?s? (a |an )?.*?caption.*?:/i,
      /^Here'?s? what I (suggest|recommend).*?:/i,
      /^Caption.*?:/i,
      /^Main Hook.*?:/i,
      /^Optional.*?:/i,
      /^\*\*Main Hook.*?\*\*:/i,
      /^\*\*Optional.*?\*\*:/i,
      /^\*\*Hashtags.*?\*\*:/i,
      /^Hashtags.*?:/i,
    ];

    let cleaned = caption;
    
    // Remove meta-phrases
    for (const phrase of metaPhrases) {
      cleaned = cleaned.replace(phrase, '');
    }
    
    // Remove markdown bold
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
    
    // Remove section headers (anything with : at the end of a line)
    cleaned = cleaned.split('\n').filter(line => {
      const trimmed = line.trim();
      // Keep lines that don't end with : or are content lines
      return !(/^[A-Za-z\s]+:$/.test(trimmed));
    }).join('\n');
    
    // Clean up extra newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    
    return cleaned;
  }


  /**
   * Optimize caption for specific platform
   */
  async optimizeForPlatform(caption, platform) {
    const platformGuidelines = {
      instagram: 'Instagram: Use emojis, line breaks, and keep it visually appealing. First line is crucial.',
      facebook: 'Facebook: Can be longer, more conversational. Ask questions to drive engagement.',
      youtube: 'YouTube: Focus on watch time, tease the content, strong CTA for likes/subscribe.',
    };

    const guideline = platformGuidelines[platform] || platformGuidelines.instagram;

    try {
      const prompt = `Optimize this caption for ${platform}:\n\n"${caption}"\n\n${guideline}\n\nProvide the optimized caption.`;

      const response = await this.llm.invoke([new HumanMessage(prompt)]);
      return response.content;
    } catch (error) {
      logger.error('Platform optimization error:', error);
      return caption;
    }
  }

  /**
   * Add call-to-action to caption
   */
  async addCTA(caption, ctaType = 'engagement') {
    const ctaExamples = {
      engagement: ['What do you think? 💭', 'Tag someone who needs this! 👇', 'Comment your thoughts! ⬇️'],
      follow: ['Follow for more! 🔥', "Don't forget to follow! ✨", 'Hit that follow button! 💯'],
      link: ['Link in bio! 🔗', 'Check the link! 👆', 'Swipe up! ⬆️'],
      share: ['Share this with friends! 📤', 'Send this to someone! 💌', 'Repost if you agree! 🔄'],
    };

    const ctas = ctaExamples[ctaType] || ctaExamples.engagement;
    const randomCTA = ctas[Math.floor(Math.random() * ctas.length)];

    return `${caption}\n\n${randomCTA}`;
  }
}

module.exports = new CaptionGeneratorAgent();

