const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class SocialMediaService {
  /**
   * Publish to Instagram
   */
  async publishToInstagram(accessToken, content) {
    try {
      const { mediaUrl, caption, hashtags } = content;

      // Format caption with hashtags
      const fullCaption = `${caption}\n\n${hashtags.join(' ')}`;

      // Step 1: Create media container
      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/me/media`,
        {
          image_url: mediaUrl,
          caption: fullCaption,
          access_token: accessToken,
        }
      );

      const containerId = containerResponse.data.id;

      // Step 2: Publish media container
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/me/media_publish`,
        {
          creation_id: containerId,
          access_token: accessToken,
        }
      );

      logger.info('Published to Instagram successfully');

      return {
        success: true,
        platform: 'instagram',
        postId: publishResponse.data.id,
        url: `https://www.instagram.com/p/${publishResponse.data.id}`,
      };
    } catch (error) {
      logger.error('Instagram publish error:', error.response?.data || error);
      throw new Error('Failed to publish to Instagram');
    }
  }

  /**
   * Publish Instagram Reel
   */
  async publishInstagramReel(accessToken, content) {
    try {
      const { videoUrl, caption, hashtags, coverUrl } = content;

      const fullCaption = `${caption}\n\n${hashtags.join(' ')}`;

      // Create reel container
      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/me/media`,
        {
          media_type: 'REELS',
          video_url: videoUrl,
          caption: fullCaption,
          cover_url: coverUrl,
          share_to_feed: true,
          access_token: accessToken,
        }
      );

      const containerId = containerResponse.data.id;

      // Publish reel
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/me/media_publish`,
        {
          creation_id: containerId,
          access_token: accessToken,
        }
      );

      logger.info('Published reel to Instagram successfully');

      return {
        success: true,
        platform: 'instagram',
        type: 'reel',
        postId: publishResponse.data.id,
      };
    } catch (error) {
      logger.error('Instagram reel publish error:', error.response?.data || error);
      throw new Error('Failed to publish reel to Instagram');
    }
  }

  /**
   * Publish to Facebook
   */
  async publishToFacebook(accessToken, pageId, content) {
    try {
      const { mediaUrl, caption, hashtags } = content;

      const fullCaption = `${caption}\n\n${hashtags.join(' ')}`;

      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/photos`,
        {
          url: mediaUrl,
          caption: fullCaption,
          access_token: accessToken,
        }
      );

      logger.info('Published to Facebook successfully');

      return {
        success: true,
        platform: 'facebook',
        postId: response.data.id,
        url: `https://www.facebook.com/${response.data.id}`,
      };
    } catch (error) {
      logger.error('Facebook publish error:', error.response?.data || error);
      throw new Error('Failed to publish to Facebook');
    }
  }

  /**
   * Upload video to YouTube
   */
  async publishToYouTube(accessToken, content) {
    try {
      const { videoUrl, title, description, hashtags, categoryId = '22' } = content;

      // Combine description with hashtags
      const fullDescription = `${description}\n\n${hashtags.join(' ')}`;

      // YouTube API requires multipart upload for videos
      // This is a simplified version - in production, use google-api-nodejs-client
      const response = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos',
        {
          snippet: {
            title,
            description: fullDescription,
            categoryId,
          },
          status: {
            privacyStatus: 'public',
          },
        },
        {
          params: {
            part: 'snippet,status',
            access_token: accessToken,
          },
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Published to YouTube successfully');

      return {
        success: true,
        platform: 'youtube',
        videoId: response.data.id,
        url: `https://www.youtube.com/watch?v=${response.data.id}`,
      };
    } catch (error) {
      logger.error('YouTube publish error:', error.response?.data || error);
      throw new Error('Failed to publish to YouTube');
    }
  }

  /**
   * Get Instagram user profile
   */
  async getInstagramProfile(accessToken) {
    try {
      const response = await axios.get(
        'https://graph.facebook.com/v18.0/me',
        {
          params: {
            fields: 'id,username,account_type,media_count',
            access_token: accessToken,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Get Instagram profile error:', error);
      throw error;
    }
  }

  /**
   * Get Facebook pages
   */
  async getFacebookPages(accessToken) {
    try {
      const response = await axios.get(
        'https://graph.facebook.com/v18.0/me/accounts',
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      return response.data.data;
    } catch (error) {
      logger.error('Get Facebook pages error:', error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token (Instagram)
   */
  async getInstagramAccessToken(code) {
    try {
      const response = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        {
          client_id: config.instagram.clientId,
          client_secret: config.instagram.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: config.instagram.redirectUri,
          code,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Get Instagram access token error:', error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token (Facebook)
   */
  async getFacebookAccessToken(code) {
    try {
      const response = await axios.get(
        'https://graph.facebook.com/v18.0/oauth/access_token',
        {
          params: {
            client_id: config.facebook.appId,
            client_secret: config.facebook.appSecret,
            redirect_uri: config.facebook.redirectUri,
            code,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Get Facebook access token error:', error);
      throw error;
    }
  }
}

module.exports = new SocialMediaService();

