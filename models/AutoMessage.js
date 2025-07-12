const mongoose = require('mongoose');

const autoMessageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    sendDate: {
        type: Date,
        required: true
    },
    isQueued: {
        type: Boolean,
        default: false
    },
    isSent: {
        type: Boolean,
        default: false
    },
    queuedAt: {
        type: Date
    },
    sentAt: {
        type: Date
    },
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation'
    }
}, {
    timestamps: true
});

autoMessageSchema.index({ sendDate: 1, isQueued: 1 });
autoMessageSchema.index({ isQueued: 1, isSent: 1 });

module.exports = mongoose.model('AutoMessage', autoMessageSchema);
