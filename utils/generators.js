const crypto = require('crypto');

const generateVerificationCode = (length = 6) => {
    return Math.random().toString(36).substring(2, length + 2).toUpperCase();
};

const generateSecureToken = (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
};

const generateUniqueId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const generateAnimalName = (breed = 'Horse') => {
    const prefixes = ['Star', 'Moon', 'Sun', 'Wind', 'Storm', 'Fire', 'Ice', 'Thunder'];
    const suffixes = ['runner', 'dancer', 'walker', 'jumper', 'spirit', 'heart', 'soul', 'wing'];
    
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    
    return `${prefix}${suffix}`;
};

module.exports = {
    generateVerificationCode,
    generateSecureToken,
    generateUniqueId,
    generateAnimalName
};
