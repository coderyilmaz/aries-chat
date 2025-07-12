const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { cacheConversation, getCachedConversation } = require('../services/redisService');
const logger = require('../utils/logger');

const router = express.Router();

const conversationRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many conversation requests' }
});

const createConversationRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many conversation creation attempts' }
});

/**
 * @swagger
 * /api/conversation/list:
 *   get:
 *     tags: [Conversations]
 *     summary: Get user's conversations
 *     description: Retrieve a paginated list of conversations for the authenticated user with unread counts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/Limit'
 *     responses:
 *       200:
 *         description: Conversations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         conversations:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Conversation'
 *                         pagination:
 *                           $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 conversations:
 *                   - _id: "507f1f77bcf86cd799439012"
 *                     participants:
 *                       - _id: "507f1f77bcf86cd799439011"
 *                         username: "john_doe"
 *                         firstName: "John"
 *                         lastName: "Doe"
 *                         avatar: null
 *                     type: "private"
 *                     lastActivity: "2025-01-15T10:30:00.000Z"
 *                     unreadCount: 3
 *                 pagination:
 *                   page: 1
 *                   limit: 20
 *                   total: 5
 *                   pages: 1
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/list', auth, conversationRateLimit, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (page - 1) * limit;

        if (parseInt(limit) > 50) {
            return res.status(400).json({
                success: false,
                message: 'Limit cannot exceed 50'
            });
        }

        const conversations = await Conversation.find({
            participants: req.user._id,
            isActive: true
        })
            .populate('participants', 'username firstName lastName avatar lastSeen')
            .populate({
                path: 'lastMessage',
                populate: {
                    path: 'sender',
                    select: 'username firstName lastName'
                }
            })
            .sort({ lastActivity: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Conversation.countDocuments({
            participants: req.user._id,
            isActive: true
        });

        const conversationsWithUnread = await Promise.all(
            conversations.map(async (conv) => {
                const unreadCount = await Message.countDocuments({
                    conversation: conv._id,
                    sender: { $ne: req.user._id },
                    'readBy.user': { $ne: req.user._id },
                    isDeleted: false
                });

                let otherParticipant = null;
                if (conv.type === 'private' && conv.participants.length === 2) {
                    otherParticipant = conv.participants.find(
                        participant => participant._id.toString() !== req.user._id.toString()
                    );
                }
                return {
                    ...conv.toObject(),
                    unreadCount,
                    otherParticipant
                };
            })
        );

        res.json({
            success: true,
            data: {
                conversations: conversationsWithUnread,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get conversations error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/create:
 *   post:
 *     tags: [Conversations]
 *     summary: Create a new conversation
 *     description: Start a new private conversation with another user or create a group conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConversationCreate'
 *           examples:
 *             privateConversation:
 *               summary: Create private conversation
 *               value:
 *                 participantId: "507f1f77bcf86cd799439013"
 *                 type: "private"
 *             groupConversation:
 *               summary: Create group conversation
 *               value:
 *                 participantId: "507f1f77bcf86cd799439013"
 *                 type: "group"
 *                 name: "Project Team"
 *                 description: "Discussion about the new project"
 *     responses:
 *       200:
 *         description: Conversation created or existing conversation returned
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         conversation:
 *                           $ref: '#/components/schemas/Conversation'
 *             example:
 *               success: true
 *               data:
 *                 conversation:
 *                   _id: "507f1f77bcf86cd799439012"
 *                   participants:
 *                     - _id: "507f1f77bcf86cd799439011"
 *                       username: "john_doe"
 *                       firstName: "John"
 *                       lastName: "Doe"
 *                   type: "private"
 *                   lastActivity: "2025-01-15T10:30:00.000Z"
 *                   unreadCount: 0
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Participant not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Participant not found"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/create', auth, createConversationRateLimit, [
    body('participantId')
        .isMongoId()
        .withMessage('Invalid participant ID'),
    body('type')
        .optional()
        .isIn(['private', 'group'])
        .withMessage('Invalid conversation type')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { participantId, type = 'private' } = req.body;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const participant = await User.findById(participantId);
        if (!participant || !participant.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Participant not found'
            });
        }

        if (participantId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Cannot create conversation with yourself'
            });
        }

        let conversation = null;
        if (type === 'private') {
            conversation = await Conversation.findOne({
                participants: { $all: [req.user._id, participantId] },
                type: 'private',
                isActive: true
            }).populate('participants', 'username firstName lastName avatar lastSeen');
        }

        if (!conversation) {
            conversation = new Conversation({
                participants: [req.user._id, participantId],
                type,
                sessionId: sessionId
            });
            await conversation.save();
            await conversation.populate('participants', 'username firstName lastName avatar lastSeen');

            logger.info(`New conversation created: ${conversation._id} between ${req.user._id} and ${participantId}`);
        }

        const unreadCount = await Message.countDocuments({
            conversation: conversation._id,
            sender: { $ne: req.user._id },
            'readBy.user': { $ne: req.user._id },
            isDeleted: false
        });

        res.json({
            success: true,
            data: {
                conversation: {
                    ...conversation.toObject(),
                    unreadCount
                }
            }
        });

    } catch (error) {
        logger.error('Create conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}:
 *   get:
 *     tags: [Conversations]
 *     summary: Get conversation details
 *     description: Retrieve detailed information about a specific conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *     responses:
 *       200:
 *         description: Conversation details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         conversation:
 *                           allOf:
 *                             - $ref: '#/components/schemas/Conversation'
 *                             - type: object
 *                               properties:
 *                                 totalMessages:
 *                                   type: integer
 *                                   example: 150
 *             example:
 *               success: true
 *               data:
 *                 conversation:
 *                   _id: "507f1f77bcf86cd799439012"
 *                   participants:
 *                     - _id: "507f1f77bcf86cd799439011"
 *                       username: "john_doe"
 *                       firstName: "John"
 *                       lastName: "Doe"
 *                   type: "private"
 *                   lastActivity: "2025-01-15T10:30:00.000Z"
 *                   unreadCount: 3
 *                   totalMessages: 150
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        let conversation = await getCachedConversation(id);

        if (!conversation) {
            conversation = await Conversation.findOne({
                _id: id,
                participants: req.user._id,
                isActive: true
            }).populate('participants', 'username firstName lastName avatar lastSeen')
                .populate({
                    path: 'lastMessage',
                    populate: {
                        path: 'sender',
                        select: 'username firstName lastName'
                    }
                });

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
            }

            await cacheConversation(id, conversation);
        }

        const unreadCount = await Message.countDocuments({
            conversation: id,
            sender: { $ne: req.user._id },
            'readBy.user': { $ne: req.user._id },
            isDeleted: false
        });

        const totalMessages = await Message.countDocuments({
            conversation: id,
            isDeleted: false
        });

        res.json({
            success: true,
            data: {
                conversation: {
                    ...conversation,
                    unreadCount,
                    totalMessages
                }
            }
        });

    } catch (error) {
        logger.error('Get conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}:
 *   put:
 *     tags: [Conversations]
 *     summary: Update conversation details
 *     description: Update group conversation name, description, or avatar (only for group conversations)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConversationUpdate'
 *           example:
 *             name: "Updated Project Team"
 *             description: "Updated description for the project team"
 *             avatar: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
 *     responses:
 *       200:
 *         description: Conversation updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         conversation:
 *                           $ref: '#/components/schemas/Conversation'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/:id', auth, [
    body('name')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Name must be 1-100 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Description cannot exceed 500 characters'),
    body('avatar')
        .optional()
        .isString()
        .withMessage('Avatar must be a string')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const { name, description, avatar } = req.body;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: id,
            participants: req.user._id,
            isActive: true
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        if (conversation.type !== 'group') {
            return res.status(400).json({
                success: false,
                message: 'Cannot update private conversation'
            });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (avatar !== undefined) updateData.avatar = avatar;

        const updatedConversation = await Conversation.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('participants', 'username firstName lastName avatar lastSeen');

        res.json({
            success: true,
            message: 'Conversation updated successfully',
            data: { conversation: updatedConversation }
        });

    } catch (error) {
        logger.error('Update conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}/mark-read:
 *   put:
 *     tags: [Conversations]
 *     summary: Mark all messages as read
 *     description: Mark all unread messages in a conversation as read for the current user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *     responses:
 *       200:
 *         description: Messages marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         markedCount:
 *                           type: integer
 *                           example: 5
 *             example:
 *               success: true
 *               message: "All messages marked as read"
 *               data:
 *                 markedCount: 5
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/:id/mark-read', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: id,
            participants: req.user._id,
            isActive: true
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        const result = await Message.updateMany(
            {
                conversation: id,
                sender: { $ne: req.user._id },
                'readBy.user': { $ne: req.user._id },
                isDeleted: false
            },
            {
                $push: {
                    readBy: {
                        user: req.user._id,
                        readAt: new Date(),
                        sessionId: sessionId
                    }
                },
                $set: {
                    'metadata.deliveryStatus': 'read'
                }
            }
        );

        res.json({
            success: true,
            message: 'All messages marked as read',
            data: {
                markedCount: result.modifiedCount
            }
        });

    } catch (error) {
        logger.error('Mark conversation as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}/stats:
 *   get:
 *     tags: [Conversations]
 *     summary: Get conversation statistics
 *     description: Retrieve statistics about a conversation including message counts and activity dates
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *     responses:
 *       200:
 *         description: Conversation statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         stats:
 *                           type: object
 *                           properties:
 *                             totalMessages:
 *                               type: integer
 *                               example: 150
 *                             textMessages:
 *                               type: integer
 *                               example: 120
 *                             fileMessages:
 *                               type: integer
 *                               example: 30
 *                             firstMessage:
 *                               type: string
 *                               format: date-time
 *                               example: "2025-01-01T00:00:00.000Z"
 *                             lastMessage:
 *                               type: string
 *                               format: date-time
 *                               example: "2025-01-15T10:30:00.000Z"
 *                         unreadCount:
 *                           type: integer
 *                           example: 3
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id/stats', auth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: id,
            participants: req.user._id,
            isActive: true
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        const stats = await Message.aggregate([
            {
                $match: {
                    conversation: new mongoose.Types.ObjectId(id),
                    isDeleted: false
                }
            },
            {
                $group: {
                    _id: null,
                    totalMessages: { $sum: 1 },
                    messagesByType: {
                        $push: '$type'
                    },
                    firstMessage: { $min: '$createdAt' },
                    lastMessage: { $max: '$createdAt' }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalMessages: 1,
                    firstMessage: 1,
                    lastMessage: 1,
                    textMessages: {
                        $size: {
                            $filter: {
                                input: '$messagesByType',
                                cond: { $eq: ['$$this', 'text'] }
                            }
                        }
                    },
                    fileMessages: {
                        $size: {
                            $filter: {
                                input: '$messagesByType',
                                cond: { $in: ['$$this', ['file', 'image']] }
                            }
                        }
                    }
                }
            }
        ]);

        const unreadCount = await Message.countDocuments({
            conversation: id,
            sender: { $ne: req.user._id },
            'readBy.user': { $ne: req.user._id },
            isDeleted: false
        });

        res.json({
            success: true,
            data: {
                stats: stats[0] || {
                    totalMessages: 0,
                    textMessages: 0,
                    fileMessages: 0,
                    firstMessage: null,
                    lastMessage: null
                },
                unreadCount
            }
        });

    } catch (error) {
        logger.error('Get conversation stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}:
 *   delete:
 *     tags: [Conversations]
 *     summary: Delete conversation
 *     description: Delete a conversation (private) or leave a group conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *     responses:
 *       200:
 *         description: Conversation deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Conversation deleted successfully"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: id,
            participants: req.user._id,
            isActive: true
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        if (conversation.type === 'private') {
            conversation.isActive = false;
            await conversation.save();

            await Message.updateMany(
                {
                    conversation: id,
                    $or: [
                        { sender: req.user._id },
                        { 'readBy.user': req.user._id }
                    ]
                },
                {
                    $set: { isDeleted: true, editedAt: new Date() }
                }
            );

            logger.info(`Private conversation ${id} deleted by user ${req.user._id}`);
        } else {
            conversation.participants = conversation.participants.filter(
                participant => participant.toString() !== req.user._id.toString()
            );

            if (conversation.participants.length === 0) {
                conversation.isActive = false;
            }

            await conversation.save();

            logger.info(`User ${req.user._id} left group conversation ${id}`);
        }

        if (global.io) {
            global.io.to(`conversation_${id}`).emit('conversation_deleted', {
                conversationId: id,
                deletedBy: req.user._id,
                type: conversation.type
            });
        }

        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });

    } catch (error) {
        logger.error('Delete conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}/participants:
 *   post:
 *     tags: [Conversations]
 *     summary: Add participant to group conversation
 *     description: Add a new participant to an existing group conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participantId]
 *             properties:
 *               participantId:
 *                 type: string
 *                 pattern: '^[0-9a-fA-F]{24}$'
 *                 example: "507f1f77bcf86cd799439013"
 *           example:
 *             participantId: "507f1f77bcf86cd799439013"
 *     responses:
 *       200:
 *         description: Participant added successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         conversation:
 *                           $ref: '#/components/schemas/Conversation'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:id/participants', auth, [
    body('participantId')
        .isMongoId()
        .withMessage('Invalid participant ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const { participantId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: id,
            participants: req.user._id,
            type: 'group',
            isActive: true
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Group conversation not found'
            });
        }

        const participant = await User.findById(participantId);
        if (!participant || !participant.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Participant not found'
            });
        }

        if (conversation.participants.includes(participantId)) {
            return res.status(400).json({
                success: false,
                message: 'User is already a participant'
            });
        }

        conversation.participants.push(participantId);
        await conversation.save();
        await conversation.populate('participants', 'username firstName lastName avatar lastSeen');

        res.json({
            success: true,
            message: 'Participant added successfully',
            data: { conversation }
        });

    } catch (error) {
        logger.error('Add participant error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/conversation/{id}/participants/{participantId}:
 *   delete:
 *     tags: [Conversations]
 *     summary: Remove participant from group conversation
 *     description: Remove a participant from an existing group conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/ConversationId'
 *       - name: participantId
 *         in: path
 *         required: true
 *         description: ID of the participant to remove
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}$'
 *     responses:
 *       200:
 *         description: Participant removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         conversation:
 *                           $ref: '#/components/schemas/Conversation'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id/participants/:participantId', auth, async (req, res) => {
    try {
        const { id, participantId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(participantId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation or participant ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: id,
            participants: req.user._id,
            type: 'group',
            isActive: true
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Group conversation not found'
            });
        }

        if (!conversation.participants.includes(participantId)) {
            return res.status(400).json({
                success: false,
                message: 'User is not a participant in this conversation'
            });
        }

        conversation.participants = conversation.participants.filter(
            p => p.toString() !== participantId
        );

        if (conversation.participants.length === 0) {
            conversation.isActive = false;
        }

        await conversation.save();
        await conversation.populate('participants', 'username firstName lastName avatar lastSeen');

        res.json({
            success: true,
            message: 'Participant removed successfully',
            data: { conversation }
        });

    } catch (error) {
        logger.error('Remove participant error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;