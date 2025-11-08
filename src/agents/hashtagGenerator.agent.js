const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const config = require('../config');
const logger = require('../utils/logger');

class HashtagGeneratorAgent {
  constructor() {
    this.llm = new ChatGoogleGenerativeAI({
      apiKey: config.gemini.apiKey,
      modelName: 'gemini-2.5-flash',
      temperature: 0.7,
    });

    // Trending hashtags database (in production, fetch from API)
    this.trendingHashtags = {
      general: ['#viral', '#trending', '#fyp', '#foryou', '#explore'],
      motivation: ['#motivation', '#motivationalquotes', '#mindset', '#goals', '#success'],
      fitness: ['#fitness', '#gym', '#workout', '#fitfam', '#fitspo'],
      travel: ['#travel', '#wanderlust', '#travelphotography', '#travelgram', '#explore'],
      food: ['#foodie', '#foodporn', '#instafood', '#foodstagram', '#yummy'],
      fashion: ['#fashion', '#style', '#ootd', '#fashionista', '#styleinspo'],
      lifestyle: ['#lifestyle', '#lifestyleblogger', '#dailylife', '#instagood', '#photooftheday'],
    };
  }

  /**
   * Generate hashtags based on intent and content
   * Now supports conversation history for refinement and image analysis
   */
  async generateHashtags(intent, caption, mediaContext = {}, conversationHistory = []) {
    try {
      // Parse user's requested hashtag count from transcript
      const requestedCount = this.parseHashtagCount(intent.rawTranscript);
      const targetCount = requestedCount || 10; // Default to 10 if not specified
      
      logger.info(`Target hashtag count: ${targetCount} (user requested: ${requestedCount || 'not specified'})`);

      const aiHashtags = await this.generateAIHashtags(intent, caption, targetCount, conversationHistory, mediaContext);
      
      // If user wants very few hashtags, just use AI-generated ones
      if (targetCount <= 3) {
        const uniqueHashtags = [...new Set(aiHashtags)].slice(0, targetCount);
        logger.info(`Generated ${uniqueHashtags.length} hashtags (user requested ${targetCount})`);
        
        return {
          hashtags: uniqueHashtags,
          categorized: this.categorizeHashtags(uniqueHashtags),
          formatted: this.formatHashtags(uniqueHashtags),
        };
      }

      // For larger counts, mix AI-generated, trending, and niche
      const trendingHashtags = this.getTrendingHashtags(intent);
      const nicheHashtags = this.getNicheHashtags(intent);

      // Calculate distribution based on target count
      const aiCount = Math.ceil(targetCount * 0.5);
      const trendingCount = Math.ceil(targetCount * 0.3);
      const nicheCount = Math.ceil(targetCount * 0.2);

      const hashtags = [
        ...aiHashtags.slice(0, aiCount),
        ...trendingHashtags.slice(0, trendingCount),
        ...nicheHashtags.slice(0, nicheCount),
      ];

      // Remove duplicates and limit to target count
      const uniqueHashtags = [...new Set(hashtags)].slice(0, targetCount);

      logger.info(`Generated ${uniqueHashtags.length} hashtags (target: ${targetCount})`);

      return {
        hashtags: uniqueHashtags,
        categorized: this.categorizeHashtags(uniqueHashtags),
        formatted: this.formatHashtags(uniqueHashtags),
      };
    } catch (error) {
      logger.error('Hashtag generation error:', error);
      throw error;
    }
  }

  /**
   * Parse requested hashtag count from user transcript
   */
  parseHashtagCount(transcript) {
    if (!transcript) return null;

    const lowerTranscript = transcript.toLowerCase();

    // Check for specific number requests
    const patterns = [
      /(\d+)\s*hashtag/i,           // "5 hashtags", "1 hashtag"
      /only\s*(\d+)/i,              // "only 3", "only 1"
      /just\s*(\d+)/i,              // "just 5", "just 1"
      /exactly\s*(\d+)/i,           // "exactly 10"
      /(\d+)\s*tag/i,               // "3 tags", "1 tag"
    ];

    for (const pattern of patterns) {
      const match = lowerTranscript.match(pattern);
      if (match) {
        const count = parseInt(match[1]);
        if (count > 0 && count <= 30) { // Reasonable limit
          return count;
        }
      }
    }

    // Check for word numbers
    const wordNumbers = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    };

    for (const [word, num] of Object.entries(wordNumbers)) {
      if (lowerTranscript.includes(`${word} hashtag`) || 
          lowerTranscript.includes(`only ${word}`) ||
          lowerTranscript.includes(`just ${word}`)) {
        return num;
      }
    }

