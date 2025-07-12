const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'AriesChat API',
            version: '1.0.0',
            description: 'Real-time messaging application API with authentication, file sharing, and conversation management',
            contact: {
                name: 'AriesChat Support',
                email: 'support@arieschat.com'
            }
        },
        servers: [
            {
                url: process.env.NODE_ENV === 'production'
                    ? 'https://localhost:3000'
                    : 'http://localhost:3000',
                description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token obtained from login endpoint'
                }
            },
            headers: {
                'X-Session-ID': {
                    description: 'Session identifier for tracking user sessions',
                    schema: {
                        type: 'string',
                        format: 'uuid'
                    },
                    required: true
                }
            },
            parameters: {
                SessionId: {
                    name: 'X-Session-ID',
                    in: 'header',
                    required: true,
                    description: 'Session identifier',
                    schema: {
                        type: 'string',
                        format: 'uuid'
                    }
                },
                ConversationId: {
                    name: 'conversationId',
                    in: 'path',
                    required: true,
                    description: 'Conversation unique identifier',
                    schema: {
                        type: 'string',
                        pattern: '^[0-9a-fA-F]{24}$'
                    }
                },
                MessageId: {
                    name: 'messageId',
                    in: 'path',
                    required: true,
                    description: 'Message unique identifier',
                    schema: {
                        type: 'string',
                        pattern: '^[0-9a-fA-F]{24}$'
                    }
                },
                UserId: {
                    name: 'userId',
                    in: 'path',
                    required: true,
                    description: 'User unique identifier',
                    schema: {
                        type: 'string',
                        pattern: '^[0-9a-fA-F]{24}$'
                    }
                },
                Page: {
                    name: 'page',
                    in: 'query',
                    description: 'Page number for pagination',
                    schema: {
                        type: 'integer',
                        minimum: 1,
                        default: 1
                    }
                },
                Limit: {
                    name: 'limit',
                    in: 'query',
                    description: 'Number of items per page',
                    schema: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 50,
                        default: 20
                    }
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    required: ['_id', 'username', 'email', 'firstName', 'lastName'],
                    properties: {
                        _id: {
                            type: 'string',
                            description: 'User unique identifier',
                            example: '507f1f77bcf86cd799439011'
                        },
                        username: {
                            type: 'string',
                            description: 'Unique username',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-zA-Z0-9_]+$',
                            example: 'john_doe123'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address',
                            example: 'john.doe@example.com'
                        },
                        firstName: {
                            type: 'string',
                            description: 'User first name',
                            maxLength: 50,
                            example: 'John'
                        },
                        lastName: {
                            type: 'string',
                            description: 'User last name',
                            maxLength: 50,
                            example: 'Doe'
                        },
                        avatar: {
                            type: 'string',
                            description: 'User avatar - base64 data URL or HTTP URL',
                            example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
                        },
                        isActive: {
                            type: 'boolean',
                            description: 'User account status',
                            example: true
                        },
                        lastSeen: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Last seen timestamp',
                            example: '2025-01-15T10:30:00.000Z'
                        },
                        isOnline: {
                            type: 'boolean',
                            description: 'Current online status',
                            example: true
                        },
                        unreadCount: {
                            type: 'integer',
                            description: 'Number of unread messages from this user',
                            example: 5
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-01T00:00:00.000Z'
                        },
                        updatedAt: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-15T10:30:00.000Z'
                        }
                    }
                },
                UserRegistration: {
                    type: 'object',
                    required: ['username', 'email', 'password', 'firstName', 'lastName'],
                    properties: {
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-zA-Z0-9_]+$',
                            example: 'john_doe123'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            example: 'john.doe@example.com'
                        },
                        password: {
                            type: 'string',
                            minLength: 6,
                            example: 'securePassword123'
                        },
                        firstName: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 50,
                            example: 'John'
                        },
                        lastName: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 50,
                            example: 'Doe'
                        }
                    }
                },
                UserLogin: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: {
                            type: 'string',
                            format: 'email',
                            example: 'john.doe@example.com'
                        },
                        password: {
                            type: 'string',
                            minLength: 1,
                            example: 'securePassword123'
                        }
                    }
                },
                UserUpdate: {
                    type: 'object',
                    properties: {
                        firstName: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 50,
                            example: 'John'
                        },
                        lastName: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 50,
                            example: 'Doe'
                        },
                        username: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 30,
                            pattern: '^[a-zA-Z0-9_]+$',
                            example: 'john_doe_updated'
                        },
                        avatar: {
                            type: 'string',
                            description: 'Base64 image data or null to remove',
                            example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
                        }
                    }
                },
                Message: {
                    type: 'object',
                    required: ['_id', 'sender', 'conversation', 'content', 'type'],
                    properties: {
                        _id: {
                            type: 'string',
                            description: 'Message unique identifier',
                            example: '507f1f77bcf86cd799439011'
                        },
                        sender: {
                            $ref: '#/components/schemas/User'
                        },
                        conversation: {
                            type: 'string',
                            description: 'Conversation ID',
                            example: '507f1f77bcf86cd799439012'
                        },
                        content: {
                            type: 'string',
                            maxLength: 2000,
                            description: 'Message content',
                            example: 'Hello, how are you?'
                        },
                        type: {
                            type: 'string',
                            enum: ['text', 'image', 'file', 'video', 'audio', 'system'],
                            description: 'Message type',
                            example: 'text'
                        },
                        messageId: {
                            type: 'string',
                            description: 'Unique message identifier for real-time operations',
                            format: 'uuid',
                            example: '123e4567-e89b-12d3-a456-426614174000'
                        },
                        sessionId: {
                            type: 'string',
                            description: 'Session identifier',
                            example: '123e4567-e89b-12d3-a456-426614174000'
                        },
                        fileData: {
                            type: 'object',
                            description: 'File data for media messages',
                            properties: {
                                name: {
                                    type: 'string',
                                    example: 'document.pdf'
                                },
                                type: {
                                    type: 'string',
                                    example: 'application/pdf'
                                },
                                size: {
                                    type: 'integer',
                                    example: 1024000
                                },
                                data: {
                                    type: 'string',
                                    description: 'Base64 encoded file data',
                                    example: 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDssOk...'
                                },
                                url: {
                                    type: 'string',
                                    example: '/api/message/file/507f1f77bcf86cd799439011'
                                },
                                thumbnail: {
                                    type: 'string',
                                    description: 'Thumbnail for images/videos',
                                    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
                                },
                                duration: {
                                    type: 'number',
                                    description: 'Duration for audio/video files in seconds',
                                    example: 120.5
                                }
                            }
                        },
                        readBy: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    user: {
                                        type: 'string',
                                        example: '507f1f77bcf86cd799439013'
                                    },
                                    readAt: {
                                        type: 'string',
                                        format: 'date-time',
                                        example: '2025-01-15T10:30:00.000Z'
                                    },
                                    sessionId: {
                                        type: 'string',
                                        example: '123e4567-e89b-12d3-a456-426614174000'
                                    }
                                }
                            }
                        },
                        metadata: {
                            type: 'object',
                            properties: {
                                encrypted: {
                                    type: 'boolean',
                                    example: false
                                },
                                deliveryStatus: {
                                    type: 'string',
                                    enum: ['sent', 'delivered', 'read', 'failed'],
                                    example: 'delivered'
                                },
                                sentAt: {
                                    type: 'string',
                                    format: 'date-time',
                                    example: '2025-01-15T10:30:00.000Z'
                                },
                                deliveredAt: {
                                    type: 'string',
                                    format: 'date-time',
                                    example: '2025-01-15T10:30:05.000Z'
                                },
                                readAt: {
                                    type: 'string',
                                    format: 'date-time',
                                    example: '2025-01-15T10:31:00.000Z'
                                }
                            }
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-15T10:30:00.000Z'
                        },
                        updatedAt: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-15T10:30:00.000Z'
                        }
                    }
                },
                MessageSend: {
                    type: 'object',
                    required: ['conversationId', 'content'],
                    properties: {
                        conversationId: {
                            type: 'string',
                            description: 'Target conversation ID',
                            example: '507f1f77bcf86cd799439012'
                        },
                        content: {
                            type: 'string',
                            maxLength: 2000,
                            description: 'Message content',
                            example: 'Hello, how are you?'
                        },
                        type: {
                            type: 'string',
                            enum: ['text', 'image', 'file', 'video', 'audio'],
                            default: 'text',
                            example: 'text'
                        },
                        fileData: {
                            type: 'object',
                            description: 'File data for media messages',
                            properties: {
                                name: {
                                    type: 'string',
                                    example: 'document.pdf'
                                },
                                type: {
                                    type: 'string',
                                    example: 'application/pdf'
                                },
                                size: {
                                    type: 'integer',
                                    example: 1024000
                                },
                                data: {
                                    type: 'string',
                                    description: 'Base64 encoded file data',
                                    example: 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDssOk...'
                                }
                            }
                        }
                    }
                },
                Conversation: {
                    type: 'object',
                    required: ['_id', 'participants', 'type'],
                    properties: {
                        _id: {
                            type: 'string',
                            description: 'Conversation unique identifier',
                            example: '507f1f77bcf86cd799439012'
                        },
                        participants: {
                            type: 'array',
                            items: {
                                $ref: '#/components/schemas/User'
                            },
                            description: 'Conversation participants'
                        },
                        type: {
                            type: 'string',
                            enum: ['private', 'group'],
                            description: 'Conversation type',
                            example: 'private'
                        },
                        name: {
                            type: 'string',
                            description: 'Group conversation name (only for groups)',
                            example: 'Project Team'
                        },
                        description: {
                            type: 'string',
                            description: 'Group conversation description',
                            example: 'Discussion about the new project'
                        },
                        avatar: {
                            type: 'string',
                            description: 'Group conversation avatar',
                            example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
                        },
                        lastMessage: {
                            $ref: '#/components/schemas/Message'
                        },
                        lastActivity: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-15T10:30:00.000Z'
                        },
                        isActive: {
                            type: 'boolean',
                            example: true
                        },
                        unreadCount: {
                            type: 'integer',
                            description: 'Number of unread messages in conversation',
                            example: 3
                        },
                        totalMessages: {
                            type: 'integer',
                            description: 'Total number of messages in conversation',
                            example: 150
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-01T00:00:00.000Z'
                        },
                        updatedAt: {
                            type: 'string',
                            format: 'date-time',
                            example: '2025-01-15T10:30:00.000Z'
                        }
                    }
                },
                ConversationCreate: {
                    type: 'object',
                    required: ['participantId'],
                    properties: {
                        participantId: {
                            type: 'string',
                            description: 'ID of the user to start conversation with',
                            example: '507f1f77bcf86cd799439013'
                        },
                        type: {
                            type: 'string',
                            enum: ['private', 'group'],
                            default: 'private',
                            example: 'private'
                        },
                        name: {
                            type: 'string',
                            description: 'Group name (required for group type)',
                            example: 'Project Team'
                        },
                        description: {
                            type: 'string',
                            description: 'Group description',
                            example: 'Discussion about the new project'
                        }
                    }
                },
                ConversationUpdate: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 100,
                            example: 'Updated Project Team'
                        },
                        description: {
                            type: 'string',
                            maxLength: 500,
                            example: 'Updated description for the project team'
                        },
                        avatar: {
                            type: 'string',
                            description: 'Base64 image data for group avatar',
                            example: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
                        }
                    }
                },
                AuthTokens: {
                    type: 'object',
                    properties: {
                        accessToken: {
                            type: 'string',
                            description: 'JWT access token (expires in 1 hour)',
                            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                        },
                        refreshToken: {
                            type: 'string',
                            description: 'JWT refresh token (expires in 7 days)',
                            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                        }
                    }
                },
                RefreshToken: {
                    type: 'object',
                    required: ['refreshToken'],
                    properties: {
                        refreshToken: {
                            type: 'string',
                            description: 'Valid refresh token',
                            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                        }
                    }
                },
                ApiResponse: {
                    type: 'object',
                    required: ['success'],
                    properties: {
                        success: {
                            type: 'boolean',
                            description: 'Request success status',
                            example: true
                        },
                        message: {
                            type: 'string',
                            description: 'Response message',
                            example: 'Operation completed successfully'
                        },
                        data: {
                            type: 'object',
                            description: 'Response data'
                        },
                        errors: {
                            type: 'array',
                            description: 'Validation errors',
                            items: {
                                type: 'object',
                                properties: {
                                    msg: {
                                        type: 'string',
                                        example: 'Email is required'
                                    },
                                    param: {
                                        type: 'string',
                                        example: 'email'
                                    },
                                    value: {
                                        type: 'string',
                                        example: ''
                                    }
                                }
                            }
                        }
                    }
                },
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: false
                        },
                        message: {
                            type: 'string',
                            example: 'An error occurred'
                        },
                        errors: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    msg: {
                                        type: 'string',
                                        example: 'Validation error message'
                                    },
                                    param: {
                                        type: 'string',
                                        example: 'fieldName'
                                    }
                                }
                            }
                        }
                    }
                },
                Pagination: {
                    type: 'object',
                    properties: {
                        page: {
                            type: 'integer',
                            description: 'Current page number',
                            example: 1
                        },
                        limit: {
                            type: 'integer',
                            description: 'Items per page',
                            example: 20
                        },
                        total: {
                            type: 'integer',
                            description: 'Total items count',
                            example: 100
                        },
                        pages: {
                            type: 'integer',
                            description: 'Total pages count',
                            example: 5
                        }
                    }
                },
                FileUpload: {
                    type: 'object',
                    properties: {
                        file: {
                            type: 'string',
                            format: 'binary',
                            description: 'File to upload'
                        }
                    }
                },
                MessageReadRequest: {
                    type: 'object',
                    required: ['messageIds'],
                    properties: {
                        messageIds: {
                            type: 'array',
                            items: {
                                type: 'string',
                                pattern: '^[0-9a-fA-F]{24}$'
                            },
                            minItems: 1,
                            example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012']
                        }
                    }
                },
                OnlineUsersResponse: {
                    type: 'object',
                    properties: {
                        count: {
                            type: 'integer',
                            example: 15
                        },
                        users: {
                            type: 'array',
                            items: {
                                type: 'string'
                            },
                            example: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012']
                        }
                    }
                }
            },
            responses: {
                Success: {
                    description: 'Successful operation',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ApiResponse'
                            }
                        }
                    }
                },
                ValidationError: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                message: 'Validation failed',
                                errors: [
                                    {
                                        msg: 'Email is required',
                                        param: 'email',
                                        value: ''
                                    }
                                ]
                            }
                        }
                    }
                },
                Unauthorized: {
                    description: 'Authentication required',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                message: 'Access denied. No token provided.'
                            }
                        }
                    }
                },
                Forbidden: {
                    description: 'Access forbidden',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                message: 'Access denied'
                            }
                        }
                    }
                },
                NotFound: {
                    description: 'Resource not found',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                message: 'Resource not found'
                            }
                        }
                    }
                },
                TooManyRequests: {
                    description: 'Rate limit exceeded',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                message: 'Too many requests, please try again later'
                            }
                        }
                    }
                },
                ServerError: {
                    description: 'Internal server error',
                    content: {
                        'application/json': {
                            schema: {
                                $ref: '#/components/schemas/ErrorResponse'
                            },
                            example: {
                                success: false,
                                message: 'Internal server error'
                            }
                        }
                    }
                }
            }
        }
    },
    apis: ['./routes/*.js', './models/*.js']
};

