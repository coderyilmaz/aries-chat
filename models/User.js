const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { fixBase64Format } = require('../utils/base64Helper');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    firstName: {
        type: String,
        trim: true
    },
    lastName: {
        type: String,
        trim: true
    },
    avatar: {
        type: String,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastSeen: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }
    if (this.isModified('avatar') && this.avatar) {
        if (typeof this.avatar === 'string' && this.avatar.startsWith('data:image/')) {
            this.avatar = fixBase64Format(this.avatar);
        }
    }

    next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.getPublicData = function() {
    return {
        id: this._id,
        username: this.username,
        email: this.email,
        firstName: this.firstName,
        lastName: this.lastName,
        avatar: this.avatar ? fixBase64Format(this.avatar) : this.avatar,
        lastSeen: this.lastSeen,
        isActive: this.isActive,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
    };
};

userSchema.methods.getSafeData = function() {
    return {
        id: this._id,
        username: this.username,
        firstName: this.firstName,
        lastName: this.lastName,
        avatar: this.avatar ? fixBase64Format(this.avatar) : this.avatar,
        lastSeen: this.lastSeen,
        isActive: this.isActive
    };
};

userSchema.methods.updateAvatar = function(avatarData) {
    if (!avatarData) {
        this.avatar = null;
        return this;
    }

    if (typeof avatarData === 'string' && avatarData.startsWith('data:image/')) {
        this.avatar = fixBase64Format(avatarData);
    } else {
        this.avatar = avatarData;
    }

    return this;
};

userSchema.methods.fixAvatarFormat = function() {
    if (this.avatar && typeof this.avatar === 'string' && this.avatar.startsWith('data:image/')) {
        this.avatar = fixBase64Format(this.avatar);
    }
    return this;
};

userSchema.statics.fixAllAvatarFormats = async function() {
    const usersWithAvatars = await this.find({
        avatar: {
            $exists: true,
            $ne: null,
            $regex: '^data:image/'
        }
    });

    let fixedCount = 0;

    for (const user of usersWithAvatars) {
        try {
            const originalAvatar = user.avatar;

            if (originalAvatar && !originalAvatar.includes(';base64,') && originalAvatar.includes('base64,')) {
                user.avatar = fixBase64Format(originalAvatar);
                await user.save();
                fixedCount++;
            }
        } catch (error) {
            console.error(`Error fixing avatar for user ${user._id}:`, error);
        }
    }

    return {
        totalChecked: usersWithAvatars.length,
        fixed: fixedCount
    };
};

userSchema.statics.findByIdWithFixedAvatar = async function(userId) {
    const user = await this.findById(userId).select('-password');
    if (user && user.avatar) {
        user.avatar = fixBase64Format(user.avatar);
    }
    return user;
};

userSchema.statics.findWithFixedAvatars = async function(query = {}, options = {}) {
    const users = await this.find(query, null, options).select('-password');

    return users.map(user => {
        if (user.avatar) {
            user.avatar = fixBase64Format(user.avatar);
        }
        return user;
    });
};

userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.virtual('initials').get(function() {
    if (this.firstName && this.lastName) {
        return (this.firstName[0] + this.lastName[0]).toUpperCase();
    } else if (this.firstName) {
        return this.firstName[0].toUpperCase();
    } else if (this.username) {
        return this.username[0].toUpperCase();
    }
    return 'U';
});

userSchema.virtual('isOnline').get(function() {
    return false;
});

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ isActive: 1 });
userSchema.index({ lastSeen: -1 });
userSchema.index({ firstName: 1, lastName: 1 });

userSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        if (ret.avatar && typeof ret.avatar === 'string' && ret.avatar.startsWith('data:image/')) {
            ret.avatar = fixBase64Format(ret.avatar);
        }
        return ret;
    }
});

userSchema.set('toObject', {
    virtuals: true,
    transform: function(doc, ret) {
        if (ret.avatar && typeof ret.avatar === 'string' && ret.avatar.startsWith('data:image/')) {
            ret.avatar = fixBase64Format(ret.avatar);
        }
        return ret;
    }
});

module.exports = mongoose.model('User', userSchema);