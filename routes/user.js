const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { auth } = require('../middleware/auth');
const { getOnlineUsers, isUserOnline } = require('../services/redisService');
const { fixBase64Format, processBase64File, isValidBase64Image } = require('../utils/base64Helper');
const logger = require('../utils/logger');

const router = express.Router();

const userListRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many user list requests' }
});

const profileUpdateRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many profile update attempts' }
});

/**
 * @swagger
 * /api/user/list:
 *   get:
 *     tags: [Users]
 *     summary: Get users list
 *     description: Retrieve a paginated list of active users with search functionality and online status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/Limit'
 *       - name: search
 *         in: query
 *         description: Search term to filter users by username, first name, or last name
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *           example: "john"
 *     responses:
 *       200:
 *         description: Users retrieved successfully
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
 *                         users:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/User'
 *                               - type: object
 *                                 properties:
 *                                   isOnline:
 *                                     type: boolean
 *                                     example: true
 *                                   unreadCount:
 *                                     type: integer
 *                                     example: 3
 *                         pagination:
 *                           $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 users:
 *                   - _id: "507f1f77bcf86cd799439011"
 *                     username: "john_doe"
 *                     firstName: "John"
 *                     lastName: "Doe"
 *                     avatar: null
 *                     lastSeen: "2025-01-15T10:30:00.000Z"
 *                     isOnline: true
 *                     unreadCount: 3
 *                 pagination:
 *                   page: 1
 *                   limit: 20
 *                   total: 50
 *                   pages: 3
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/list', auth, userListRateLimit, async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const skip = (page - 1) * limit;

        let query = { isActive: true, _id: { $ne: req.user._id } };

        if (search) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { username: searchRegex },
                { firstName: searchRegex },
                { lastName: searchRegex }
            ];
        }

        const users = await User.find(query)
            .select('username firstName lastName avatar lastSeen')
            .sort({ lastSeen: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await User.countDocuments(query);

        const usersWithStatus = await Promise.all(
            users.map(async (user) => {
                const isOnline = await isUserOnline(user._id);

                const unreadCount = await Message.aggregate([
                    {
                        $lookup: {
                            from: 'conversations',
                            localField: 'conversation',
                            foreignField: '_id',
                            as: 'conversationData'
                        }
                    },
                    {
                        $match: {
                            sender: user._id,
                            'conversationData.participants': req.user._id,
                            'readBy.user': { $ne: req.user._id },
                            isDeleted: false
                        }
                    },
                    {
                        $count: 'unreadCount'
                    }
                ]);

                let userObj = user.toObject();
                if (userObj.avatar) {
                    userObj.avatar = fixBase64Format(userObj.avatar);
                }

                return {
                    ...userObj,
                    isOnline,
                    unreadCount: unreadCount[0]?.unreadCount || 0
                };
            })
        );

        res.json({
            success: true,
            data: {
                users: usersWithStatus,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/online-count:
 *   get:
 *     tags: [Users]
 *     summary: Get online users count
 *     description: Get the total count of currently online users and their IDs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: Online users count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/OnlineUsersResponse'
 *             example:
 *               success: true
 *               data:
 *                 count: 15
 *                 users: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/online-count', auth, async (req, res) => {
    try {
        const onlineUsers = await getOnlineUsers();
        res.json({
            success: true,
            data: {
                count: onlineUsers.length,
                users: onlineUsers
            }
        });
    } catch (error) {
        logger.error('Get online count error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/profile/{userId}:
 *   get:
 *     tags: [Users]
 *     summary: Get user profile
 *     description: Retrieve public profile information of a specific user including online status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
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
 *                         user:
 *                           allOf:
 *                             - $ref: '#/components/schemas/User'
 *                             - type: object
 *                               properties:
 *                                 isOnline:
 *                                   type: boolean
 *                                   example: true
 *             example:
 *               success: true
 *               data:
 *                 user:
 *                   _id: "507f1f77bcf86cd799439011"
 *                   username: "john_doe"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   avatar: null
 *                   lastSeen: "2025-01-15T10:30:00.000Z"
 *                   isActive: true
 *                   isOnline: true
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/profile/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID format'
            });
        }

        const user = await User.findById(userId)
            .select('username firstName lastName avatar lastSeen isActive');

        if (!user || !user.isActive) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        const isOnline = await isUserOnline(userId);

        let userObj = user.toObject();
        if (userObj.avatar) {
            userObj.avatar = fixBase64Format(userObj.avatar);
        }

        res.json({
            success: true,
            data: {
                user: {
                    ...userObj,
                    isOnline
                }
            }
        });

    } catch (error) {
        logger.error('Get user profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     tags: [Users]
 *     summary: Update user profile
 *     description: Update the current user's profile information including avatar, name, and username
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpdate'
 *           examples:
 *             basicUpdate:
 *               summary: Update basic information
 *               value:
 *                 firstName: "John"
 *                 lastName: "Doe"
 *                 username: "john_doe_updated"
 *             avatarUpdate:
 *               summary: Update with avatar
 *               value:
 *                 firstName: "John"
 *                 lastName: "Doe"
 *                 avatar: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
 *             removeAvatar:
 *               summary: Remove avatar
 *               value:
 *                 firstName: "John"
 *                 lastName: "Doe"
 *                 avatar: null
 *     responses:
 *       200:
 *         description: Profile updated successfully
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
 *                         user:
 *                           $ref: '#/components/schemas/User'
 *             example:
 *               success: true
 *               message: "Profile updated successfully"
 *               data:
 *                 user:
 *                   id: "507f1f77bcf86cd799439011"
 *                   username: "john_doe_updated"
 *                   email: "john.doe@example.com"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   avatar: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
 *                   lastSeen: "2025-01-15T10:30:00.000Z"
 *                   isActive: true
 *       400:
 *         description: Validation error or username taken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               validation:
 *                 summary: Validation errors
 *                 value:
 *                   success: false
 *                   message: "Validation failed"
 *                   errors: [
 *                     {
 *                       msg: "Username must be 3-30 characters",
 *                       param: "username",
 *                       value: "ab"
 *                     }
 *                   ]
 *               usernameTaken:
 *                 summary: Username already taken
 *                 value:
 *                   success: false
 *                   message: "Username is already taken"
 *               avatarError:
 *                 summary: Avatar processing error
 *                 value:
 *                   success: false
 *                   message: "Avatar error: File size (10.5 MB) exceeds maximum allowed size (5 MB)"
 *                   details:
 *                     size: 11010048
 *                     maxSize: 5242880
 *                     mimeType: "image/jpeg"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/profile', auth, profileUpdateRateLimit, [
    body('firstName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('First name must be 1-50 characters'),
    body('lastName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Last name must be 1-50 characters'),
    body('username')
        .optional()
        .trim()
        .isLength({ min: 3, max: 30 })
        .withMessage('Username must be 3-30 characters')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username can only contain letters, numbers, and underscores'),
    body('avatar')
        .optional()
        .custom((value) => {
            if (value === null || value === '') {
                return true;
            }
            if (typeof value === 'string') {
                if (value.startsWith('data:image/')) {
                    return true;
                }
                if (value.startsWith('http://') || value.startsWith('https://')) {
                    return true;
                }
            }
            throw new Error('Avatar must be a valid base64 image data or URL');
        })
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

        const { firstName, lastName, username, avatar } = req.body;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const updateData = {};
        if (firstName !== undefined) updateData.firstName = firstName.trim();
        if (lastName !== undefined) updateData.lastName = lastName.trim();
        if (username !== undefined) {
            const existingUser = await User.findOne({
                username: username.trim(),
                _id: { $ne: req.user._id }
            });

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is already taken'
                });
            }
            updateData.username = username.trim();
        }

        if (avatar !== undefined) {
            if (avatar === null || avatar === '') {
                updateData.avatar = null;
                logger.info(`Removing avatar for user ${req.user._id}`);
            } else if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
                const processResult = processBase64File(avatar, {
                    maxSize: 5 * 1024 * 1024,
                    allowedTypes: ['image'],
                    fixFormat: true
                });

                if (!processResult.isValid) {
                    return res.status(400).json({
                        success: false,
                        message: `Avatar error: ${processResult.error}`,
                        details: {
                            size: processResult.size,
                            maxSize: processResult.maxSize,
                            mimeType: processResult.mimeType
                        }
                    });
                }

                updateData.avatar = processResult.data;
                logger.info(`Setting new avatar for user ${req.user._id}, size: ${processResult.sizeFormatted}`);
            } else {
                updateData.avatar = avatar;
                logger.info(`Setting avatar URL for user ${req.user._id}`);
            }
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            {
                new: true,
                runValidators: true,
                select: '-password'
            }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        logger.info(`Profile updated successfully for user ${req.user._id}`);

        let responseUser = {
            id: user._id,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            avatar: user.avatar ? fixBase64Format(user.avatar) : user.avatar,
            lastSeen: user.lastSeen,
            isActive: user.isActive
        };

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: responseUser
            }
        });

        if (global.io) {
            global.io.emit('user_profile_updated', {
                userId: user._id,
                userData: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    username: user.username,
                    avatar: user.avatar ? fixBase64Format(user.avatar) : user.avatar
                }
            });
        }

    } catch (error) {
        logger.error('Update profile error:', error);

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            const fieldName = field === 'email' ? 'e-posta' : 'kullanıcı adı';
            return res.status(400).json({
                success: false,
                message: `Bu ${fieldName} zaten kullanılıyor`
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/search:
 *   get:
 *     tags: [Users]
 *     summary: Search users
 *     description: Search for users by username, first name, or last name with online status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - name: query
 *         in: query
 *         required: true
 *         description: Search query (minimum 2 characters)
 *         schema:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *           example: "john"
 *       - name: limit
 *         in: query
 *         description: Maximum number of results (max 50)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
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
 *                         users:
 *                           type: array
 *                           items:
 *                             allOf:
 *                               - $ref: '#/components/schemas/User'
 *                               - type: object
 *                                 properties:
 *                                   isOnline:
 *                                     type: boolean
 *                         count:
 *                           type: integer
 *                           example: 3
 *             example:
 *               success: true
 *               data:
 *                 users:
 *                   - _id: "507f1f77bcf86cd799439011"
 *                     username: "john_doe"
 *                     firstName: "John"
 *                     lastName: "Doe"
 *                     avatar: null
 *                     isOnline: true
 *                 count: 1
 *       400:
 *         description: Invalid search query
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               shortQuery:
 *                 summary: Query too short
 *                 value:
 *                   success: false
 *                   message: "Search query must be at least 2 characters"
 *               limitExceeded:
 *                 summary: Limit exceeded
 *                 value:
 *                   success: false
 *                   message: "Limit cannot exceed 50"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/search', auth, [
    body('query').optional().trim().isLength({ min: 2, max: 50 })
], async (req, res) => {
    try {
        const { query, limit = 10 } = req.query;

        if (!query || query.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Search query must be at least 2 characters'
            });
        }

        if (parseInt(limit) > 50) {
            return res.status(400).json({
                success: false,
                message: 'Limit cannot exceed 50'
            });
        }

        const searchRegex = new RegExp(query.trim(), 'i');
        const searchQuery = {
            isActive: true,
            _id: { $ne: req.user._id },
            $or: [
                { username: searchRegex },
                { firstName: searchRegex },
                { lastName: searchRegex }
            ]
        };

        const users = await User.find(searchQuery)
            .select('username firstName lastName avatar')
            .limit(parseInt(limit));

        const usersWithStatus = await Promise.all(
            users.map(async (user) => {
                const isOnline = await isUserOnline(user._id);

                let userObj = user.toObject();
                if (userObj.avatar) {
                    userObj.avatar = fixBase64Format(userObj.avatar);
                }

                return {
                    ...userObj,
                    isOnline
                };
            })
        );

        res.json({
            success: true,
            data: {
                users: usersWithStatus,
                count: usersWithStatus.length
            }
        });

    } catch (error) {
        logger.error('Search users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/unread/total:
 *   get:
 *     tags: [Users]
 *     summary: Get total unread messages count
 *     description: Get the total count of unread messages across all conversations for the current user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: Total unread count retrieved successfully
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
 *                         totalUnreadCount:
 *                           type: integer
 *                           example: 25
 *             example:
 *               success: true
 *               data:
 *                 totalUnreadCount: 25
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/unread/total', auth, async (req, res) => {
    try {
        const totalUnreadCount = await Message.aggregate([
            {
                $lookup: {
                    from: 'conversations',
                    localField: 'conversation',
                    foreignField: '_id',
                    as: 'conversationData'
                }
            },
            {
                $match: {
                    sender: { $ne: req.user._id },
                    'conversationData.participants': req.user._id,
                    'readBy.user': { $ne: req.user._id },
                    isDeleted: false
                }
            },
            {
                $count: 'totalUnread'
            }
        ]);

        res.json({
            success: true,
            data: {
                totalUnreadCount: totalUnreadCount[0]?.totalUnread || 0
            }
        });

    } catch (error) {
        logger.error('Get total unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/unread/by-conversation:
 *   get:
 *     tags: [Users]
 *     summary: Get unread messages by conversation
 *     description: Get unread message counts grouped by conversation with participant information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: Unread counts by conversation retrieved successfully
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
 *                         unreadByConversation:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               conversationId:
 *                                 type: string
 *                                 example: "507f1f77bcf86cd799439012"
 *                               unreadCount:
 *                                 type: integer
 *                                 example: 5
 *                               lastMessage:
 *                                 type: string
 *                                 format: date-time
 *                                 example: "2025-01-15T10:30:00.000Z"
 *                               participants:
 *                                 type: array
 *                                 items:
 *                                   type: object
 *                                   properties:
 *                                     _id:
 *                                       type: string
 *                                     username:
 *                                       type: string
 *                                     firstName:
 *                                       type: string
 *                                     lastName:
 *                                       type: string
 *             example:
 *               success: true
 *               data:
 *                 unreadByConversation:
 *                   - conversationId: "507f1f77bcf86cd799439012"
 *                     unreadCount: 5
 *                     lastMessage: "2025-01-15T10:30:00.000Z"
 *                     participants:
 *                       - _id: "507f1f77bcf86cd799439011"
 *                         username: "john_doe"
 *                         firstName: "John"
 *                         lastName: "Doe"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/unread/by-conversation', auth, async (req, res) => {
    try {
        const unreadByConversation = await Message.aggregate([
            {
                $lookup: {
                    from: 'conversations',
                    localField: 'conversation',
                    foreignField: '_id',
                    as: 'conversationData'
                }
            },
            {
                $match: {
                    sender: { $ne: req.user._id },
                    'conversationData.participants': req.user._id,
                    'readBy.user': { $ne: req.user._id },
                    isDeleted: false
                }
            },
            {
                $group: {
                    _id: '$conversation',
                    unreadCount: { $sum: 1 },
                    lastMessage: { $max: '$createdAt' }
                }
            },
            {
                $lookup: {
                    from: 'conversations',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'conversation'
                }
            },
            {
                $unwind: '$conversation'
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'conversation.participants',
                    foreignField: '_id',
                    as: 'participants'
                }
            },
            {
                $project: {
                    conversationId: '$_id',
                    unreadCount: 1,
                    lastMessage: 1,
                    participants: {
                        $filter: {
                            input: '$participants',
                            cond: { $ne: ['$$this._id', req.user._id] }
                        }
                    }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                unreadByConversation
            }
        });

    } catch (error) {
        logger.error('Get unread by conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/user/block/{userId}:
 *   post:
 *     tags: [Users]
 *     summary: Block or unblock user
 *     description: Block or unblock another user (placeholder implementation)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [block, unblock]
 *                 example: "block"
 *           example:
 *             action: "block"
 *     responses:
 *       200:
 *         description: User blocked/unblocked successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             examples:
 *               blocked:
 *                 summary: User blocked
 *                 value:
 *                   success: true
 *                   message: "User blocked successfully"
 *               unblocked:
 *                 summary: User unblocked
 *                 value:
 *                   success: true
 *                   message: "User unblocked successfully"
 *       400:
 *         description: Validation error or cannot block yourself
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidId:
 *                 summary: Invalid user ID
 *                 value:
 *                   success: false
 *                   message: "Invalid user ID format"
 *               selfBlock:
 *                 summary: Cannot block yourself
 *                 value:
 *                   success: false
 *                   message: "Cannot block yourself"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/block/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { action } = req.body;

        if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID format'
            });
        }

        if (userId === req.user._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Cannot block yourself'
            });
        }

        const targetUser = await User.findById(userId);
        if (!targetUser || !targetUser.isActive) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: `User ${action === 'block' ? 'blocked' : 'unblocked'} successfully`
        });

    } catch (error) {
        logger.error('Block/unblock user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;