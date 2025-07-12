require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const mongoose = require('mongoose');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const messageRoutes = require('./routes/message');
const conversationRoutes = require('./routes/conversation');

const socketHandler = require('./services/socketService');
const { startCronJobs } = require('./services/cronService');
const { connectRabbitMQ } = require('./services/queueService');
const { connectRedis } = require('./services/redisService');
const { decryptMiddleware, encryptMiddleware } = require('./middleware/auth');
const { setupSwagger } = require('./swagger');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production'
            ? ["http://localhost:3000", "http://localhost:3000"]
            : "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 120000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8,
    connectTimeout: 60000,
    upgradeTimeout: 30000,
    allowEIO3: true
});

app.set('trust proxy', 1);

app.use(compression());

const globalRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            success: false,
            message: 'Too many requests from this IP, please try again later'
        });
    }
});

app.use(globalRateLimit);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com"
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com"
            ],
            connectSrc: [
                "'self'",
                "ws:",
                "wss:",
                process.env.NODE_ENV === 'production'
                    ? "wss://localhost:3000"
                    : "ws://localhost:3000"
            ],
            imgSrc: ["'self'", "data:", "https:"],

            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        }
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "same-origin" }
}));

app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = process.env.NODE_ENV === 'production'
            ? ["https://localhost:3000", "http://localhost:3000"]
            : [undefined, "http://localhost:3000", "http://127.0.0.1:3000"];

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page']
}));

app.use(express.json({
    limit: '100mb',
    verify: (req, res, buf) => {
        try {
            JSON.parse(buf);
        } catch (e) {
            logger.warn(`Invalid JSON received from IP: ${req.ip}`);
            throw new Error('Invalid JSON');
        }
    }
}));
app.use(express.urlencoded({
    extended: true,
    limit: '100mb'
}));


app.use((req, res, next) => {
    const sessionId = req.header('X-Session-ID');
    if (sessionId) {
        req.sessionId = sessionId;
    }

    logger.info(`${req.method} ${req.path} - IP: ${req.ip} - UA: ${req.get('User-Agent')}`);

    next();
});

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use('/api', decryptMiddleware);
app.use('/api', encryptMiddleware);

app.use('/api', (req, res, next) => {
    if (req.body) {
        const sanitizeObject = (obj) => {
            for (let key in obj) {
                if (typeof obj[key] === 'string') {
                    obj[key] = obj[key].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                    obj[key] = obj[key].replace(/('|(\\)|;|--|\/\*|\*\/)/g, '');
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObject(obj[key]);
                }
            }
        };
        sanitizeObject(req.body);
    }
    next();
});


setupSwagger(app);


app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0',
        memory: process.memoryUsage(),
        pid: process.pid
    });
});

app.get('/metrics', (req, res) => {
    res.json({
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        timestamp: new Date().toISOString()
    });
});

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
    etag: true,
    lastModified: true
}));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/conversation', conversationRoutes);

app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.path,
        method: req.method
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({
            success: false,
            message: 'API endpoint not found'
        });
    }
});

app.use((error, req, res, next) => {
    logger.error('Unhandled error:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    const isDevelopment = process.env.NODE_ENV !== 'production';

    res.status(error.status || 500).json({
        success: false,
        message: isDevelopment ? error.message : 'Internal server error',
        ...(isDevelopment && {
            stack: error.stack,
            details: error
        })
    });
});

io.on('error', (error) => {
    logger.error('Socket.IO server error:', error);
});

socketHandler(io);

global.io = io;

const connectDB = async (retries = 5) => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        });
        logger.info('MongoDB connected successfully');
    } catch (err) {
        logger.error('MongoDB connection error:', err);
        if (retries > 0) {
            logger.info(`Retrying MongoDB connection... (${retries} attempts left)`);
            setTimeout(() => connectDB(retries - 1), 5000);
        } else {
            logger.error('Failed to connect to MongoDB after multiple attempts');
            process.exit(1);
        }
    }
};

connectDB();

mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error:', err);
});

async function initializeServices() {
    try {
        if (process.env.NODE_ENV !== 'test') {
            await connectRedis();
            await connectRabbitMQ();
            startCronJobs();
        }
        logger.info('All services initialized successfully');
    } catch (error) {
        logger.error('Service initialization error:', error);
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        } else {
            logger.warn('Continuing without external services in production mode');
        }
    }
}

const gracefulShutdown = (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);

    server.close(() => {
        logger.info('HTTP server closed');

        mongoose.connection.close(false, () => {
            logger.info('MongoDB connection closed');
            process.exit(0);
        });
    });

    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});

initializeServices();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    logger.info(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
    logger.info(`PID: ${process.pid}`);
    logger.info(`Memory usage: ${JSON.stringify(process.memoryUsage())}`);
});

module.exports = { app, server, io };