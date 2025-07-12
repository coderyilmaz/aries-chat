const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { auth } = require('../middleware/auth');
const { fixBase64Format, extractBase64Data } = require('../utils/base64Helper');
const logger = require('../utils/logger');

const router = express.Router();

const messageRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Too many messages sent. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

const readRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many read requests. Please slow down.' }
});

const fixMessageFileData = (message) => {
    if (message.fileData && message.fileData.data) {
        message.fileData.data = fixBase64Format(message.fileData.data);
        if (message.fileData.thumbnail) {
            message.fileData.thumbnail = fixBase64Format(message.fileData.thumbnail);
        }
    }
    return message;
};

/**
 * @swagger
 * /api/message/conversation/{conversationId}:
 *   get:
 *     tags: [Messages]
 *     summary: Get messages in a conversation
 *     description: Retrieve paginated messages from a specific conversation with read status information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - name: conversationId
 *         in: path
 *         required: true
 *         description: Conversation ID to retrieve messages from
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}$'
 *       - $ref: '#/components/parameters/Page'
 *       - name: limit
 *         in: query
 *         description: Number of messages per page (max 50)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 50
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
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
 *                         messages:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Message'
 *                         pagination:
 *                           $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 messages:
 *                   - _id: "507f1f77bcf86cd799439015"
 *                     sender:
 *                       _id: "507f1f77bcf86cd799439011"
 *                       username: "john_doe"
 *                       firstName: "John"
 *                       lastName: "Doe"
 *                     conversation: "507f1f77bcf86cd799439012"
 *                     content: "Hello, how are you?"
 *                     type: "text"
 *                     createdAt: "2025-01-15T10:30:00.000Z"
 *                     readStatus:
 *                       isRead: true
 *                       readAt: "2025-01-15T10:31:00.000Z"
 *                 pagination:
 *                   page: 1
 *                   limit: 50
 *                   total: 150
 *                   pages: 3
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/conversation/:conversationId', auth, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid conversation ID'
            });
        }

        const conversation = await Conversation.findOne({
            _id: conversationId,
            participants: req.user._id
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        const messages = await Message.find({
            conversation: conversationId,
            isDeleted: false,
            'deletedFor.user': { $ne: req.user._id }
        })
            .populate('sender', 'username firstName lastName avatar')
            .populate('replyTo')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Message.countDocuments({
            conversation: conversationId,
            isDeleted: false,
            'deletedFor.user': { $ne: req.user._id }
        });

        const messagesWithStatus = messages.map(message => {
            let messageObj = message.toObject();

            if (messageObj.sender && messageObj.sender.avatar) {
                messageObj.sender.avatar = fixBase64Format(messageObj.sender.avatar);
            }

            messageObj = fixMessageFileData(messageObj);

            messageObj.readStatus = message.getReadStatus(req.user._id);
            messageObj.isDeletedForMe = message.isDeletedForUser(req.user._id);

            if (message.isMedia()) {
                messageObj.mediaInfo = message.getMediaInfo();
            }

            return messageObj;
        });

        res.json({
            success: true,
            data: {
                messages: messagesWithStatus.reverse(),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/file/{messageId}:
 *   get:
 *     tags: [Messages]
 *     summary: Download message file
 *     description: Download the file attached to a specific message
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: File downloaded successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *         headers:
 *           Content-Type:
 *             description: Original file MIME type
 *             schema:
 *               type: string
 *           Content-Disposition:
 *             description: Attachment with original filename
 *             schema:
 *               type: string
 *           Content-Length:
 *             description: File size in bytes
 *             schema:
 *               type: integer
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: File not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               messageNotFound:
 *                 summary: Message not found
 *                 value:
 *                   success: false
 *                   message: "Message not found"
 *               fileNotFound:
 *                 summary: File not found
 *                 value:
 *                   success: false
 *                   message: "File not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/file/:messageId', auth, async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid message ID'
            });
        }

        const message = await Message.findById(messageId)
            .populate('conversation');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        const hasAccess = message.conversation.participants.includes(req.user._id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (message.isDeletedForUser(req.user._id)) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        if (!message.fileData || !message.fileData.data) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        try {
            const fixedFileData = fixBase64Format(message.fileData.data);

            let fileBuffer;

            const base64Data = extractBase64Data(fixedFileData);
            if (!base64Data) {
                throw new Error('Invalid base64 data format');
            }

            fileBuffer = Buffer.from(base64Data, 'base64');

            const contentType = message.fileData.type || 'application/octet-stream';
            const fileName = message.fileData.name || 'download';

            const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');

            logger.info(`Serving file: ${fileName}, type: ${contentType}, size: ${fileBuffer.length} bytes`);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
            res.setHeader('Expires', '-1');
            res.setHeader('Pragma', 'no-cache');

            if (message.type === 'video' || message.type === 'audio') {
                res.setHeader('Accept-Ranges', 'bytes');
            }

            res.send(fileBuffer);

        } catch (decodeError) {
            logger.error('File decode error:', decodeError);
            return res.status(500).json({
                success: false,
                message: 'Error processing file data'
            });
        }

    } catch (error) {
        logger.error('Download file error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/thumbnail/{messageId}:
 *   get:
 *     tags: [Messages]
 *     summary: Get message thumbnail
 *     description: Get thumbnail image for image or video messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Thumbnail retrieved successfully
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *         headers:
 *           Content-Type:
 *             description: Image MIME type
 *             schema:
 *               type: string
 *           Cache-Control:
 *             description: Cache control header
 *             schema:
 *               type: string
 *               example: "public, max-age=86400"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Thumbnail not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Thumbnail not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/thumbnail/:messageId', auth, async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid message ID'
            });
        }

        const message = await Message.findById(messageId)
            .populate('conversation');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        const hasAccess = message.conversation.participants.includes(req.user._id);
        if (!hasAccess || message.isDeletedForUser(req.user._id)) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        if (!['image', 'video'].includes(message.type) || !message.fileData) {
            return res.status(404).json({
                success: false,
                message: 'Thumbnail not found'
            });
        }

        const thumbnailData = message.fileData.thumbnail || message.fileData.data;

        if (!thumbnailData) {
            return res.status(404).json({
                success: false,
                message: 'Thumbnail not found'
            });
        }

        try {
            const fixedThumbnailData = fixBase64Format(thumbnailData);

            const base64Data = extractBase64Data(fixedThumbnailData);
            if (!base64Data) {
                throw new Error('Invalid thumbnail base64 data');
            }

            const thumbnailBuffer = Buffer.from(base64Data, 'base64');

            res.setHeader('Content-Type', message.fileData.type || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('Content-Length', thumbnailBuffer.length);

            res.send(thumbnailBuffer);

        } catch (decodeError) {
            logger.error('Thumbnail decode error:', decodeError);
            return res.status(500).json({
                success: false,
                message: 'Error processing thumbnail data'
            });
        }

    } catch (error) {
        logger.error('Get thumbnail error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/stream/{messageId}:
 *   get:
 *     tags: [Messages]
 *     summary: Stream media file
 *     description: Stream video or audio files with range request support for progressive playback
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *       - name: Range
 *         in: header
 *         description: Range header for partial content requests
 *         schema:
 *           type: string
 *           example: "bytes=0-1023"
 *     responses:
 *       200:
 *         description: Media file streamed successfully
 *         content:
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *         headers:
 *           Content-Type:
 *             description: Media MIME type
 *             schema:
 *               type: string
 *           Accept-Ranges:
 *             description: Accepts range requests
 *             schema:
 *               type: string
 *               example: "bytes"
 *       206:
 *         description: Partial content (range request)
 *         content:
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *         headers:
 *           Content-Range:
 *             description: Content range information
 *             schema:
 *               type: string
 *               example: "bytes 0-1023/2048"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/stream/:messageId', auth, async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid message ID'
            });
        }

        const message = await Message.findById(messageId)
            .populate('conversation');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        const hasAccess = message.conversation.participants.includes(req.user._id);
        if (!hasAccess || message.isDeletedForUser(req.user._id)) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        if (!['video', 'audio'].includes(message.type) || !message.fileData || !message.fileData.data) {
            return res.status(404).json({
                success: false,
                message: 'Media file not found'
            });
        }

        try {
            const fixedFileData = fixBase64Format(message.fileData.data);

            const base64Data = extractBase64Data(fixedFileData);
            if (!base64Data) {
                throw new Error('Invalid media base64 data');
            }

            const fileBuffer = Buffer.from(base64Data, 'base64');
            const fileSize = fileBuffer.length;

            const range = req.headers.range;
            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                const chunksize = (end - start) + 1;
                const chunk = fileBuffer.slice(start, end + 1);

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': message.fileData.type,
                });

                res.end(chunk);
            } else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': message.fileData.type,
                    'Accept-Ranges': 'bytes'
                });
                res.end(fileBuffer);
            }

        } catch (decodeError) {
            logger.error('Stream decode error:', decodeError);
            return res.status(500).json({
                success: false,
                message: 'Error processing media data'
            });
        }

    } catch (error) {
        logger.error('Stream media error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/read:
 *   put:
 *     tags: [Messages]
 *     summary: Mark messages as read
 *     description: Mark multiple messages as read by the current user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MessageReadRequest'
 *           example:
 *             messageIds: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]
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
 *                           example: 2
 *                         totalRequested:
 *                           type: integer
 *                           example: 2
 *             example:
 *               success: true
 *               message: "Messages marked as read"
 *               data:
 *                 markedCount: 2
 *                 totalRequested: 2
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/read', auth, readRateLimit, [
    body('messageIds').isArray({ min: 1 }).withMessage('Message IDs array is required'),
    body('messageIds.*').isMongoId().withMessage('Invalid message ID format')
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

        const { messageIds } = req.body;

        if (!req.sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const messages = await Message.find({
            _id: { $in: messageIds }
        }).populate('conversation');

        const accessibleMessageIds = [];
        for (const message of messages) {
            if (message.conversation && message.conversation.participants.includes(req.user._id)) {
                accessibleMessageIds.push(message._id);
            }
        }

        if (accessibleMessageIds.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No accessible messages found'
            });
        }

        const result = await Message.updateMany(
            {
                _id: { $in: accessibleMessageIds },
                'readBy.user': { $ne: req.user._id }
            },
            {
                $push: {
                    readBy: {
                        user: req.user._id,
                        readAt: new Date(),
                        sessionId: req.sessionId
                    }
                },
                $set: {
                    'metadata.deliveryStatus': 'read',
                    'metadata.readAt': new Date()
                }
            }
        );

        res.json({
            success: true,
            message: 'Messages marked as read',
            data: {
                markedCount: result.modifiedCount,
                totalRequested: messageIds.length
            }
        });

    } catch (error) {
        logger.error('Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/{messageId}/for-me:
 *   delete:
 *     tags: [Messages]
 *     summary: Delete message for current user
 *     description: Delete a message only for the current user (message remains for other participants)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Message deleted for current user successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Message deleted for you"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:messageId/for-me', auth, async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid message ID'
            });
        }

        const message = await Message.findById(messageId)
            .populate('conversation');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        const hasAccess = message.conversation.participants.includes(req.user._id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        await message.deleteForUser(req.user._id, 'forMe');

        res.json({
            success: true,
            message: 'Message deleted for you'
        });

    } catch (error) {
        logger.error('Delete message for me error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/{messageId}/for-everyone:
 *   delete:
 *     tags: [Messages]
 *     summary: Delete message for everyone
 *     description: Delete a message for all participants (only sender can do this within 1 hour)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Message deleted for everyone successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Message deleted for everyone"
 *       400:
 *         description: Validation error or time limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidId:
 *                 summary: Invalid message ID
 *                 value:
 *                   success: false
 *                   message: "Invalid message ID"
 *               timeLimit:
 *                 summary: Time limit exceeded
 *                 value:
 *                   success: false
 *                   message: "Message can only be deleted for everyone within 1 hour of sending"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Only sender can delete for everyone
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Only sender can delete message for everyone"
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:messageId/for-everyone', auth, async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid message ID'
            });
        }

        const message = await Message.findById(messageId)
            .populate('conversation');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        if (message.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Only sender can delete message for everyone'
            });
        }

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        if (message.createdAt < oneHourAgo) {
            return res.status(400).json({
                success: false,
                message: 'Message can only be deleted for everyone within 1 hour of sending'
            });
        }

        await message.deleteForUser(req.user._id, 'forEveryone');

        res.json({
            success: true,
            message: 'Message deleted for everyone'
        });

    } catch (error) {
        logger.error('Delete message for everyone error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/{messageId}/details:
 *   get:
 *     tags: [Messages]
 *     summary: Get detailed message information
 *     description: Get comprehensive details about a message including read receipts and delivery status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/MessageId'
 *     responses:
 *       200:
 *         description: Message details retrieved successfully
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
 *                         message:
 *                           allOf:
 *                             - $ref: '#/components/schemas/Message'
 *                             - type: object
 *                               properties:
 *                                 deliveryInfo:
 *                                   type: object
 *                                   properties:
 *                                     sent:
 *                                       type: string
 *                                       format: date-time
 *                                     delivered:
 *                                       type: string
 *                                       format: date-time
 *                                     read:
 *                                       type: string
 *                                       format: date-time
 *                                     status:
 *                                       type: string
 *                                       enum: [sent, delivered, read, failed]
 *                                 canDeleteForEveryone:
 *                                   type: boolean
 *                                   description: Whether current user can delete this message for everyone
 *                                 mediaInfo:
 *                                   type: object
 *                                   description: Media information for file messages
 *                                   properties:
 *                                     type:
 *                                       type: string
 *                                     size:
 *                                       type: string
 *                                     duration:
 *                                       type: string
 *             example:
 *               success: true
 *               data:
 *                 message:
 *                   _id: "507f1f77bcf86cd799439015"
 *                   content: "Hello, how are you?"
 *                   type: "text"
 *                   deliveryInfo:
 *                     sent: "2025-01-15T10:30:00.000Z"
 *                     delivered: "2025-01-15T10:30:05.000Z"
 *                     read: "2025-01-15T10:31:00.000Z"
 *                     status: "read"
 *                   canDeleteForEveryone: true
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:messageId/details', auth, async (req, res) => {
    try {
        const { messageId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid message ID'
            });
        }

        const message = await Message.findById(messageId)
            .populate('sender', 'username firstName lastName avatar')
            .populate('conversation')
            .populate('readBy.user', 'username firstName lastName avatar');

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        const hasAccess = message.conversation.participants.includes(req.user._id);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (message.isDeletedForUser(req.user._id)) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        let messageDetails = message.toObject();

        if (messageDetails.sender && messageDetails.sender.avatar) {
            messageDetails.sender.avatar = fixBase64Format(messageDetails.sender.avatar);
        }

        if (messageDetails.readBy) {
            messageDetails.readBy = messageDetails.readBy.map(read => {
                if (read.user && read.user.avatar) {
                    read.user.avatar = fixBase64Format(read.user.avatar);
                }
                return read;
            });
        }

        messageDetails = fixMessageFileData(messageDetails);

        messageDetails.readStatus = message.getReadStatus(req.user._id);
        messageDetails.deliveryInfo = {
            sent: message.metadata.sentAt,
            delivered: message.metadata.deliveredAt,
            read: message.metadata.readAt,
            status: message.metadata.deliveryStatus
        };
        messageDetails.canDeleteForEveryone = message.sender.toString() === req.user._id.toString() &&
            new Date(Date.now() - 60 * 60 * 1000) < message.createdAt;

        if (message.isMedia()) {
            messageDetails.mediaInfo = message.getMediaInfo();
        }

        res.json({
            success: true,
            data: { message: messageDetails }
        });

    } catch (error) {
        logger.error('Get message details error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/message/unread/count:
 *   get:
 *     tags: [Messages]
 *     summary: Get unread message count
 *     description: Get the count of unread messages for the current user, optionally filtered by conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - name: conversationId
 *         in: query
 *         description: Optional conversation ID to filter unread count
 *         schema:
 *           type: string
 *           pattern: '^[0-9a-fA-F]{24}
 *     responses:
 *       200:
 *         description: Unread count retrieved successfully
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
 *                         unreadCount:
 *                           type: integer
 *                           example: 15
 *             example:
 *               success: true
 *               data:
 *                 unreadCount: 15
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Conversation not found (when conversationId provided)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Conversation not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/unread/count', auth, async (req, res) => {
    try {
        const { conversationId } = req.query;

        let query = {
            sender: { $ne: req.user._id },
            'readBy.user': { $ne: req.user._id },
            isDeleted: false,
            'deletedFor.user': { $ne: req.user._id }
        };

        if (conversationId && mongoose.Types.ObjectId.isValid(conversationId)) {
            const conversation = await Conversation.findOne({
                _id: conversationId,
                participants: req.user._id
            });

            if (!conversation) {
                return res.status(404).json({
                    success: false,
                    message: 'Conversation not found'
                });
            }

            query.conversation = conversationId;
        }

        const unreadCount = await Message.countDocuments(query);

        res.json({
            success: true,
            data: { unreadCount }
        });

    } catch (error) {
        logger.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;