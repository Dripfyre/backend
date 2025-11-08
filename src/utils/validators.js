const Joi = require('joi');

// Session ID validation
const sessionIdSchema = Joi.string().uuid().required();

// Upload validation
const uploadSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
});

// Voice intent validation
const voiceIntentSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  intent: Joi.string().optional(),
});

// Process content validation
const processContentSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  intent: Joi.string().required(),
  mediaIds: Joi.array().items(Joi.string()).optional(),
});

// Publish validation
const publishSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  platform: Joi.string().valid('instagram', 'facebook', 'youtube').required(),
  caption: Joi.string().optional(),
  hashtags: Joi.array().items(Joi.string()).optional(),
  mediaUrl: Joi.string().uri().optional(),
});

// Image generation validation
const imageGenerationSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  prompt: Joi.string().required(),
  style: Joi.string().valid('aesthetic', 'minimal', 'vibrant', 'default').default('default'),
  aspectRatio: Joi.string().valid('1:1', '9:16', '16:9', '4:5').default('4:5'),
});

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    req.validatedData = value;
    next();
  };
};

// Validate params
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    req.validatedParams = value;
    next();
  };
};

module.exports = {
  schemas: {
    sessionId: sessionIdSchema,
    upload: uploadSchema,
    voiceIntent: voiceIntentSchema,
    processContent: processContentSchema,
    publish: publishSchema,
    imageGeneration: imageGenerationSchema,
  },
  validate,
  validateParams,
};

