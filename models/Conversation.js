const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],
    type: {
        type: String,
        enum: ['private', 'group'],
        default: 'private'
    },
    name: {
        type: String,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    avatar: {
        type: String,
        default: null
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastActivity: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);