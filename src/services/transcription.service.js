const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

class TranscriptionService {
  constructor() {
    // Initialize Deepgram (primary)
    if (config.deepgram && config.deepgram.apiKey) {
      this.deepgram = createClient(config.deepgram.apiKey);
    }

    // Initialize OpenAI Whisper (fallback)
    if (config.openai && config.openai.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.openai.apiKey,
      });
    }
  }

  /**
   * Transcribe audio using Deepgram
   */
  async transcribeWithDeepgram(audioBuffer, options = {}) {
    try {
      const { result, error } = await this.deepgram.listen.prerecorded.transcribeFile(
        audioBuffer,
        {
          model: 'nova-2',
          smart_format: true,
          punctuate: true,
          diarize: false,
          ...options,
        }
      );

      if (error) {
        throw error;
      }

      const transcript = result.results.channels[0].alternatives[0].transcript;
      const confidence = result.results.channels[0].alternatives[0].confidence;

      logger.info('Deepgram transcription successful');
      
      return {
        transcript,
        confidence,
        provider: 'deepgram',
      };
    } catch (error) {
      logger.error('Deepgram transcription error:', error);
      throw error;
    }
  }

  /**
   * Transcribe audio using OpenAI Whisper
   */
  async transcribeWithWhisper(audioFile) {
    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'json',
      });

      logger.info('Whisper transcription successful');
      
      return {
        transcript: transcription.text,
        confidence: null, // Whisper doesn't provide confidence
        provider: 'whisper',
      };
    } catch (error) {
      logger.error('Whisper transcription error:', error);
      throw error;
    }
  }

  /**
   * Transcribe audio (auto-select provider)
   * Priority: Deepgram (primary) -> Whisper (fallback)
   */
  async transcribe(audioBuffer, options = {}) {
    const { useWhisper = false } = options;

    try {
      // Priority 1: Deepgram (primary)
      if (this.deepgram && !useWhisper) {
        try {
          logger.info('Attempting Deepgram transcription');
          return await this.transcribeWithDeepgram(audioBuffer);
        } catch (error) {
          logger.warn('Deepgram failed, trying Whisper fallback:', error.message);
        }
      }

      // Priority 2: OpenAI Whisper (fallback)
      if (this.openai) {
        logger.info('Attempting OpenAI Whisper transcription');
        return await this.transcribeWithWhisper(audioBuffer);
      }

      throw new Error('No transcription service available. Please configure DEEPGRAM_API_KEY or OPENAI_API_KEY');
    } catch (error) {
      logger.error('Transcription error:', error);
      throw error;
    }
  }

  /**
   * Detect script/language from transcript
   */
  detectLanguage(transcript) {
    // Detect script patterns
    const hindiPattern = /[\u0900-\u097F]/; // Devanagari
    const tamilPattern = /[\u0B80-\u0BFF]/; // Tamil
    const teluguPattern = /[\u0C00-\u0C7F]/; // Telugu
    const kannadaPattern = /[\u0C80-\u0CFF]/; // Kannada
    const malayalamPattern = /[\u0D00-\u0D7F]/; // Malayalam

    if (hindiPattern.test(transcript)) return 'hi-IN';
    if (tamilPattern.test(transcript)) return 'ta-IN';
    if (teluguPattern.test(transcript)) return 'te-IN';
    if (kannadaPattern.test(transcript)) return 'kn-IN';
    if (malayalamPattern.test(transcript)) return 'ml-IN';
    
    return 'en-IN'; // Default to Indian English
  }

  /**
   * Parse intent from transcript (supports English, Hindi, and Hinglish)
   */
  parseIntent(transcript) {
    const lowerTranscript = transcript.toLowerCase();

    // Extract keywords and intent
    const intent = {
      rawTranscript: transcript,
      action: null,
      style: null,
      theme: null,
      platform: null,
      mood: null,
      detectedLanguage: this.detectLanguage(transcript),
    };

    // Detect action (English + Hindi + Hinglish)
    const actionKeywords = {
      create_reel: ['reel', 'video', 'clip', 'रील', 'वीडियो', 'reels'],
      create_post: ['post', 'image', 'picture', 'photo', 'pic', 'पोस्ट', 'फोटो', 'तस्वीर', 'इमेज'],
      create_story: ['story', 'stories', 'स्टोरी'],
    };

    for (const [action, keywords] of Object.entries(actionKeywords)) {
      if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
        intent.action = action;
        break;
      }
    }

    // Detect style (English + Hindi + Hinglish)
    const styleKeywords = {
      aesthetic: ['aesthetic', 'aesthetics', 'pretty', 'beautiful', 'सुंदर', 'खूबसूरत', 'aesthetic'],
      minimal: ['minimal', 'minimalist', 'simple', 'clean', 'सादा', 'सरल', 'मिनिमल'],
      vibrant: ['vibrant', 'colorful', 'bright', 'bold', 'रंगीन', 'चमकदार', 'vibrant'],
    };

    for (const [style, keywords] of Object.entries(styleKeywords)) {
      if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
        intent.style = style;
        break;
      }
    }

    // Detect theme (multilingual support)
    const themeKeywords = {
      motivation: ['motivation', 'motivational', 'inspire', 'प्रेरणा', 'मोटिवेशन', 'प्रेरक'],
      fitness: ['fitness', 'gym', 'workout', 'exercise', 'फिटनेस', 'जिम', 'कसरत'],
      travel: ['travel', 'trip', 'vacation', 'tour', 'यात्रा', 'घूमना', 'सफर', 'ट्रैवल'],
      food: ['food', 'recipe', 'cooking', 'खाना', 'खाने', 'रेसिपी', 'फूड'],
      fashion: ['fashion', 'style', 'outfit', 'clothes', 'फैशन', 'कपड़े', 'स्टाइल'],
      lifestyle: ['lifestyle', 'daily', 'life', 'जीवनशैली', 'लाइफस्टाइल', 'जिंदगी'],
    };

    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
        intent.theme = theme;
        break;
      }
    }

    // Detect mood (multilingual)
    const moodKeywords = {
      happy: ['happy', 'joy', 'cheerful', 'excited', 'खुश', 'मस्त', 'खुशी', 'मजा'],
      calm: ['calm', 'peaceful', 'relaxing', 'chill', 'शांत', 'आराम'],
      energetic: ['energetic', 'energy', 'hype', 'pump', 'intense', 'जोश', 'एनर्जी', 'जोशीला'],
      inspiring: ['inspiring', 'motivational', 'uplifting', 'प्रेरक', 'प्रेरणादायक'],
    };

    for (const [mood, keywords] of Object.entries(moodKeywords)) {
      if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
        intent.mood = mood;
        break;
      }
    }

    // Detect platform
    const platformKeywords = {
      instagram: ['instagram', 'insta', 'ig', 'इंस्टाग्राम', 'इंस्टा'],
      facebook: ['facebook', 'fb', 'फेसबुक'],
      youtube: ['youtube', 'yt', 'यूट्यूब'],
    };

    for (const [platform, keywords] of Object.entries(platformKeywords)) {
      if (keywords.some(keyword => lowerTranscript.includes(keyword))) {
        intent.platform = platform;
        break;
      }
    }

    return intent;
  }
}

module.exports = new TranscriptionService();

