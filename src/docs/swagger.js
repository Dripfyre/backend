const swaggerJsdoc = require('swagger-jsdoc');
const config = require('../config');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DripFyre API',
      version: '1.0.0',
      description: 'AI-powered content co-creator API for GenZ influencers and brands',
      contact: {
        name: 'DripFyre Team',
        email: 'support@dripfyre.com',
      },
    },
    servers: [
      {
        url: config.apiUrl,
        description: 'Development server',
      },
    ],
    tags: [
      {
        name: 'Session',
        description: 'Session management endpoints',
      },
      {
        name: 'Upload',
        description: 'Media upload endpoints',
      },
      {
        name: 'Action',
        description: 'Content processing endpoints',
      },
      {
        name: 'Social',
        description: 'Social media integration endpoints',
      },
      {
        name: 'Download',
        description: 'Content export endpoints',
      },
    ],
    components: {
      schemas: {
        Session: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              format: 'uuid',
              description: 'Unique session identifier',
            },
            status: {
              type: 'string',
              enum: ['active', 'processing', 'processed', 'expired'],
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            metadata: {
              type: 'object',
            },
          },
        },
        ProcessedContent: {
          type: 'object',
          properties: {
            caption: {
              type: 'string',
              description: 'Generated caption',
            },
            hashtags: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            processedMedia: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uri',
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            message: {
              type: 'string',
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad request',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;