    return null;
  }

  /**
   * Generate hashtags using AI
   * Now supports conversation history for refinement and image analysis
   */
  async generateAIHashtags(intent, caption, targetCount = 7, conversationHistory = [], mediaContext = {}) {
    try {
      const systemPrompt = `You are a social media hashtag expert. Generate relevant, trending hashtags that will maximize reach and engagement for GenZ content.

Rules:
- Mix of popular (100k+ posts) and niche (10k-100k posts) hashtags
- Relevant to the content, theme, and visual elements in the image
- Include trending hashtags when appropriate
- All lowercase, no spaces
- Return ONLY hashtags, one per line, with # symbol
- Respect the user's requested number of hashtags
- When refining, keep the context of previous hashtags but apply the user's feedback
- If image is provided, analyze its visual content to generate highly relevant hashtags`;

      const userPrompt = `Generate exactly ${targetCount} optimized hashtags for this content:

Intent: ${intent.rawTranscript}
Theme: ${intent.theme || 'general'}
Mood: ${intent.mood || 'neutral'}
Style: ${intent.style || 'default'}
Caption: ${caption.substring(0, 100)}...
${mediaContext.imageBuffer ? 'Image: Provided for visual analysis - analyze the image content to generate highly relevant hashtags' : ''}

User specifically requested ${targetCount} hashtag${targetCount === 1 ? '' : 's'}.
Analyze the image (if provided) and provide ONLY ${targetCount} hashtags optimized for maximum reach and engagement based on the visual content.`;

      this.logPromptPreview('system', systemPrompt);
      this.logPromptPreview('user', userPrompt);

      const messages = [
        new SystemMessage(systemPrompt),
      ];

      // Add conversation history if it exists (for refinement)
      if (conversationHistory.length > 0) {
        logger.info(`Using conversation history with ${conversationHistory.length} messages for hashtag refinement`);
        messages.push(...conversationHistory);
      }

      // Build current message with image if available
      if (mediaContext.imageBuffer && mediaContext.imageMimeType) {
        logger.info('Including image for visual analysis in hashtag generation');
        
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
      const hashtags = response.content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('#'))
        .map(tag => tag.toLowerCase());

      return hashtags;
    } catch (error) {
      logger.error('AI hashtag generation error:', error);
      return [];
    }
  }

  logPromptPreview(type, prompt) {
    if (!prompt) return;

    const preview = prompt.length > 600 ? `${prompt.slice(0, 600)}...` : prompt;
    logger.info('Hashtag agent prompt', { type, preview });
  }

  /**
   * Get trending hashtags for theme
   */
  getTrendingHashtags(intent) {
    const theme = intent.theme || 'general';
    const themeHashtags = this.trendingHashtags[theme] || this.trendingHashtags.general;
    
    // Shuffle and return
    return themeHashtags.sort(() => Math.random() - 0.5);
  }

  /**
   * Get niche-specific hashtags
   */
  getNicheHashtags(intent) {
    const niche = [];

    if (intent.mood) {
      niche.push(`#${intent.mood}vibes`, `#${intent.mood}mood`);
    }

    if (intent.style) {
      niche.push(`#${intent.style}`, `#${intent.style}style`);
    }

    if (intent.action) {
      if (intent.action === 'create_reel') {
        niche.push('#reels', '#reelsinstagram', '#reelsindia', '#reelitfeelit');
      } else if (intent.action === 'create_story') {
        niche.push('#instastory', '#storytime', '#stories');
      }
    }

    // Add day-based hashtags
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const today = days[new Date().getDay()];
    niche.push(`#${today}`, `#${today}motivation`);

    return niche;
  }

  /**
   * Categorize hashtags by size
   */
  categorizeHashtags(hashtags) {
    // In production, fetch actual post counts from Instagram API
    // For now, use mock categorization
    return {
      mega: hashtags.slice(0, 5), // 1M+ posts
      large: hashtags.slice(5, 15), // 100k-1M posts
      medium: hashtags.slice(15, 25), // 10k-100k posts
      niche: hashtags.slice(25), // <10k posts
    };
  }

  /**
   * Format hashtags for different platforms
   */
  formatHashtags(hashtags, platform = 'instagram') {
    if (platform === 'instagram') {
      // Instagram: hashtags in caption or first comment
      return hashtags.join(' ');
    } else if (platform === 'youtube') {
      // YouTube: hashtags in description, limit to 15
      return hashtags.slice(0, 15).join(' ');
    } else if (platform === 'facebook') {
      // Facebook: fewer hashtags work better
      return hashtags.slice(0, 10).join(' ');
    }

    return hashtags.join(' ');
  }

  /**
   * Optimize hashtags for reach
   */
  optimizeForReach(hashtags) {
    // Mix strategy: 30% high competition, 50% medium, 20% low
    const categorized = this.categorizeHashtags(hashtags);
    
    return [
      ...categorized.mega.slice(0, 3),
      ...categorized.large.slice(0, 8),
      ...categorized.medium.slice(0, 10),
      ...categorized.niche.slice(0, 9),
    ];
  }

  /**
   * Generate branded hashtags
   */
  generateBrandedHashtags(brandName) {
    if (!brandName) return [];

    const clean = brandName.toLowerCase().replace(/\s+/g, '');
    return [
      `#${clean}`,
      `#${clean}style`,
      `#${clean}community`,
      `#teamb${clean}`,
    ];
  }
}

module.exports = new HashtagGeneratorAgent();

