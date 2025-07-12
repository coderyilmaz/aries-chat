const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { auth, decryptMiddleware } = require('../middleware/auth');
const { fixBase64Format } = require('../utils/base64Helper');
const logger = require('../utils/logger');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many authentication attempts' }
});

const generateTokens = (userId) => {
    const accessToken = jwt.sign(
        { id: userId },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
        { id: userId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
};

const prepareUserData = (user) => {
    return {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar ? fixBase64Format(user.avatar) : user.avatar,
        lastSeen: user.lastSeen
    };
};

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user account
 *     description: Create a new user account with email, username, and personal information
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserRegistration'
 *           example:
 *             username: "john_doe123"
 *             email: "john.doe@example.com"
 *             password: "securePassword123"
 *             firstName: "John"
 *             lastName: "Doe"
 *     responses:
 *       201:
 *         description: User registered successfully
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
 *                         tokens:
 *                           $ref: '#/components/schemas/AuthTokens'
 *             example:
 *               success: true
 *               message: "Kullanıcı başarıyla kaydedildi"
 *               data:
 *                 user:
 *                   id: "507f1f77bcf86cd799439011"
 *                   username: "john_doe123"
 *                   email: "john.doe@example.com"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   avatar: null
 *                   lastSeen: "2025-01-15T10:30:00.000Z"
 *                 tokens:
 *                   accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/register', authLimiter, [
    body('username')
        .isLength({ min: 3, max: 30 })
        .withMessage('Kullanıcı adı 3-30 karakter arasında olmalı')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir'),
    body('email')
        .isEmail()
        .withMessage('Geçerli bir e-posta adresi girin')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Şifre en az 6 karakter olmalı'),
    body('firstName')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Ad 1-50 karakter arasında olmalı'),
    body('lastName')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Soyad 1-50 karakter arasında olmalı')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Doğrulama başarısız',
                errors: errors.array()
            });
        }

        const { username, email, password, firstName, lastName } = req.body;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID gerekli'
            });
        }

        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            const field = existingUser.email === email ? 'e-posta' : 'kullanıcı adı';
            return res.status(400).json({
                success: false,
                message: `Bu ${field} zaten kullanılıyor`
            });
        }

        const user = new User({
            username: username.trim(),
            email: email.toLowerCase().trim(),
            password,
            firstName: firstName.trim(),
            lastName: lastName.trim()
        });

        await user.save();

        const { accessToken, refreshToken } = generateTokens(user._id);

        res.status(201).json({
            success: true,
            message: 'Kullanıcı başarıyla kaydedildi',
            data: {
                user: prepareUserData(user),
                tokens: {
                    accessToken,
                    refreshToken
                }
            }
        });

    } catch (error) {
        logger.error('Register error:', error);

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
            message: 'Sunucu hatası oluştu'
        });
    }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login to user account
 *     description: Authenticate user with email and password to get access tokens
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserLogin'
 *           example:
 *             email: "john.doe@example.com"
 *             password: "securePassword123"
 *     responses:
 *       200:
 *         description: Login successful
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
 *                         tokens:
 *                           $ref: '#/components/schemas/AuthTokens'
 *             example:
 *               success: true
 *               message: "Giriş başarılı"
 *               data:
 *                 user:
 *                   id: "507f1f77bcf86cd799439011"
 *                   username: "john_doe123"
 *                   email: "john.doe@example.com"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   avatar: null
 *                   lastSeen: "2025-01-15T10:30:00.000Z"
 *                 tokens:
 *                   accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidCredentials:
 *                 summary: Invalid email or password
 *                 value:
 *                   success: false
 *                   message: "E-posta veya şifre hatalı"
 *               inactiveAccount:
 *                 summary: Account is inactive
 *                 value:
 *                   success: false
 *                   message: "Hesap aktif değil"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/login', authLimiter, [
    body('email')
        .isEmail()
        .withMessage('Geçerli bir e-posta adresi girin')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 1 })
        .withMessage('Şifre gerekli')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Doğrulama başarısız',
                errors: errors.array()
            });
        }

        const { email, password } = req.body;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID gerekli'
            });
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'E-posta veya şifre hatalı'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Hesap aktif değil'
            });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'E-posta veya şifre hatalı'
            });
        }

        user.lastSeen = new Date();
        await user.save();

        const { accessToken, refreshToken } = generateTokens(user._id);
        res.json({
            success: true,
            message: 'Giriş başarılı',
            data: {
                user: prepareUserData(user),
                tokens: {
                    accessToken,
                    refreshToken
                }
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Sunucu hatası oluştu'
        });
    }
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Refresh access token
 *     description: Get new access and refresh tokens using a valid refresh token
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshToken'
 *           example:
 *             refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     responses:
 *       200:
 *         description: Tokens refreshed successfully
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
 *                         tokens:
 *                           $ref: '#/components/schemas/AuthTokens'
 *             example:
 *               success: true
 *               message: "Token refreshed successfully"
 *               data:
 *                 tokens:
 *                   accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                   refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         description: Invalid refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Invalid refresh token"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/refresh', [
    body('refreshToken').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token is required'
            });
        }

        const { refreshToken } = req.body;
        const sessionId = req.header('X-Session-ID');

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);

        res.json({
            success: true,
            message: 'Token refreshed successfully',
            data: {
                tokens: {
                    accessToken,
                    refreshToken: newRefreshToken
                }
            }
        });

    } catch (error) {
        logger.error('Refresh token error:', error);
        res.status(401).json({
            success: false,
            message: 'Invalid refresh token'
        });
    }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current user profile
 *     description: Retrieve the profile information of the currently authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
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
 *                           $ref: '#/components/schemas/User'
 *             example:
 *               success: true
 *               data:
 *                 user:
 *                   id: "507f1f77bcf86cd799439011"
 *                   username: "john_doe123"
 *                   email: "john.doe@example.com"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   avatar: null
 *                   lastSeen: "2025-01-15T10:30:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/me', auth, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: prepareUserData(req.user)
            }
        });
    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Logout from user account
 *     description: Logout the current user (client should discard tokens)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Logout successful"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/logout', auth, async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Logout successful'
        });
    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;