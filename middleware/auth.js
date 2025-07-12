const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const CryptoJS = require('crypto-js');

const decryptData = (encryptedData, key) => {
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, key || process.env.ENCRYPTION_KEY || 'default-fallback-key-not-secure');
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        return encryptedData;
    }
};

const encryptData = (data, key) => {
    try {
        return CryptoJS.AES.encrypt(data, key || process.env.ENCRYPTION_KEY || 'default-fallback-key-not-secure').toString();
    } catch (error) {
        return data;
    }
};

const auth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        const sessionId = req.header('X-Session-ID');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        if (!sessionId) {
            return res.status(401).json({
                success: false,
                message: 'Session ID required.'
            });
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');

            if (!user || !user.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token or user not found.'
                });
            }

            req.user = user;
            req.sessionId = sessionId;
            next();
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token.'
            });
        }
    } catch (error) {
        logger.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during authentication.'
        });
    }
};

const decryptMiddleware = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string' && req.body[key].length > 50) {
                try {
                    const decrypted = decryptData(req.body[key]);
                    if (decrypted && decrypted !== req.body[key]) {
                        req.body[key] = decrypted;
                    }
                } catch (error) {
                }
            }
        });
    }
    next();
};

const encryptMiddleware = (req, res, next) => {
    const originalSend = res.send;

    res.send = function(data) {
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                if (parsed.data && parsed.data.message && parsed.data.message.content) {
                    parsed.data.message.content = encryptData(parsed.data.message.content);
                    data = JSON.stringify(parsed);
                }
            } catch (error) {
            }
        }
        originalSend.call(this, data);
    };

    next();
};

module.exports = { auth, decryptMiddleware, encryptMiddleware };