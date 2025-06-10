// models/trait.js
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class TraitType {
    constructor(data) {
        this.id = data.id;
        this.breedId = data.breed_id;
        this.name = data.name;
        this.displayName = data.display_name;
        this.isGenetic = data.is_genetic;
        this.createdAt = data.created_at;
    }

    static async findByBreed(breedId) {
        const result = await pool.query(
            'SELECT * FROM animal_trait_types WHERE breed_id = $1 ORDER BY name',
            [breedId]
        );
        return result.rows.map(row => new TraitType(row));
    }

    static async findByName(breedId, name) {
        const result = await pool.query(
            'SELECT * FROM animal_trait_types WHERE breed_id = $1 AND name = $2',
            [breedId, name]
        );
        return result.rows.length > 0 ? new TraitType(result.rows[0]) : null;
    }

    async getValues() {
        const result = await pool.query(
            'SELECT * FROM animal_trait_values WHERE trait_type_id = $1 AND is_active = true ORDER BY rarity_level, display_name',
            [this.id]
        );

        return result.rows.map(row => new TraitValue(row));
    }

    toJSON() {
        return {
            id: this.id,
            breedId: this.breedId,
            name: this.name,
            displayName: this.displayName,
            isGenetic: this.isGenetic,
            createdAt: this.createdAt
        };
    }
}

class TraitValue {
    constructor(data) {
        this.id = data.id;
        this.traitTypeId = data.trait_type_id;
        this.value = data.value;
        this.displayName = data.display_name;
        this.rarityLevel = data.rarity_level;
        this.isActive = data.is_active;
        this.createdAt = data.created_at;
    }

    static async findByValue(traitTypeId, value) {
        const result = await pool.query(
            'SELECT * FROM animal_trait_values WHERE trait_type_id = $1 AND value = $2',
            [traitTypeId, value]
        );
        return result.rows.length > 0 ? new TraitValue(result.rows[0]) : null;
    }

    static async findByRarity(traitTypeId, rarityLevel) {
        const result = await pool.query(
            'SELECT * FROM animal_trait_values WHERE trait_type_id = $1 AND rarity_level = $2 AND is_active = true',
            [traitTypeId, rarityLevel]
        );
        return result.rows.map(row => new TraitValue(row));
    }

    toJSON() {
        return {
            id: this.id,
            traitTypeId: this.traitTypeId,
            value: this.value,
            displayName: this.displayName,
            rarityLevel: this.rarityLevel,
            isActive: this.isActive,
            createdAt: this.createdAt
        };
    }
}

module.exports = {
    TraitType,
    TraitValue
};