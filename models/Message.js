const mongoose = require('mongoose');
const { fixBase64Format } = require('../utils/base64Helper');

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Conversation',
        required: true
    },
    content: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },
    type: {
        type: String,
        enum: ['text', 'image', 'file', 'video', 'audio', 'system'],
        default: 'text'
    },
    messageId: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    sessionId: {
        type: String,
        index: true
    },
    fileData: {
        name: {
            type: String,
            default: undefined
        },
        type: {
            type: String,
            default: undefined
        },
        size: {
            type: Number,
            min: 0,
            default: undefined
        },
        data: {
            type: String,
            default: undefined
        },
        url: {
            type: String,
            default: undefined
        },
        thumbnail: {
            type: String,
            default: undefined
        },
        duration: {
            type: Number,
            min: 0,
            default: undefined
        }
    },
    readBy: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        readAt: {
            type: Date,
            default: Date.now
        },
        sessionId: {
            type: String
        }
    }],
    deletedFor: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        deletedAt: {
            type: Date,
            default: Date.now
        },
        deleteType: {
            type: String,
            enum: ['forMe', 'forEveryone'],
            default: 'forMe'
        }
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    editedAt: {
        type: Date
    },
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    metadata: {
        encrypted: {
            type: Boolean,
            default: false
        },
        encryptionVersion: {
            type: String,
            default: '1.0'
        },
        clientInfo: {
            userAgent: String,
            platform: String,
            version: String
        },
        deliveryStatus: {
            type: String,
            enum: ['sent', 'delivered', 'read', 'failed'],
            default: 'sent'
        },
        sentAt: {
            type: Date,
            default: Date.now
        },
        deliveredAt: {
            type: Date
        },
        readAt: {
            type: Date
        }
    }
}, {
    timestamps: true
});

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ messageId: 1 }, { unique: true, sparse: true });
messageSchema.index({ sessionId: 1 });
messageSchema.index({ 'readBy.user': 1 });
messageSchema.index({ 'deletedFor.user': 1 });
messageSchema.index({ isDeleted: 1, createdAt: -1 });
messageSchema.index({ type: 1 });


messageSchema.virtual('isReadByUser').get(function() {
    return function(userId) {
        return this.readBy.some(read => read.user.toString() === userId.toString());
    };
});

messageSchema.virtual('isDeletedForUser').get(function() {
    return function(userId) {
        if (this.isDeleted) return true;
        return this.deletedFor.some(deleted => deleted.user.toString() === userId.toString());
    };
});

messageSchema.pre('save', function(next) {

    try {
        if (!this.messageId) {
            this.messageId = require('crypto').randomUUID();
        }
        if (this.fileData && (this.fileData.name || this.fileData.type || this.fileData.data)) {

            if (this.fileData.name !== undefined && this.fileData.name !== null) {
                this.fileData.name = String(this.fileData.name);
            }

            if (this.fileData.type !== undefined && this.fileData.type !== null) {
                this.fileData.type = String(this.fileData.type);
            }

            if (this.fileData.size !== undefined && this.fileData.size !== null) {
                const sizeValue = Number(this.fileData.size);
                if (!isNaN(sizeValue) && sizeValue >= 0) {
                    this.fileData.size = sizeValue;
                } else {
                    this.fileData.size = undefined;
                }
            }

            if (this.fileData.duration !== undefined && this.fileData.duration !== null) {
                const durationValue = Number(this.fileData.duration);
                if (!isNaN(durationValue) && durationValue >= 0) {
                    this.fileData.duration = durationValue;
                } else {
                    this.fileData.duration = undefined;
                }
            }

            if (this.fileData.url !== undefined && this.fileData.url !== null) {
                this.fileData.url = String(this.fileData.url);
            }

            if (this.fileData.data && typeof this.fileData.data === 'string') {
                const originalLength = this.fileData.data.length;
                this.fileData.data = fixBase64Format(this.fileData.data);
            }

            if (this.fileData.thumbnail && typeof this.fileData.thumbnail === 'string') {
                const originalLength = this.fileData.thumbnail.length;
                this.fileData.thumbnail = fixBase64Format(this.fileData.thumbnail);
            }

            if (this.fileData.data && (!this.fileData.size || this.fileData.size === 0)) {
                try {
                    const base64Data = this.fileData.data.includes(',')
                        ? this.fileData.data.split(',')[1]
                        : this.fileData.data;

                    const padding = (base64Data.match(/=/g) || []).length;
                    const calculatedSize = (base64Data.length * 3) / 4 - padding;

                    this.fileData.size = Math.round(calculatedSize);
                } catch (error) {
                    console.error('Error calculating file size:', error);
                }
            }
        }
        next();
    } catch (error) {
        console.error('Pre-save middleware error:', error);
        next(error);
    }
});

messageSchema.post('save', function(doc) {

});

