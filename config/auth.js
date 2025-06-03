module.exports = {
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'
    },
    bcrypt: {
        saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12
    },
    verification: {
        codeExpiresMinutes: parseInt(process.env.VERIFICATION_CODE_EXPIRES_MINUTES) || 30,
        maxAttempts: 5
    },
    session: {
        expiresInDays: 7
    }
};