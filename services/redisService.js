const redis = require('redis');
const logger = require('../utils/logger');

let redisClient;

const connectRedis = async () => {
    try {
        redisClient = redis.createClient({
            url: process.env.REDIS_URL
        });

        redisClient.on('error', (err) => {
            logger.error('Redis Client Error:', err);
        });

        redisClient.on('connect', () => {
            logger.info('Redis connected successfully');
        });

        await redisClient.connect();
    } catch (error) {
        logger.error('Redis connection error:', error);
        throw error;
    }
};

const setUserOnline = async (userId) => {
    try {
        await redisClient.sAdd('online_users', userId.toString());
        await redisClient.setEx(`user_last_seen:${userId}`, 3600, Date.now().toString());
    } catch (error) {
        logger.error('Error setting user online:', error);
    }
};

const setUserOffline = async (userId) => {
    try {
        await redisClient.sRem('online_users', userId.toString());
        await redisClient.setEx(`user_last_seen:${userId}`, 3600, Date.now().toString());
    } catch (error) {
        logger.error('Error setting user offline:', error);
    }
};

const getOnlineUsers = async () => {
    try {
        return await redisClient.sMembers('online_users');
    } catch (error) {
        logger.error('Error getting online users:', error);
        return [];
    }
};

const isUserOnline = async (userId) => {
    try {
        return await redisClient.sIsMember('online_users', userId.toString());
    } catch (error) {
        logger.error('Error checking if user online:', error);
        return false;
    }
};

const cacheConversation = async (conversationId, data) => {
    try {
        await redisClient.setEx(`conversation:${conversationId}`, 1800, JSON.stringify(data));
    } catch (error) {
        logger.error('Error caching conversation:', error);
    }
};

const getCachedConversation = async (conversationId) => {
    try {
        const data = await redisClient.get(`conversation:${conversationId}`);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        logger.error('Error getting cached conversation:', error);
        return null;
    }
};

module.exports = {
    connectRedis,
    setUserOnline,
    setUserOffline,
    getOnlineUsers,
    isUserOnline,
    cacheConversation,
    getCachedConversation,
    getClient: () => redisClient
};