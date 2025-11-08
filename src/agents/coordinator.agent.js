const { StateGraph } = require('@langchain/langgraph');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const captionGeneratorAgent = require('./captionGenerator.agent');
const hashtagGeneratorAgent = require('./hashtagGenerator.agent');
const imageEditorAgent = require('./imageEditor.agent');
const config = require('../config');
const logger = require('../utils/logger');

class CoordinatorAgent {
  constructor() {
    this.llm = new ChatGoogleGenerativeAI({
      apiKey: config.gemini.apiKey,
      modelName: 'gemini-2.5-pro',
      temperature: 0.5,
    });
  }

  /**
   * Main orchestration method - coordinates all agents
   * Now supports conversation history for context-aware refinement
   */
  async orchestrate(intent, mediaFiles = [], conversationHistory = null) {
    try {
      logger.info('Starting content orchestration');

      const startTime = Date.now();

      // Create initial state
      const state = {
        intent,
        mediaFiles,
        caption: null,
        hashtags: null,
        processedMedia: [],
        status: 'processing',
        errors: [],
        conversationHistory, // Pass conversation history to state
      };

      // Execute agents in parallel where possible
      const results = await this.executeAgentsInParallel(state);

      const duration = Date.now() - startTime;
      logger.info(`Orchestration completed in ${duration}ms`);

      // Determine which agents were actually used
      const agentsUsed = [];
      if (results.caption) agentsUsed.push('caption');
      if (results.hashtags) agentsUsed.push('hashtag');
      if (results.processedMedia && results.processedMedia.length > 0) agentsUsed.push('imageEditor');

      return {
        ...results,
        metadata: {
          duration,
          agentsUsed,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Orchestration error:', error);
      throw error;
    }
  }

  /**
   * Determine which agents to call based on user's request
   */
  async determineRequiredAgents(intent, mediaContext = {}) {
    const heuristicSelection = this.determineRequiredAgentsWithHeuristics(intent);

    try {
      const llmSelection = await this.classifyAgentsWithLLM(intent, mediaContext);

      if (llmSelection) {
        logger.info('LLM agent selection successful', llmSelection);
        if (llmSelection.reasoning) {
          logger.info('LLM routing reasoning:', llmSelection.reasoning);
        }
        return llmSelection;
      }
    } catch (error) {
      logger.warn('LLM agent selection failed, falling back to heuristics', { error: error.message });
    }

    return heuristicSelection;
  }

  determineRequiredAgentsWithHeuristics(intent) {
    const transcript = (intent.rawTranscript || '').toLowerCase();
    
    const agents = {
      caption: false,
      hashtags: false,
      imageEditor: false,
    };

    // Check for caption-only requests
    const captionKeywords = ['caption', 'description', 'write caption', 'create caption'];
    const isCaptionOnly = captionKeywords.some(kw => transcript.includes(kw)) &&
                          !transcript.includes('hashtag') &&
                          !transcript.includes('tag') &&
                          !transcript.includes('#');

    // Check for hashtag-only requests
    const hashtagKeywords = ['hashtag', 'tags', '#', 'hash tag'];
    const isHashtagOnly = hashtagKeywords.some(kw => transcript.includes(kw)) &&
                         !transcript.includes('caption') &&
                         !transcript.includes('description');

    // Check for image editing requests
    const imageEditKeywords = ['edit', 'change', 'modify', 'update', 'make it', 'filter', 'aesthetic', 'brighten', 'enhance image'];
    const needsImageEdit = imageEditKeywords.some(kw => transcript.includes(kw)) &&
                          (transcript.includes('image') || transcript.includes('photo') || transcript.includes('picture'));

    // Determine which agents to call
    if (isCaptionOnly) {
      agents.caption = true;
      logger.info('User request: Caption only');
    } else if (isHashtagOnly) {
      agents.hashtags = true;
      logger.info('User request: Hashtags only');
    } else if (needsImageEdit) {
      agents.imageEditor = true;
      logger.info('User request: Image editing');
    } else {
      // Default: generate both caption and hashtags (full post)
      agents.caption = true;
      agents.hashtags = true;
      logger.info('User request: Full content (caption + hashtags)');
    }

    // Always process images if they exist and user wants editing
    if (intent.action === 'edit_image' || needsImageEdit) {
      agents.imageEditor = true;
    }

    return agents;
  }

  async classifyAgentsWithLLM(intent, mediaContext = {}) {
    const transcript = intent.rawTranscript || '';

    const systemPrompt = `You are an orchestration router for social content generation.
Decide which specialist agents should run based on the user request.

Available agents:
- caption: Craft or refine a caption.
- hashtags: Generate or refine hashtags.
- imageEditor: Apply edits to supplied media based on user instructions.

RULES:
- Always return STRICT JSON with keys caption, hashtags, imageEditor (boolean) and reasoning (string <= 150 chars).
- Choose true only when the agent's skills are clearly required.
- Prefer precision over recall; only enable relevant agents.
- imageEditor should be true when the user requests visual changes or when intent.action equals "edit_image".
`;

    const contextSummary = [
      `User request: "${transcript}"`,
      intent.action ? `Action: ${intent.action}` : null,
      intent.platform ? `Platform: ${intent.platform}` : null,
      intent.theme ? `Theme: ${intent.theme}` : null,
      intent.mood ? `Mood: ${intent.mood}` : null,
      intent.style ? `Style: ${intent.style}` : null,
      mediaContext.hasImage ? 'Media: image present' : null,
      mediaContext.hasVideo ? 'Media: video present' : null,
      mediaContext.mediaCount ? `Media count: ${mediaContext.mediaCount}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`${contextSummary}\n\nRespond with JSON now.`),
    ];

    logger.info('LLM routing prompt context', {
      summary: contextSummary,
    });

    const response = await this.llm.invoke(messages);

    const rawContent = Array.isArray(response.content)
      ? response.content.map(part => (typeof part === 'string' ? part : part?.text || '')).join(' ')
      : response.content;

    if (!rawContent || typeof rawContent !== 'string') {
      logger.warn('LLM agent selection returned empty content');
      return null;
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      logger.warn('LLM agent selection response not parseable', { rawContent });
      return null;
    }

    let parsed;

    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error) {
      logger.warn('Failed to parse LLM agent selection JSON', { error: error.message, payload: jsonMatch[0] });
      return null;
    }

    const parseBoolean = (value) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
        if (['false', 'no', 'n', '0'].includes(normalized)) return false;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      return false;
    };

    const agents = {
      caption: parseBoolean(parsed.caption),
      hashtags: parseBoolean(parsed.hashtags),
      imageEditor: parseBoolean(parsed.imageEditor),
    };

    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;

    return {
      ...agents,
      reasoning,
    };
  }

  /**
   * Execute agents in parallel for better performance
   * NOW: Intelligently calls only required agents with conversation history support
   */
  async executeAgentsInParallel(state) {
    try {
      // Prepare media context with actual image data for AI analysis
      const imageFiles = state.mediaFiles.filter(f => f.mimetype.startsWith('image/'));
      const videoFiles = state.mediaFiles.filter(f => f.mimetype.startsWith('video/'));
      
      const mediaContext = {
        hasImage: imageFiles.length > 0,
        hasVideo: videoFiles.length > 0,
        mediaCount: state.mediaFiles.length,
        // Include first image for visual analysis
        imageBuffer: imageFiles.length > 0 ? imageFiles[0].buffer : null,
        imageMimeType: imageFiles.length > 0 ? imageFiles[0].mimetype : null,
      };

      // Determine which agents to call
      const requiredAgents = await this.determineRequiredAgents(state.intent, mediaContext);

      logger.info('Required agents:', requiredAgents);

      // Extract conversation history for each agent
      const captionHistory = state.conversationHistory?.caption || [];
      const hashtagHistory = state.conversationHistory?.hashtags || [];

      // Build results object dynamically - only include what was generated
      // This prevents null values from overwriting existing session data
      const results = {
        status: 'completed',
      };

      // Step 1: Generate caption if needed
      let captionResult = null;
      if (requiredAgents.caption) {
        logger.info('Invoking caption agent with image reference');
        captionResult = await captionGeneratorAgent.generateCaption(
          state.intent,
          mediaContext, // Now includes actual image buffer
          captionHistory // Pass conversation history
        );
        results.caption = captionResult.caption;
        results.captionVariations = captionResult.variations;
      }

      // Step 2: Run hashtag generation and image processing in parallel (only if needed)
      const parallelTasks = [];

      if (requiredAgents.hashtags) {
        logger.info('Queueing hashtag agent with image reference');
        parallelTasks.push(
          hashtagGeneratorAgent.generateHashtags(
            state.intent,
            captionResult?.caption || '',
            mediaContext, // Now includes actual image buffer
            hashtagHistory // Pass conversation history
          ).then(hashtagResult => {
            results.hashtags = hashtagResult.hashtags;
            results.hashtagsCategorized = hashtagResult.categorized;
            results.hashtagsFormatted = hashtagResult.formatted;
          })
        );
      }

      if (requiredAgents.imageEditor && state.mediaFiles.length > 0) {
        logger.info('Queueing image editor agent');
        parallelTasks.push(
          this.processMediaFiles(state.mediaFiles, state.intent).then(processedMedia => {
            results.processedMedia = processedMedia;
          })
        );
      }

      // Wait for all parallel tasks
      if (parallelTasks.length > 0) {
        await Promise.all(parallelTasks);
      }

      return results;
    } catch (error) {
      logger.error('Parallel execution error:', error);
      throw error;
    }
  }

  /**
   * Process all media files
   */
  async processMediaFiles(mediaFiles, intent) {
    if (!mediaFiles || mediaFiles.length === 0) {
      return [];
    }

    try {
      const processedMedia = await Promise.all(
        mediaFiles
          .filter(file => file.mimetype.startsWith('image/'))
          .map(async (file) => {
            try {
              const result = await imageEditorAgent.processImage(
                file.buffer,
                intent
              );

              return {
                originalFileId: file.fileId,
                buffer: result.buffer,
                applied: result.applied,
              };
            } catch (error) {
              logger.error(`Error processing media ${file.fileId}:`, error);
              return null;
            }
          })
      );

      return processedMedia.filter(m => m !== null);
    } catch (error) {
      logger.error('Media processing error:', error);
      return [];
    }
  }

  /**
   * Create LangGraph workflow (advanced orchestration)
   */
  createWorkflow() {
    // Define the state structure
    const graphState = {
      intent: null,
      mediaFiles: [],
      caption: null,
      hashtags: null,
      processedMedia: [],
      status: 'pending',
    };

    // Create workflow graph
    const workflow = new StateGraph({
      channels: graphState,
    });

    // Add nodes (agents)
    workflow.addNode('analyze_intent', async (state) => {
      logger.info('Analyzing intent');
      return { ...state, status: 'analyzing' };
    });

    workflow.addNode('generate_caption', async (state) => {
      logger.info('Generating caption');
      const result = await captionGeneratorAgent.generateCaption(state.intent);
      return { ...state, caption: result.caption };
    });

    workflow.addNode('generate_hashtags', async (state) => {
      logger.info('Generating hashtags');
      const result = await hashtagGeneratorAgent.generateHashtags(
        state.intent,
        state.caption
      );
      return { ...state, hashtags: result.hashtags };
    });

    workflow.addNode('process_media', async (state) => {
      logger.info('Processing media');
      const processed = await this.processMediaFiles(state.mediaFiles, state.intent);
      return { ...state, processedMedia: processed };
    });

    // Define edges (execution flow)
    workflow.addEdge('analyze_intent', 'generate_caption');
    workflow.addEdge('generate_caption', 'generate_hashtags');
    workflow.addEdge('generate_caption', 'process_media');

    // Set entry point
    workflow.setEntryPoint('analyze_intent');

    return workflow;
  }

  /**
   * Validate content before publishing
   */
  async validateContent(content) {
    const validations = {
      hasCaption: !!content.caption,
      hasHashtags: content.hashtags && content.hashtags.length > 0,
      hasMedia: content.processedMedia && content.processedMedia.length > 0,
    };

    const isValid = Object.values(validations).every(v => v);

    return {
      isValid,
      validations,
      message: isValid ? 'Content is ready to publish' : 'Content is missing required elements',
    };
  }

  /**
   * Get content recommendations
   */
  async getRecommendations(intent, content) {
    try {
      const recommendations = [];

      // Caption recommendations
      if (content.caption && content.caption.length < 50) {
        recommendations.push({
          type: 'caption',
          message: 'Consider making your caption longer for better engagement',
        });
      }

      // Hashtag recommendations
      if (content.hashtags && content.hashtags.length < 10) {
        recommendations.push({
          type: 'hashtags',
          message: 'Add more hashtags to increase reach (recommended: 20-30)',
        });
      }

      // Media recommendations
      if (!content.processedMedia || content.processedMedia.length === 0) {
        recommendations.push({
          type: 'media',
          message: 'Add at least one image or video for better engagement',
        });
      }

      // Platform-specific recommendations
      if (intent.platform === 'instagram' && intent.action === 'create_reel') {
        recommendations.push({
          type: 'platform',
          message: 'For Instagram Reels, consider adding trending audio and effects',
        });
      }

      return recommendations;
    } catch (error) {
      logger.error('Recommendations error:', error);
      return [];
    }
  }

  /**
   * Edit existing image with AI-powered editing
   * This is for user-requested edits on uploaded images
   */
  async editImage(imageBuffer, editRequest, options = {}) {
    try {
      logger.info('Coordinator: Starting image edit', { 
        editRequest: editRequest.substring(0, 50),
        hasOptions: !!options 
      });

      // Use the image editor agent to apply AI-powered edits
      const result = await imageEditorAgent.editUploadedImage(
        imageBuffer,
        editRequest,
        options
      );

      logger.info('Coordinator: Image edit completed');

      return {
        buffer: result.buffer,
        editApplied: result.editApplied,
        method: result.method,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Coordinator: Image edit error:', error);
      throw error;
    }
  }
}

module.exports = new CoordinatorAgent();

