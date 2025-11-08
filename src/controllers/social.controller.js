const socialMediaService = require('../services/social.service');
const sessionService = require('../services/session.service');
const logger = require('../utils/logger');

/**
 * Publish content to social media platform
 */
const publishContent = async (req, res, next) => {
  try {
    const { sessionId, platform } = req.params;
    const { accessToken, pageId, customCaption, customHashtags } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Access token is required',
      });
    }

    // Get session with processed content
    const session = await sessionService.getSession(sessionId);

    if (!session || !session.metadata.processedContent) {
      return res.status(400).json({
        success: false,
        message: 'No processed content found. Process content first.',
      });
    }

    const content = session.metadata.processedContent;

    // Use custom or processed content
    const publishData = {
      mediaUrl: content.processedMedia[0] || session.metadata.uploadedMedia[0]?.url,
      caption: customCaption || content.caption,
      hashtags: customHashtags || content.hashtags,
    };

    let result;

    switch (platform) {
      case 'instagram':
        result = await socialMediaService.publishToInstagram(accessToken, publishData);
        break;

      case 'facebook':
        if (!pageId) {
          return res.status(400).json({
            success: false,
            message: 'Page ID is required for Facebook publishing',
          });
        }
        result = await socialMediaService.publishToFacebook(accessToken, pageId, publishData);
        break;

      case 'youtube':
        publishData.title = customCaption || content.caption.substring(0, 100);
        publishData.description = content.caption;
        result = await socialMediaService.publishToYouTube(accessToken, publishData);
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Unsupported platform',
        });
    }

    logger.info(`Content published to ${platform} for session ${sessionId}`);

    res.json({
      success: true,
      message: `Successfully published to ${platform}`,
      data: result,
    });
  } catch (error) {
    logger.error('Publish content error:', error);
    next(error);
  }
};

/**
 * Instagram OAuth callback
 */
const instagramCallback = async (req, res, next) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code not provided',
      });
    }

    const tokenData = await socialMediaService.getInstagramAccessToken(code);

    // Get user profile
    const profile = await socialMediaService.getInstagramProfile(tokenData.access_token);

    res.json({
      success: true,
      message: 'Instagram connected successfully',
      data: {
        accessToken: tokenData.access_token,
        userId: tokenData.user_id,
        profile,
      },
    });
  } catch (error) {
    logger.error('Instagram callback error:', error);
    next(error);
  }
};

/**
 * Facebook OAuth callback
 */
const facebookCallback = async (req, res, next) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code not provided',
      });
    }

    const tokenData = await socialMediaService.getFacebookAccessToken(code);

    // Get user pages
    const pages = await socialMediaService.getFacebookPages(tokenData.access_token);

    res.json({
      success: true,
      message: 'Facebook connected successfully',
      data: {
        accessToken: tokenData.access_token,
        pages,
      },
    });
  } catch (error) {
    logger.error('Facebook callback error:', error);
    next(error);
  }
};

/**
 * Get Instagram authorization URL
 */
const getInstagramAuthUrl = (req, res) => {
  const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${
    require('../config').instagram.clientId
  }&redirect_uri=${
    require('../config').instagram.redirectUri
  }&scope=user_profile,user_media&response_type=code`;

  res.json({
    success: true,
    data: {
      authUrl,
    },
  });
};

/**
 * Get Facebook authorization URL
 */
const getFacebookAuthUrl = (req, res) => {
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${
    require('../config').facebook.appId
  }&redirect_uri=${
    require('../config').facebook.redirectUri
  }&scope=pages_manage_posts,pages_read_engagement&response_type=code`;

  res.json({
    success: true,
    data: {
      authUrl,
    },
  });
};

module.exports = {
  publishContent,
  instagramCallback,
  facebookCallback,
  getInstagramAuthUrl,
  getFacebookAuthUrl,
};

