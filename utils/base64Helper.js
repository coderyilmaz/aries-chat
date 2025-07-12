const fixBase64Format = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return base64String;
    }

    try {
        if (base64String.startsWith('data:') && base64String.includes(';base64,')) {
            return base64String;
        }
        if (base64String.startsWith('data:') && base64String.includes('base64,') && !base64String.includes(';base64,')) {
            return base64String.replace('base64,', ';base64,');
        }
        if (base64String.startsWith('data:') && !base64String.includes('base64,')) {
            const colonIndex = base64String.indexOf(':');
            const commaIndex = base64String.indexOf(',');
            if (colonIndex !== -1 && commaIndex !== -1) {
                const mimeType = base64String.substring(colonIndex + 1, commaIndex);
                const data = base64String.substring(commaIndex + 1);
                return `data:${mimeType};base64,${data}`;
            }
        }

        if (!base64String.startsWith('data:')) {
            let mimeType = 'application/octet-stream';

            try {
                const decoded = atob(base64String.substring(0, Math.min(20, base64String.length)));
                const bytes = new Uint8Array(decoded.split('').map(c => c.charCodeAt(0)));

                if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
                    mimeType = 'image/jpeg';
                } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                    mimeType = 'image/png';
                } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
                    mimeType = 'image/gif';
                } else if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
                    mimeType = 'image/webp';
                }
            } catch (error) {
            }

            return `data:${mimeType};base64,${base64String}`;
        }

        return base64String;
    } catch (error) {
        return base64String;
    }
};

const isValidBase64Image = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return false;
    }

    try {
        if (!base64String.startsWith('data:image/')) {
            return false;
        }
        if (!base64String.includes(';base64,')) {
            return false;
        }
        const base64Data = extractBase64Data(base64String);
        if (!base64Data) {
            return false;
        }
        const testData = base64Data.substring(0, Math.min(100, base64Data.length));
        atob(testData);

        return true;
    } catch (error) {
        return false;
    }
};

const isValidBase64Video = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return false;
    }

    const videoPattern = /^data:video\/(mp4|avi|mov|wmv|webm|mkv|3gp|quicktime|x-msvideo);base64,/i;
    return videoPattern.test(base64String);
};

const isValidBase64Audio = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return false;
    }

    const audioPattern = /^data:audio\/(mpeg|wav|ogg|mp3|m4a|aac|flac);base64,/i;
    return audioPattern.test(base64String);
};

const getBase64Size = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return 0;
    }

    let base64Data = base64String;
    if (base64String.includes(',')) {
        base64Data = base64String.split(',')[1];
    }

    const padding = (base64Data.match(/=/g) || []).length;
    return (base64Data.length * 3) / 4 - padding;
};

const extractMimeType = (base64String) => {
    if (!base64String || typeof base64String !== 'string') {
        return null;
    }

    const match = base64String.match(/^data:([^;]+);base64,/);
    return match ? match[1] : null;
};

const extractBase64Data = (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
        return null;
    }
    try {
        const commaIndex = dataUrl.indexOf(',');
        if (commaIndex === -1) {
            return null;
        }

        const base64Part = dataUrl.substring(commaIndex + 1);

        if (base64Part.length === 0) {
            return null;
        }

        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Part)) {
            return null;
        }

        return base64Part;
    } catch (error) {
        return null;
    }
};

const validateFileSize = (base64String, fileType = 'file') => {
    const size = getBase64Size(base64String);

    const limits = {
        image: 5 * 1024 * 1024,
        video: 25 * 1024 * 1024,
        audio: 10 * 1024 * 1024,
        file: 10 * 1024 * 1024
    };

    const limit = limits[fileType] || limits.file;

    return {
        isValid: size <= limit,
        size: size,
        limit: limit,
        limitMB: Math.round(limit / (1024 * 1024))
    };
};

const isValidMimeType = (mimeType, expectedCategory) => {
    if (!mimeType || typeof mimeType !== 'string') {
        return false;
    }

    const allowedTypes = {
        image: [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
            'image/webp', 'image/bmp', 'image/svg+xml'
        ],
        video: [
            'video/mp4', 'video/avi', 'video/mov', 'video/wmv',
            'video/webm', 'video/mkv', 'video/3gp', 'video/quicktime',
            'video/x-msvideo'
        ],
        audio: [
            'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3',
            'audio/m4a', 'audio/aac', 'audio/flac'
        ],
        file: [
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain', 'text/csv',
            'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'
        ]
    };

    const validTypes = allowedTypes[expectedCategory] || [];
    return validTypes.includes(mimeType.toLowerCase());
};


