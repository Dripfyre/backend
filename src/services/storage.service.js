const fs = require('fs').promises;
const path = require('path');
const AWS = require('aws-sdk');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

class StorageService {
  constructor() {
    this.useLocal = config.storage.useLocal;
    
    if (!this.useLocal) {
      this.s3 = new AWS.S3({
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
        region: config.storage.s3.region,
      });
      this.bucket = config.storage.s3.bucket;
    } else {
      this.localPath = config.storage.localPath;
      this.ensureLocalDirectory();
    }
  }

  async ensureLocalDirectory() {
    try {
      await fs.mkdir(this.localPath, { recursive: true });
      await fs.mkdir(path.join(this.localPath, 'processed'), { recursive: true });
    } catch (error) {
      logger.error('Error creating local storage directories:', error);
    }
  }

  /**
   * Upload file
   */
  async uploadFile(file, folder = 'uploads') {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    const fileName = `${fileId}${ext}`;
    const filePath = `${folder}/${fileName}`;

    try {
      if (this.useLocal) {
        // Local storage
        const fullPath = path.join(this.localPath, folder);
        await fs.mkdir(fullPath, { recursive: true });
        await fs.writeFile(path.join(fullPath, fileName), file.buffer);
        
        return {
          fileId,
          fileName,
          filePath,
          url: `/uploads/${folder}/${fileName}`,
          size: file.size,
          mimeType: file.mimetype,
        };
      } else {
        // S3 storage
        const params = {
          Bucket: this.bucket,
          Key: filePath,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'public-read',
        };

        const result = await this.s3.upload(params).promise();
        
        return {
          fileId,
          fileName,
          filePath,
          url: result.Location,
          size: file.size,
          mimeType: file.mimetype,
        };
      }
    } catch (error) {
      logger.error('Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Delete file
   */
  async deleteFile(filePath) {
    try {
      if (this.useLocal) {
        // Handle URL format for local storage (e.g., /uploads/uploads/file.jpg or uploads/uploads/file.jpg)
        let normalizedPath = filePath;
        
        // Remove leading slash if present
        if (normalizedPath.startsWith('/')) {
          normalizedPath = normalizedPath.substring(1);
        }
        
        // Remove 'uploads/' prefix if present since localPath already includes it
        if (normalizedPath.startsWith('uploads/')) {
          normalizedPath = normalizedPath.substring('uploads/'.length);
        }
        
        const fullPath = path.join(this.localPath, normalizedPath);
        await fs.unlink(fullPath);
      } else {
        const params = {
          Bucket: this.bucket,
          Key: filePath,
        };
        await this.s3.deleteObject(params).promise();
      }
      
      logger.info(`File deleted: ${filePath}`);
      return true;
    } catch (error) {
      logger.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Get file
   */
  async getFile(filePath) {
    try {
      if (this.useLocal) {
        const fullPath = path.join(this.localPath, filePath);
        const buffer = await fs.readFile(fullPath);
        return buffer;
      } else {
        const params = {
          Bucket: this.bucket,
          Key: filePath,
        };
        const result = await this.s3.getObject(params).promise();
        return result.Body;
      }
    } catch (error) {
      logger.error('Error getting file:', error);
      throw error;
    }
  }

  /**
   * Process image (resize, optimize)
   */
  async processImage(file, options = {}) {
    try {
      const {
        width = null,
        height = null,
        quality = 90,
        format = 'jpeg',
      } = options;

      let sharpInstance = sharp(file.buffer);

      if (width || height) {
        sharpInstance = sharpInstance.resize(width, height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        });
      }

      const processedBuffer = await sharpInstance
        .toFormat(format, { quality })
        .toBuffer();

      const processedFile = {
        ...file,
        buffer: processedBuffer,
        originalname: `processed_${file.originalname}`,
        mimetype: `image/${format}`,
      };

      return await this.uploadFile(processedFile, 'processed');
    } catch (error) {
      logger.error('Error processing image:', error);
      throw error;
    }
  }
}

module.exports = new StorageService();

