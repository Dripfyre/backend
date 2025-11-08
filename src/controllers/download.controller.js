const archiver = require('archiver');
const path = require('path');
const sessionService = require('../services/session.service');
const storageService = require('../services/storage.service');
const logger = require('../utils/logger');

/**
 * Download processed content
 */
const downloadContent = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { format = 'json' } = req.query;

    const session = await sessionService.getSession(sessionId);

    if (!session || !session.metadata.processedContent) {
      return res.status(400).json({
        success: false,
        message: 'No processed content found',
      });
    }

    const content = session.metadata.processedContent;

    if (format === 'zip') {
      // Create ZIP archive
      return await downloadAsZip(res, session, content);
    } else {
      // Return JSON
      res.json({
        success: true,
        data: {
          caption: content.caption,
          captionVariations: content.captionVariations,
          hashtags: content.hashtags,
          hashtagsFormatted: content.hashtagsFormatted,
          processedMedia: content.processedMedia,
          intent: content.intent,
          processedAt: content.processedAt,
        },
      });
    }
  } catch (error) {
    logger.error('Download content error:', error);
    next(error);
  }
};

/**
 * Download as ZIP archive
 */
const downloadAsZip = async (res, session, content) => {
  try {
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    res.attachment(`dripfyre-${session.sessionId}.zip`);
    archive.pipe(res);

    // Add caption file
    const captionText = `${content.caption}\n\n${content.hashtagsFormatted}`;
    archive.append(captionText, { name: 'caption.txt' });

    // Add caption variations
    if (content.captionVariations && content.captionVariations.length > 0) {
      const variationsText = content.captionVariations.join('\n\n---\n\n');
      archive.append(variationsText, { name: 'caption_variations.txt' });
    }

    // Add hashtags file
    const hashtagsText = content.hashtags.join('\n');
    archive.append(hashtagsText, { name: 'hashtags.txt' });

    // Add metadata JSON
    const metadata = {
      sessionId: session.sessionId,
      intent: content.intent,
      processedAt: content.processedAt,
      mediaCount: content.processedMedia.length,
    };
    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

    // Add media files (if any)
    // Note: In production, you'd fetch actual files from storage
    for (let i = 0; i < content.processedMedia.length; i++) {
      const mediaUrl = content.processedMedia[i];
      // Placeholder - in production, fetch from storage
      archive.append(`Media file: ${mediaUrl}`, { name: `media_${i + 1}.txt` });
    }

    await archive.finalize();

    logger.info(`Downloaded content for session ${session.sessionId}`);
  } catch (error) {
    logger.error('Download ZIP error:', error);
    throw error;
  }
};

/**
 * Export content for specific platform
 */
const exportForPlatform = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { platform } = req.query;

    const session = await sessionService.getSession(sessionId);

    if (!session || !session.metadata.processedContent) {
      return res.status(400).json({
        success: false,
        message: 'No processed content found',
      });
    }

    const content = session.metadata.processedContent;

    // Format content for specific platform
    const formatted = formatForPlatform(content, platform);

    res.json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    logger.error('Export for platform error:', error);
    next(error);
  }
};

/**
 * Format content for specific platform
 */
const formatForPlatform = (content, platform) => {
  const formatted = {
    caption: content.caption,
    media: content.processedMedia,
  };

  switch (platform) {
    case 'instagram':
      // Instagram: Full hashtags, optimized caption
      formatted.caption = content.caption;
      formatted.hashtags = content.hashtagsFormatted;
      formatted.characterCount = content.caption.length;
      formatted.recommendations = [
        'Post at peak engagement times (7-9 PM)',
        'Use all 30 hashtags for maximum reach',
        'Post consistently for better algorithm performance',
      ];
      break;

    case 'facebook':
      // Facebook: Fewer hashtags, longer caption
      formatted.caption = content.caption;
      formatted.hashtags = content.hashtags.slice(0, 10).join(' ');
      formatted.recommendations = [
        'Ask questions to boost engagement',
        'Use relevant hashtags sparingly (5-10)',
        'Include a call-to-action',
      ];
      break;

    case 'youtube':
      // YouTube: Title + description
      formatted.title = content.caption.substring(0, 100);
      formatted.description = content.caption;
      formatted.hashtags = content.hashtags.slice(0, 15).join(' ');
      formatted.tags = content.hashtags.map(h => h.replace('#', ''));
      formatted.recommendations = [
        'Create custom thumbnail for higher CTR',
        'Add timestamps in description',
        'Include relevant keywords in title',
      ];
      break;

    default:
      formatted.hashtags = content.hashtagsFormatted;
  }

  return formatted;
};

/**
 * Get shareable link
 */
const getShareableLink = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await sessionService.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    // Generate shareable link
    const shareableLink = `${require('../config').apiUrl}/share/${sessionId}`;

    res.json({
      success: true,
      data: {
        link: shareableLink,
        expiresIn: '24 hours',
      },
    });
  } catch (error) {
    logger.error('Get shareable link error:', error);
    next(error);
  }
};

module.exports = {
  downloadContent,
  exportForPlatform,
  getShareableLink,
};

