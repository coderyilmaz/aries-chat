const cron = require('node-cron');
const User = require('../models/User');
const AutoMessage = require('../models/AutoMessage');
const { publishToQueue } = require('./queueService');
const logger = require('../utils/logger');

const messageTemplates = [
    "Merhaba! Nasılsın?",
    "Bugün nasıl geçiyor?",
    "Seni merak ettim, ne yapıyorsun?",
    "Umarım güzel bir gün geçiriyorsundur!",
    "Selam! Keyifler nasıl?",
    "Hey! Uzun zamandır konuşmuyoruz.",
    "Nasıl gidiyor işler?",
    "Bugün nerelerdeydin?",
    "Hava çok güzel değil mi?",
    "Yakında görüşelim mi?"
];

const startCronJobs = () => {
    cron.schedule('0 2 * * *', async () => {
        try {
            logger.info('Starting automated message planning service...');
            await planAutomaticMessages();
        } catch (error) {
            logger.error('Error in message planning cron job:', error);
        }
    });
    cron.schedule('* * * * *', async () => {
        try {
            await processQueuedMessages();
        } catch (error) {
            logger.error('Error in queue management cron job:', error);
        }
    });

    logger.info('Cron jobs started successfully');
};

const planAutomaticMessages = async () => {
    try {
        const activeUsers = await User.find({ isActive: true }).select('_id username');
        if (activeUsers.length < 2) {
            logger.info('Not enough active users for message planning');
            return;
        }

        const shuffledUsers = shuffleArray([...activeUsers]);

        const pairs = [];
        for (let i = 0; i < shuffledUsers.length - 1; i += 2) {
            if (shuffledUsers[i + 1]) {
                pairs.push([shuffledUsers[i], shuffledUsers[i + 1]]);
            }
        }

        const autoMessages = [];
        for (const [sender, recipient] of pairs) {
            const randomMessage = messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
            const sendDate = new Date(Date.now() + Math.random() * 24 * 60 * 60 * 1000); // 24 saat içinde rastgele

            const autoMessage = new AutoMessage({
                sender: sender._id,
                recipient: recipient._id,
                content: randomMessage,
                sendDate: sendDate,
                isQueued: false,
                isSent: false
            });

            autoMessages.push(autoMessage);
        }

        await AutoMessage.insertMany(autoMessages);
        logger.info(`Planned ${autoMessages.length} automatic messages`);
    } catch (error) {
        logger.error('Error planning automatic messages:', error);
    }
};

const processQueuedMessages = async () => {
    try {
        const pendingMessages = await AutoMessage.find({
            sendDate: { $lte: new Date() },
            isQueued: false,
            isSent: false
        });

        for (const message of pendingMessages) {
            await publishToQueue('message_sending_queue', {
                autoMessageId: message._id
            });
            message.isQueued = true;
            message.queuedAt = new Date();
            await message.save();
        }

        if (pendingMessages.length > 0) {
            logger.info(`Queued ${pendingMessages.length} messages for sending`);
        }
    } catch (error) {
        logger.error('Error processing queued messages:', error);
    }
};

const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

module.exports = {
    startCronJobs
};