const specs = swaggerJsdoc(options);

const setupSwagger = (app) => {
    const customCSS = `
        .swagger-ui .topbar { display: none }
        .swagger-ui .scheme-container { background: #fafafa; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .swagger-ui .auth-wrapper { padding: 15px; }
        .swagger-ui .auth-container { border: 1px solid #d3d3d3; border-radius: 4px; }
        .swagger-ui .operation.post .opblock-summary { border-left: 4px solid #49cc90; }
        .swagger-ui .operation.get .opblock-summary { border-left: 4px solid #61affe; }
        .swagger-ui .operation.put .opblock-summary { border-left: 4px solid #fca130; }
        .swagger-ui .operation.delete .opblock-summary { border-left: 4px solid #f93e3e; }
    `;

    const swaggerOptions = {
        explorer: true,
        customCss: customCSS,
        customSiteTitle: 'AriesChat API Documentation',
        customfavIcon: '/favicon.ico',
        swaggerOptions: {
            persistAuthorization: true,
            displayOperationId: true,
            displayRequestDuration: true,
            docExpansion: 'none',
            filter: true,
            showExtensions: true,
            showCommonExtensions: true,
            syntaxHighlight: {
                activate: true,
                theme: 'nord'
            },
            tryItOutEnabled: true,
            requestSnippetsEnabled: true,
            requestSnippets: {
                generators: {
                    'curl_bash': {
                        title: 'cURL (bash)',
                        syntax: 'bash'
                    },
                    'curl_powershell': {
                        title: 'cURL (PowerShell)',
                        syntax: 'powershell'
                    },
                    'javascript_fetch': {
                        title: 'JavaScript (fetch)',
                        syntax: 'javascript'
                    },
                    'javascript_axios': {
                        title: 'JavaScript (axios)',
                        syntax: 'javascript'
                    }
                },
                defaultExpanded: false,
                languages: ['curl_bash', 'curl_powershell', 'javascript_fetch', 'javascript_axios']
            }
        }
    };

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, swaggerOptions));

    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(specs);
    });

    console.log(`
🚀 Swagger Documentation Ready!
📖 Documentation: http://localhost:${process.env.PORT || 3000}/api-docs
📄 JSON Spec: http://localhost:${process.env.PORT || 3000}/api-docs.json

🔐 Quick Setup:
1. Test register/login endpoints first
2. Copy the accessToken from login response
3. Click 'Authorize' button and paste: Bearer <token>
4. All authenticated endpoints will now work automatically
    `);
};

module.exports = { setupSwagger, specs };