const redisService = require('../services/redis.service');
const sessionService = require('../services/session.service');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * POST API - Store post data
 * POST /:sessionId/post
 */
const createPost = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required',
      });
    }

    const timestamp = Date.now();
    
    // Create post object
    const post = {
      sessionId,
      name,
      timestamp,
      createdAt: new Date(timestamp).toISOString(),
    };

    // Store post data in Redis hash (for detailed retrieval)
    const postKey = `post:${sessionId}`;
    await redisService.set(postKey, post);

    // Add to timeline sorted set (score = timestamp for ordering)
    // Key: "timeline" | Score: timestamp | Member: sessionId
    await redisService.zadd('timeline', timestamp, sessionId);

    logger.info(`Post created for session ${sessionId} by ${name}`);

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: post,
    });
  } catch (error) {
    logger.error('Create post error:', error);
    next(error);
  }
};

/**
 * TIMELINE API - Get paginated timeline
 * GET /timeline?page=1&limit=10
 */
const getTimeline = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Calculate pagination
    const start = (page - 1) * limit;
    const stop = start + limit - 1;

    // Get total count
    const totalCount = await redisService.zcard('timeline');
    const totalPages = Math.ceil(totalCount / limit);

    // Get sessionIds from sorted set (newest first)
    const sessionIds = await redisService.zrevrange('timeline', start, stop);

    // Fetch post details and session data for each sessionId
    const posts = [];
    for (const sessionId of sessionIds) {
      const postKey = `post:${sessionId}`;
      const post = await redisService.get(postKey);
      
      if (post) {
        // Get session data to fetch images, caption, and hashtags
        const session = await sessionService.getSession(sessionId);
        
        if (session) {
          const processedContent = session.metadata.processedContent;
          const uploadedMedia = session.metadata.uploadedMedia;

          // Get image URLs - prefer processed images, fallback to uploaded
          const imageUrls = processedContent?.processedMedia || uploadedMedia.map(m => m.url);

          // Convert images to base64
          const imagesBase64 = [];
          for (const imageUrl of imageUrls) {
            try {
              const filePath = path.join(process.cwd(), imageUrl);
              if (fs.existsSync(filePath)) {
                const imageBuffer = fs.readFileSync(filePath);
                const base64 = imageBuffer.toString('base64');
                const mimeType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';

                imagesBase64.push({
                  url: imageUrl,
                  base64: `data:${mimeType};base64,${base64}`,
                  mimeType: mimeType,
                });
              }
            } catch (error) {
              logger.error(`Error converting image to base64: ${imageUrl}`, error);
            }
          }

          // Build complete post object with images, caption, and hashtags
          posts.push({
            sessionId: post.sessionId,
            name: post.name,
            timestamp: post.timestamp,
            createdAt: post.createdAt,
            images: imagesBase64,
            caption: processedContent?.caption || null,
            hashtags: processedContent?.hashtagsFormatted || '',
          });
        } else {
          // If session not found, return post without images/caption/hashtags
          posts.push({
            ...post,
            images: [],
            caption: null,
            hashtags: '',
          });
        }
      }
    }

    logger.info(`Timeline fetched: page ${page}, ${posts.length} posts`);

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          currentPage: page,
          totalPages,
          totalPosts: totalCount,
          postsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    logger.error('Get timeline error:', error);
    next(error);
  }
};

/**
 * GET SINGLE POST
 * GET /:sessionId/post
 */
const getPost = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    
    const postKey = `post:${sessionId}`;
    const post = await redisService.get(postKey);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found',
      });
    }

    // Get session data to fetch images, caption, and hashtags
    const session = await sessionService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    const processedContent = session.metadata.processedContent;
    const uploadedMedia = session.metadata.uploadedMedia;

    // Get image URLs - prefer processed images, fallback to uploaded
    const imageUrls = processedContent?.processedMedia || uploadedMedia.map(m => m.url);

    // Convert images to base64
    const imagesBase64 = [];
    for (const imageUrl of imageUrls) {
      try {
        const filePath = path.join(process.cwd(), imageUrl);
        if (fs.existsSync(filePath)) {
          const imageBuffer = fs.readFileSync(filePath);
          const base64 = imageBuffer.toString('base64');
          const mimeType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';

          imagesBase64.push({
            url: imageUrl,
            base64: `data:${mimeType};base64,${base64}`,
            mimeType: mimeType,
          });
        }
      } catch (error) {
        logger.error(`Error converting image to base64: ${imageUrl}`, error);
      }
    }

    // Build complete post object with images, caption, and hashtags
    const postData = {
      sessionId: post.sessionId,
      name: post.name,
      timestamp: post.timestamp,
      createdAt: post.createdAt,
      images: imagesBase64,
      caption: processedContent?.caption || null,
      hashtags: processedContent?.hashtagsFormatted || '',
    };

    res.json({
      success: true,
      data: postData,
    });
  } catch (error) {
    logger.error('Get post error:', error);
    next(error);
  }
};

/**
 * DELETE POST
 * DELETE /:sessionId/post
 */
const deletePost = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    
    // Remove from timeline sorted set
    await redisService.zrem('timeline', sessionId);
    
    // Remove post data
    const postKey = `post:${sessionId}`;
    await redisService.delete(postKey);

    logger.info(`Post deleted for session ${sessionId}`);

    res.json({
      success: true,
      message: 'Post deleted successfully',
    });
  } catch (error) {
    logger.error('Delete post error:', error);
    next(error);
  }
};

module.exports = {
  createPost,
  getTimeline,
  getPost,
  deletePost,
};

