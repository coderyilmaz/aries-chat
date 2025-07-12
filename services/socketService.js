const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { setUserOnline, setUserOffline, getOnlineUsers } = require('./redisService');
const { fixBase64Format, processBase64File } = require('../utils/base64Helper');
const logger = require('../utils/logger');

const socketAuth = async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        const sessionId = socket.handshake.auth.sessionId;

        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        if (!sessionId) {
            return next(new Error('Authentication error: No session ID provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user || !user.isActive) {
            return next(new Error('Authentication error: Invalid user'));
        }

        socket.userId = user._id.toString();
        socket.user = user;
        socket.sessionId = sessionId;
        next();
    } catch (error) {
        next(new Error('Authentication error: Invalid token'));
    }
};

const prepareUserData = (user) => {
    const userData = {
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar ? fixBase64Format(user.avatar) : user.avatar,
        isOnline: true
    };
    return userData;
};

const handleConnection = (io) => {
    io.use(socketAuth);

    io.on('connection', async (socket) => {
        try {
            await setUserOnline(socket.userId);
            socket.join(`user_${socket.userId}`);

            const onlineUsers = await getOnlineUsers();
            socket.broadcast.emit('user_online', {
                userId: socket.userId,
                username: socket.user.username,
                onlineCount: onlineUsers.length
            });

            socket.broadcast.emit('new_user_joined', {
                user: prepareUserData(socket.user)
            });

            const userConversations = await Conversation.find({
                participants: socket.userId
            }).select('_id');

            userConversations.forEach(conv => {
                socket.join(`conversation_${conv._id}`);
            });

            logger.info(`User ${socket.user.username} connected with session ${socket.sessionId}`);

            socket.on('join_room', async (data) => {
                try {
                    const { conversationId, sessionId } = data;

                    if (!sessionId) {
                        socket.emit('error', { message: 'Session ID required' });
                        return;
                    }

                    const conversation = await Conversation.findOne({
                        _id: conversationId,
                        participants: socket.userId
                    });

                    if (conversation) {
                        socket.join(`conversation_${conversationId}`);
                        socket.conversationSessionId = sessionId;
                        socket.currentConversationId = conversationId;

                        socket.emit('joined_room', {
                            conversationId,
                            sessionId
                        });

                        logger.info(`User ${socket.userId} joined conversation ${conversationId}`);
                    } else {
                        socket.emit('error', { message: 'Unauthorized access to conversation' });
                    }
                } catch (error) {
                    logger.error('Join room error:', error);
                    socket.emit('error', { message: 'Error joining room' });
                }
            });

            socket.on('send_message', async (data) => {
                try {
                    const { conversationId, content, type = 'text', messageId, sessionId, fileData } = data;

                    if (!sessionId) {
                        socket.emit('error', { message: 'Session ID required' });
                        return;
                    }

                    const conversation = await Conversation.findOne({
                        _id: conversationId,
                        participants: socket.userId
                    }).populate('participants', '_id username firstName lastName avatar');

                    if (!conversation) {
                        socket.emit('error', { message: 'Conversation not found' });
                        return;
                    }

                    let messageContent = content || '';
                    let messageType = type;
                    let processedFileData = null;

                    if (fileData && fileData.data) {
                        messageContent = fileData.name || content || 'File';

                        if (fileData.type) {
                            if (fileData.type.startsWith('image/')) {
                                messageType = 'image';
                            } else if (fileData.type.startsWith('video/')) {
                                messageType = 'video';
                            } else if (fileData.type.startsWith('audio/')) {
                                messageType = 'audio';
                            } else {
                                messageType = 'file';
                            }
                        }

                        const maxSizes = {
                            'image': 10 * 1024 * 1024,
                            'video': 50 * 1024 * 1024,
                            'audio': 20 * 1024 * 1024,
                            'file': 20 * 1024 * 1024
                        };

                        const maxSize = maxSizes[messageType] || maxSizes.file;

                        let fixedFileData = fileData.data;
                        if (fixedFileData && !fixedFileData.includes(';base64,') && fixedFileData.includes('base64,')) {
                            fixedFileData = fixedFileData.replace('base64,', ';base64,');
                        }

                        if (fixedFileData && !fixedFileData.startsWith('data:')) {
                            fixedFileData = `data:${fileData.type};base64,${fixedFileData}`;
                        }


                        const base64Data = fixedFileData.includes(',') ? fixedFileData.split(',')[1] : fixedFileData;
                        const actualFileSize = Math.round((base64Data.length * 3) / 4);

                        if (actualFileSize > maxSize) {
                            const limitMB = Math.round(maxSize / (1024 * 1024));
                            socket.emit('error', {
                                message: `File size exceeds limit of ${limitMB}MB`,
                                details: {
                                    actualSize: Math.round(actualFileSize / (1024 * 1024)) + 'MB',
                                    maxSize: limitMB + 'MB',
                                    type: messageType
                                }
                            });
                            return;
                        }

                        processedFileData = {};

                        if (fileData.name != null) {
                            processedFileData.name = String(fileData.name);
                        }

                        if (fileData.type != null) {
                            processedFileData.type = String(fileData.type);
                        }

                        if (fixedFileData != null) {
                            processedFileData.data = String(fixedFileData);
                        }

                        if (actualFileSize != null && !isNaN(actualFileSize)) {
                            processedFileData.size = Number(actualFileSize);
                        }

                        if (fileData.thumbnail != null && typeof fileData.thumbnail === 'string') {
                            processedFileData.thumbnail = String(fixBase64Format(fileData.thumbnail));
                        }

                        if (fileData.duration != null && !isNaN(Number(fileData.duration))) {
                            processedFileData.duration = Number(fileData.duration);
                        }

                        if (fileData.url != null) {
                            processedFileData.url = String(fileData.url);
                        }
                    }

                    if (!messageContent.trim() && !processedFileData) {
                        socket.emit('error', { message: 'Message content or file required' });
                        return;
                    }

                    const messageData = {
                        sender: socket.userId,
                        conversation: conversationId,
                        content: messageContent.trim(),
                        type: messageType,
                        messageId: messageId || require('crypto').randomUUID(),
                        sessionId: sessionId,
                        fileData: processedFileData,
                        metadata: {
                            encrypted: false,
                            encryptionVersion: '1.0',
                            clientInfo: {
                                userAgent: socket.handshake.headers['user-agent'],
                                platform: 'web'
                            },
                            deliveryStatus: 'sent',
                            sentAt: new Date()
                        }
                    };

                    const newMessage = new Message(messageData);

                    const savedMessage = await newMessage.save();

                    await savedMessage.populate('sender', 'username firstName lastName avatar');


                    conversation.lastMessage = savedMessage._id;
                    conversation.lastActivity = new Date();
                    await conversation.save();

                    let messageResponse = savedMessage.toObject();
                    if (messageResponse.sender && messageResponse.sender.avatar) {
                        messageResponse.sender.avatar = fixBase64Format(messageResponse.sender.avatar);
                    }

                    const conversationResponse = {
                        _id: conversation._id,
                        participants: conversation.participants.map(p => ({
                            _id: p._id,
                            username: p.username,
                            firstName: p.firstName,
                            lastName: p.lastName,
                            avatar: p.avatar ? fixBase64Format(p.avatar) : p.avatar
                        })),
                        sessionId: sessionId
                    };

                    io.to(`conversation_${conversationId}`).emit('message_received', {
                        message: messageResponse,
                        conversation: conversationResponse
                    });

                    socket.emit('message_sent', {
                        messageId: messageId || savedMessage._id,
                        success: true,
                        timestamp: savedMessage.createdAt,
                        deliveryStatus: 'sent'
                    });

                    logger.info(`Message sent from ${socket.userId} to conversation ${conversationId}. Type: ${messageType}, FileSize: ${processedFileData?.size || 0}`);

                    setTimeout(async () => {
                        try {
                            savedMessage.metadata.deliveryStatus = 'delivered';
                            savedMessage.metadata.deliveredAt = new Date();
                            await savedMessage.save();

                            socket.emit('message_delivered', {
                                messageId: savedMessage.messageId || savedMessage._id,
                                deliveryStatus: 'delivered'
                            });

                            const otherParticipants = conversation.participants.filter(p =>
                                p._id.toString() !== socket.userId
                            );

                            for (const participant of otherParticipants) {
                                const unreadCount = await Message.countDocuments({
                                    sender: socket.userId,
                                    conversation: conversationId,
                                    'readBy.user': { $ne: participant._id },
                                    isDeleted: false,
                                    'deletedFor.user': { $ne: participant._id }
                                });
                                io.to(`user_${participant._id}`).emit('unread_count_updated', {
                                    senderId: socket.userId,
                                    senderInfo: {
                                        _id: socket.user._id,
                                        username: socket.user.username,
                                        firstName: socket.user.firstName,
                                        lastName: socket.user.lastName,
                                        avatar: socket.user.avatar ? fixBase64Format(socket.user.avatar) : socket.user.avatar
                                    },
                                    conversationId: conversationId,
                                    unreadCount: unreadCount
                                });
                            }

                        } catch (error) {
                            logger.error('Delivery status update error:', error);
                        }
                    }, 100);

                } catch (error) {
                    logger.error('Send message error:', error);
                    socket.emit('error', {
                        message: 'Error sending message',
                        details: error.message
                    });
                }
            });

            socket.on('delete_message', async (data) => {
                try {
                    const { messageId, deleteType, conversationId } = data;

                    const message = await Message.findById(messageId)
                        .populate('conversation');

                    if (!message) {
                        socket.emit('error', { message: 'Message not found' });
                        return;
                    }

                    const hasAccess = message.conversation.participants.includes(socket.userId);
                    if (!hasAccess) {
                        socket.emit('error', { message: 'Access denied' });
                        return;
                    }

                    if (deleteType === 'forEveryone') {
                        if (message.sender.toString() !== socket.userId) {
                            socket.emit('error', { message: 'Only sender can delete for everyone' });
                            return;
                        }
                        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                        if (message.createdAt < oneHourAgo) {
                            socket.emit('error', { message: 'Message can only be deleted for everyone within 1 hour' });
                            return;
                        }
                        await message.deleteForUser(socket.userId, 'forEveryone');
                        io.to(`conversation_${conversationId}`).emit('message_deleted_for_everyone', {
                            messageId: messageId,
                            deletedBy: socket.userId,
                            deletedAt: new Date()
                        });

                    } else {
                        await message.deleteForUser(socket.userId, 'forMe');
                        socket.emit('message_deleted_for_me', {
                            messageId: messageId,
                            deletedAt: new Date()
                        });
                    }

                    logger.info(`Message ${messageId} deleted by ${socket.userId} (${deleteType})`);

                } catch (error) {
                    logger.error('Delete message error:', error);
                    socket.emit('error', { message: 'Error deleting message' });
                }
            });

            socket.on('typing_start', (data) => {
                try {
                    const { conversationId, sessionId } = data;

                    if (!sessionId) {
                        return;
                    }

                    socket.to(`conversation_${conversationId}`).emit('user_typing', {
                        userId: socket.userId,
                        username: socket.user.username,
                        isTyping: true,
                        sessionId: sessionId
                    });
                } catch (error) {
                }
            });

            socket.on('typing_stop', (data) => {
                try {
                    const { conversationId, sessionId } = data;

                    if (!sessionId) {
                        return;
                    }
                    socket.to(`conversation_${conversationId}`).emit('user_stop_typing', {
                        userId: socket.userId,
                        username: socket.user.username,
                        isTyping: false,
                        sessionId: sessionId
                    });
                } catch (error) {
                }
            });

            socket.on('mark_messages_read', async (data) => {
                try {
                    const { messageIds, conversationId, sessionId } = data;

                    if (!sessionId || !messageIds || !Array.isArray(messageIds)) {
                        return;
                    }
                    const conversation = await Conversation.findOne({
                        _id: conversationId,
                        participants: socket.userId
                    }).populate('participants', '_id username firstName lastName avatar');

                    if (!conversation) {
                        return;
                    }
                    const result = await Message.updateMany(
                        {
                            _id: { $in: messageIds },
                            conversation: conversationId,
                            'readBy.user': { $ne: socket.userId },
                            isDeleted: false,
                            'deletedFor.user': { $ne: socket.userId }
                        },
                        {
                            $push: {
                                readBy: {
                                    user: socket.userId,
                                    readAt: new Date(),
                                    sessionId: sessionId
                                }
                            },
                            $set: {
                                'metadata.deliveryStatus': 'read',
                                'metadata.readAt': new Date()
                            }
                        }
                    );

                    if (result.modifiedCount > 0) {
                        socket.to(`conversation_${conversationId}`).emit('messages_read', {
                            userId: socket.userId,
                            messageIds: messageIds,
                            sessionId: sessionId,
                            readAt: new Date()
                        });

                        const readMessages = await Message.find({
                            _id: { $in: messageIds },
                            conversation: conversationId
                        }).select('sender messageId');

                        readMessages.forEach(msg => {
                            if (msg.sender.toString() !== socket.userId) {
                                io.to(`user_${msg.sender}`).emit('message_read_receipt', {
                                    messageId: msg.messageId || msg._id,
                                    readBy: socket.userId,
                                    readAt: new Date(),
                                    conversationId: conversationId
                                });
                            }
                        });

                        const uniqueSenders = [...new Set(readMessages.map(msg => msg.sender.toString()))];

                        for (const senderId of uniqueSenders) {
                            if (senderId !== socket.userId) {
                                const newUnreadCount = await Message.countDocuments({
                                    sender: senderId,
                                    conversation: conversationId,
                                    'readBy.user': { $ne: socket.userId },
                                    isDeleted: false,
                                    'deletedFor.user': { $ne: socket.userId }
                                });

                                let senderInfo = conversation.participants.find(p =>
                                    p._id.toString() === senderId
                                );

                                if (senderInfo && senderInfo.avatar) {
                                    senderInfo = {
                                        ...senderInfo.toObject(),
                                        avatar: fixBase64Format(senderInfo.avatar)
                                    };
                                }

                                socket.emit('unread_count_updated', {
                                    senderId: senderId,
                                    senderInfo: senderInfo,
                                    conversationId: conversationId,
                                    unreadCount: newUnreadCount
                                });
                            }
                        }

                        logger.info(`User ${socket.userId} marked ${result.modifiedCount} messages as read`);
                    }

                } catch (error) {
                    logger.error('Mark messages read error:', error);
                }
            });

            socket.on('delete_multiple_messages', async (data) => {
                try {
                    const { messageIds, conversationId } = data;
                    if (!Array.isArray(messageIds) || messageIds.length === 0) {
                        socket.emit('error', { message: 'Invalid message IDs' });
                        return;
                    }
                    const conversation = await Conversation.findOne({
                        _id: conversationId,
                        participants: socket.userId
                    });
                    if (!conversation) {
                        socket.emit('error', { message: 'Conversation not found' });
                        return;
                    }

                    let deletedCount = 0;
                    const deletedMessageIds = [];

                    for (const messageId of messageIds) {
                        try {
                            const message = await Message.findById(messageId);

                            if (message && message.conversation.toString() === conversationId) {
                                await message.deleteForUser(socket.userId, 'forMe');
                                deletedCount++;
                                deletedMessageIds.push(messageId);
                            }
                        } catch (error) {
                            logger.error(`Error deleting message ${messageId}:`, error);
                        }
                    }
                    socket.emit('multiple_messages_deleted', {
                        deletedMessageIds: deletedMessageIds,
                        deletedCount: deletedCount,
                        totalRequested: messageIds.length
                    });

                    logger.info(`User ${socket.userId} deleted ${deletedCount} messages from conversation ${conversationId}`);

                } catch (error) {
                    logger.error('Delete multiple messages error:', error);
                    socket.emit('error', { message: 'Error deleting messages' });
                }
            });

            socket.on('disconnect', async (reason) => {
                try {
                    await setUserOffline(socket.userId);

                    await User.findByIdAndUpdate(socket.userId, {
                        lastSeen: new Date()
                    });

                    const onlineUsers = await getOnlineUsers();
                    socket.broadcast.emit('user_offline', {
                        userId: socket.userId,
                        username: socket.user.username,
                        lastSeen: new Date(),
                        onlineCount: onlineUsers.length
                    });

                    logger.info(`User ${socket.user.username} disconnected: ${reason}`);
                } catch (error) {
                    logger.error('Disconnect error:', error);
                }
            });

            socket.on('error', (error) => {
                logger.error('Socket error:', error);
                socket.emit('error', {
                    message: 'Socket error occurred',
                    sessionId: socket.sessionId
                });
            });

        } catch (error) {
            logger.error('Socket connection error:', error);
            socket.emit('error', { message: 'Connection error' });
            socket.disconnect();
        }
    });

    io.on('error', (error) => {
        logger.error('Socket.IO server error:', error);
    });
};

module.exports = handleConnection;