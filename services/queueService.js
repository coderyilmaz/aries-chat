const amqp = require('amqplib');
const logger = require('../utils/logger');
const Message = require('../models/Message');
const AutoMessage = require('../models/AutoMessage');
const Conversation = require('../models/Conversation');

let connection;
let channel;

const connectRabbitMQ = async () => {
    try {
        connection = await amqp.connect(process.env.RABBITMQ_URL);
        channel = await connection.createChannel();

        await channel.assertQueue('message_sending_queue', {
            durable: true
        });

        startConsumer();

        logger.info('RabbitMQ connected successfully');
    } catch (error) {
        logger.error('RabbitMQ connection error:', error);
        throw error;
    }
};

const publishToQueue = async (queueName, message) => {
    try {
        await channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
            persistent: true
        });
        logger.info(`Message published to queue: ${queueName}`);
    } catch (error) {
        logger.error('Error publishing to queue:', error);
    }
};

const startConsumer = async () => {
    try {
        await channel.consume('message_sending_queue', async (msg) => {
            if (msg) {
                try {
                    const messageData = JSON.parse(msg.content.toString());
                    await processAutoMessage(messageData);
                    channel.ack(msg);
                } catch (error) {
                    logger.error('Error processing message:', error);
                    channel.nack(msg, false, false);
                }
            }
        });
    } catch (error) {
        logger.error('Error starting consumer:', error);
    }
};

const processAutoMessage = async (data) => {
    try {
        const { autoMessageId } = data;
        const autoMessage = await AutoMessage.findById(autoMessageId)
            .populate('sender recipient');

        if (!autoMessage || autoMessage.isSent) {
            return;
        }

        let conversation = await Conversation.findOne({
            participants: { $all: [autoMessage.sender._id, autoMessage.recipient._id] },
            type: 'private'
        });

        if (!conversation) {
            conversation = new Conversation({
                participants: [autoMessage.sender._id, autoMessage.recipient._id],
                type: 'private'
            });
            await conversation.save();
        }

        const newMessage = new Message({
            sender: autoMessage.sender._id,
            conversation: conversation._id,
            content: autoMessage.content,
            type: 'text'
        });

        await newMessage.save();

        conversation.lastMessage = newMessage._id;
        conversation.lastActivity = new Date();
        await conversation.save();

        autoMessage.isSent = true;
        autoMessage.sentAt = new Date();
        autoMessage.conversation = conversation._id;
        await autoMessage.save();

        if (global.io) {
            global.io.to(`user_${autoMessage.recipient._id}`).emit('message_received', {
                message: newMessage,
                conversation: conversation,
                sender: autoMessage.sender
            });
        }

        logger.info(`Auto message sent from ${autoMessage.sender.username} to ${autoMessage.recipient.username}`);
    } catch (error) {
        logger.error('Error processing auto message:', error);
    }
};

module.exports = {
    connectRabbitMQ,
    publishToQueue,
    getChannel: () => channel
};