messageSchema.methods.markAsRead = function(userId, sessionId) {
    const existingRead = this.readBy.find(read =>
        read.user.toString() === userId.toString()
    );

    if (!existingRead) {
        this.readBy.push({
            user: userId,
            readAt: new Date(),
            sessionId: sessionId
        });

        if (!this.metadata.readAt) {
            this.metadata.readAt = new Date();
        }
        this.metadata.deliveryStatus = 'read';
    }
    return this.save();
};

messageSchema.methods.deleteForUser = function(userId, deleteType = 'forMe') {
    if (deleteType === 'forEveryone') {
        if (this.sender.toString() !== userId.toString()) {
            throw new Error('Only sender can delete message for everyone');
        }
        this.isDeleted = true;
        this.deletedAt = new Date();
        this.deletedBy = userId;
    } else {
        const existingDelete = this.deletedFor.find(deleted =>
            deleted.user.toString() === userId.toString()
        );

        if (!existingDelete) {
            this.deletedFor.push({
                user: userId,
                deletedAt: new Date(),
                deleteType: deleteType
            });
        }
    }

    return this.save();
};

messageSchema.methods.getReadStatus = function(userId) {
    const readEntry = this.readBy.find(read =>
        read.user.toString() === userId.toString()
    );

    return readEntry ? {
        isRead: true,
        readAt: readEntry.readAt,
        sessionId: readEntry.sessionId
    } : {
        isRead: false,
        readAt: null,
        sessionId: null
    };
};

messageSchema.statics.markMultipleAsRead = function(messageIds, userId, sessionId) {
    return this.updateMany(
        {
            _id: { $in: messageIds },
            'readBy.user': { $ne: userId }
        },
        {
            $push: {
                readBy: {
                    user: userId,
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
};

messageSchema.statics.getUnreadCount = function(conversationId, userId) {
    return this.countDocuments({
        conversation: conversationId,
        sender: { $ne: userId },
        'readBy.user': { $ne: userId },
        isDeleted: false,
        'deletedFor.user': { $ne: userId }
    });
};

messageSchema.methods.isFile = function() {
    return ['file', 'image', 'video', 'audio'].includes(this.type);
};

messageSchema.methods.getFileSize = function() {
    if (!this.fileData || !this.fileData.size) return null;

    const bytes = this.fileData.size;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];

    if (bytes === 0) return '0 Bytes';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
};

messageSchema.methods.getFileDuration = function() {
    if (!this.fileData || !this.fileData.duration) return null;

    const duration = this.fileData.duration;
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

messageSchema.methods.generateThumbnail = function() {
    if (['image', 'video'].includes(this.type) && this.fileData && this.fileData.data) {
        this.fileData.thumbnail = fixBase64Format(this.fileData.data);
    }
};

messageSchema.methods.isMedia = function() {
    return ['image', 'video', 'audio'].includes(this.type);
};

messageSchema.methods.getMediaInfo = function() {
    if (!this.isMedia()) return null;

    return {
        type: this.type,
        name: this.fileData?.name,
        size: this.getFileSize(),
        duration: this.getFileDuration(),
        thumbnail: this.fileData?.thumbnail
    };
};

messageSchema.methods.fixFileDataFormat = function() {
    if (this.fileData) {
        if (this.fileData.data) {
            this.fileData.data = fixBase64Format(this.fileData.data);
        }
        if (this.fileData.thumbnail) {
            this.fileData.thumbnail = fixBase64Format(this.fileData.thumbnail);
        }
    }
    return this;
};

messageSchema.methods.validateFileData = function() {
    if (!this.isFile() || !this.fileData) {
        return { isValid: true };
    }

    const errors = [];
    if (!this.fileData.name) {
        errors.push('File name is required');
    }

    if (!this.fileData.type) {
        errors.push('File type is required');
    }

    if (!this.fileData.data) {
        errors.push('File data is required');
    }

    if (this.fileData.data && !this.fileData.data.startsWith('data:')) {
        errors.push('Invalid file data format');
    }

    if (this.fileData.size && this.fileData.size > 25 * 1024 * 1024) {
        errors.push('File size exceeds maximum limit (25MB)');
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
};

messageSchema.statics.fixAllFileDataFormats = async function() {
    const messagesWithFiles = await this.find({
        type: { $in: ['image', 'video', 'audio', 'file'] },
        'fileData.data': { $exists: true }
    });


    let fixedCount = 0;

    for (const message of messagesWithFiles) {
        try {
            let needsUpdate = false;

            if (message.fileData.data && !message.fileData.data.includes(';base64,')) {
                message.fileData.data = fixBase64Format(message.fileData.data);
                needsUpdate = true;
            }

            if (message.fileData.thumbnail && !message.fileData.thumbnail.includes(';base64,')) {
                message.fileData.thumbnail = fixBase64Format(message.fileData.thumbnail);
                needsUpdate = true;
            }

            if (needsUpdate) {
                await message.save();
                fixedCount++;
            }
        } catch (error) {
            console.error(`Error fixing message ${message._id}:`, error);
        }
    }

    return {
        totalChecked: messagesWithFiles.length,
        fixed: fixedCount
    };
};

module.exports = mongoose.model('Message', messageSchema);