const processBase64File = (base64Data, options = {}) => {
    const result = {
        isValid: false,
        data: null,
        error: null,
        size: 0,
        sizeFormatted: '0 Bytes',
        mimeType: null,
        maxSize: options.maxSize || 25 * 1024 * 1024,
        allowedTypes: options.allowedTypes || ['image', 'video', 'audio', 'file'],
        fixFormat: options.fixFormat !== false
    };

    try {

        if (typeof base64Data !== 'string') {
            result.error = 'Base64 data must be a string';
            return result;
        }

        if (!base64Data || base64Data.length === 0) {
            result.error = 'Base64 data is empty';
            return result;
        }

        let processedData = base64Data;
        if (result.fixFormat) {
            processedData = fixBase64Format(base64Data);
        }

        if (!processedData.startsWith('data:')) {
            result.error = 'Invalid base64 format - missing data: prefix';
            return result;
        }

        const mimeMatch = processedData.match(/^data:([^;]+)/);
        if (!mimeMatch) {
            result.error = 'Invalid base64 format - could not extract MIME type';
            return result;
        }

        result.mimeType = mimeMatch[1];

        const fileTypeCategory = getFileTypeCategory(result.mimeType);
        if (!result.allowedTypes.includes(fileTypeCategory)) {
            result.error = `File type ${fileTypeCategory} not allowed. Allowed types: ${result.allowedTypes.join(', ')}`;
            return result;
        }

        const base64DataPart = extractBase64Data(processedData);
        if (!base64DataPart) {
            result.error = 'Could not extract base64 data part';
            return result;
        }

        const padding = (base64DataPart.match(/=/g) || []).length;
        const calculatedSize = Math.round((base64DataPart.length * 3) / 4 - padding);

        result.size = calculatedSize;
        result.sizeFormatted = formatFileSize(calculatedSize);


        if (calculatedSize > result.maxSize) {
            const maxSizeFormatted = formatFileSize(result.maxSize);
            result.error = `File size (${result.sizeFormatted}) exceeds maximum allowed size (${maxSizeFormatted})`;
            return result;
        }

        try {
            const testData = base64DataPart.substring(0, Math.min(100, base64DataPart.length));
            atob(testData);
        } catch (decodeError) {
            result.error = 'Invalid base64 encoding - data corruption detected';
            return result;
        }

        result.isValid = true;
        result.data = processedData;
        result.error = null;

        return result;

    } catch (error) {
        result.error = `Processing error: ${error.message}`;
        return result;
    }
};

const getFileTypeCategory = (mimeType) => {
    if (!mimeType || typeof mimeType !== 'string') {
        return 'file';
    }

    const type = mimeType.toLowerCase();

    if (type.startsWith('image/')) {
        return 'image';
    } else if (type.startsWith('video/')) {
        return 'video';
    } else if (type.startsWith('audio/')) {
        return 'audio';
    } else {
        return 'file';
    }
};

const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes) || bytes <= 0) {
        return '0 Bytes';
    }
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    if (i >= sizes.length) {
        return 'File too large';
    }

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const sanitizeFileName = (fileName) => {
    if (!fileName || typeof fileName !== 'string') {
        return 'file';
    }

    let sanitized = fileName.replace(/[\/\\:*?"<>|]/g, '_');
    sanitized = sanitized.replace(/[\x00-\x1f\x80-\x9f]/g, '');

    if (sanitized.length > 255) {
        const ext = sanitized.slice(sanitized.lastIndexOf('.'));
        const name = sanitized.slice(0, 255 - ext.length);
        sanitized = name + ext;
    }

    if (sanitized.trim().length === 0) {
        sanitized = 'file';
    }

    return sanitized.trim();
};

const getExtensionFromMimeType = (mimeType) => {
    const mimeToExt = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'video/mp4': 'mp4',
        'video/avi': 'avi',
        'video/mov': 'mov',
        'video/wmv': 'wmv',
        'video/webm': 'webm',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/mp3': 'mp3',
        'audio/m4a': 'm4a',
        'application/pdf': 'pdf',
        'application/zip': 'zip',
        'text/plain': 'txt'
    };

    return mimeToExt[mimeType] || 'bin';
};

const validateFileData = (fileData, expectedType = 'file') => {
    const errors = [];

    if (!fileData) {
        errors.push('File data is required');
        return { isValid: false, errors };
    }

    if (!fileData.data) {
        errors.push('File data content is required');
    }

    if (!fileData.name) {
        errors.push('File name is required');
    }

    if (!fileData.type) {
        errors.push('File type is required');
    }

    if (typeof fileData.size !== 'number' || fileData.size <= 0) {
        errors.push('Valid file size is required');
    }

    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    const processResult = processBase64File(fileData.data, {
        maxSize: expectedType === 'video' ? 25 * 1024 * 1024 : 10 * 1024 * 1024,
        allowedTypes: expectedType === 'image' ? ['image'] :
            expectedType === 'video' ? ['video'] :
                expectedType === 'audio' ? ['audio'] :
                    ['image', 'video', 'audio', 'application', 'text'],
        fixFormat: true,
        strictValidation: true
    });

    if (!processResult.isValid) {
        errors.push(processResult.error);
        return {
            isValid: false,
            errors,
            size: processResult.size,
            maxSize: processResult.maxSize
        };
    }

    const sanitizedName = sanitizeFileName(fileData.name);
    if (sanitizedName !== fileData.name) {
        fileData.name = sanitizedName;
    }

    return {
        isValid: true,
        processedData: processResult.data,
        sanitizedName: sanitizedName,
        mimeType: processResult.mimeType,
        size: processResult.size,
        category: processResult.category
    };
};

module.exports = {
    fixBase64Format,
    isValidBase64Image,
    isValidBase64Video,
    isValidBase64Audio,
    getBase64Size,
    extractMimeType,
    extractBase64Data,
    validateFileSize,
    isValidMimeType,
    processBase64File,
    formatFileSize,
    sanitizeFileName,
    getExtensionFromMimeType,
    validateFileData,
    getFileTypeCategory
};