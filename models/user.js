const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const authConfig = require('../config/auth');

class User {
    constructor(data) {
        this.id = data.id;
        this.slUsername = data.sl_username;
        this.slUuid = data.sl_uuid;
        this.email = data.email;
        this.isVerified = data.is_verified;
        this.isActive = data.is_active;
        this.edenPoints = data.eden_points;
        this.createdAt = data.created_at;
        this.updatedAt = data.updated_at;
        this.lastLogin = data.last_login;
    }

    static async create({ slUsername, password, email }) {
        const hashedPassword = await bcrypt.hash(password, authConfig.bcrypt.saltRounds);
        
        const result = await pool.query(
            `INSERT INTO users (sl_username, password_hash, email, created_at, updated_at) 
             VALUES ($1, $2, $3, NOW(), NOW()) 
             RETURNING *`,
            [slUsername, hashedPassword, email]
        );

        return new User(result.rows[0]);
    }

    static async findBySlUsername(slUsername) {
        const result = await pool.query(
            'SELECT * FROM users WHERE sl_username = $1',
            [slUsername]
        );

        return result.rows.length > 0 ? new User(result.rows[0]) : null;
    }

    static async findById(id) {
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );

        return result.rows.length > 0 ? new User(result.rows[0]) : null;
    }

    static async findByVerificationCode(slUsername, verificationCode) {
        const result = await pool.query(
            `SELECT * FROM users 
             WHERE sl_username = $1 
             AND sl_verification_code = $2 
             AND sl_verification_expires > NOW() 
             AND is_verified = false`,
            [slUsername, verificationCode]
        );

        return result.rows.length > 0 ? new User(result.rows[0]) : null;
    }

    async setVerificationCode(code, expiresMinutes = 30) {
        const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
        
        await pool.query(
            `UPDATE users 
             SET sl_verification_code = $1, sl_verification_expires = $2, updated_at = NOW()
             WHERE id = $3`,
            [code, expiresAt, this.id]
        );

        return { code, expiresAt };
    }

    async verify(slUuid) {
        const result = await pool.query(
            `UPDATE users 
             SET is_verified = true, 
                 sl_uuid = $1, 
                 sl_verification_code = NULL, 
                 sl_verification_expires = NULL,
                 verified_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [slUuid, this.id]
        );

        const updatedUser = new User(result.rows[0]);
        Object.assign(this, updatedUser);
        return this;
    }

    async updateLastLogin() {
        await pool.query(
            'UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1',
            [this.id]
        );
        
        this.lastLogin = new Date();
        return this;
    }

    async validatePassword(password) {
        const result = await pool.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [this.id]
        );

        if (result.rows.length === 0) {
            return false;
        }

        return bcrypt.compare(password, result.rows[0].password_hash);
    }

    async updateEdenPoints(points) {
        const result = await pool.query(
            `UPDATE users 
             SET eden_points = COALESCE(eden_points, 0) + $1, updated_at = NOW()
             WHERE id = $2
             RETURNING eden_points`,
            [points, this.id]
        );

        this.edenPoints = result.rows[0].eden_points;
        return this.edenPoints;
    }

    toJSON() {
        return {
            id: this.id,
            slUsername: this.slUsername,
            slUuid: this.slUuid,
            email: this.email,
            isVerified: this.isVerified,
            isActive: this.isActive,
            edenPoints: this.edenPoints,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            lastLogin: this.lastLogin
        };
    }

    // Get public profile (without sensitive data)
    toPublicJSON() {
        return {
            id: this.id,
            slUsername: this.slUsername,
            isVerified: this.isVerified,
            edenPoints: this.edenPoints,
            createdAt: this.createdAt
        };
    }
}

module.exports = User;