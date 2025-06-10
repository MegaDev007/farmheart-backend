// models/breed.js
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class Breed {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.displayName = data.display_name;
        this.breedingMatureDays = data.breeding_mature_days;
        this.breedingActiveDays = data.breeding_active_days;
        this.femaleHeatDays = data.female_heat_days;
        this.maleHeatDays = data.male_heat_days;
        this.maxBreedingCount = data.max_breeding_count;
        this.foodBitesPerHour = data.food_bites_per_hour;
        this.isActive = data.is_active;
        this.createdAt = data.created_at;
    }

    static async findAll() {
        const result = await pool.query(
            'SELECT * FROM animal_breeds WHERE is_active = true ORDER BY display_name'
        );
        return result.rows.map(row => new Breed(row));
    }

    static async findByName(name) {
        const result = await pool.query(
            'SELECT * FROM animal_breeds WHERE name = $1 AND is_active = true',
            [name.toLowerCase()]
        );
        return result.rows.length > 0 ? new Breed(result.rows[0]) : null;
    }

    static async findById(id) {
        const result = await pool.query(
            'SELECT * FROM animal_breeds WHERE id = $1',
            [id]
        );
        return result.rows.length > 0 ? new Breed(result.rows[0]) : null;
    }

    async getTraitTypes() {
        const result = await pool.query(
            `SELECT att.*, 
                    COUNT(atv.id) as value_count
             FROM animal_trait_types att
             LEFT JOIN animal_trait_values atv ON att.id = atv.trait_type_id AND atv.is_active = true
             WHERE att.breed_id = $1
             GROUP BY att.id
             ORDER BY att.name`,
            [this.id]
        );

        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            displayName: row.display_name,
            isGenetic: row.is_genetic,
            valueCount: parseInt(row.value_count),
            createdAt: row.created_at
        }));
    }

    async getConsumableTypes() {
        const result = await pool.query(
            'SELECT * FROM consumable_types WHERE breed_id = $1 AND is_active = true ORDER BY name',
            [this.id]
        );

        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            displayName: row.display_name,
            effectType: row.effect_type,
            effectValue: row.effect_value,
            bitesPerUnit: row.bites_per_unit,
            costLindens: row.cost_lindens
        }));
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            displayName: this.displayName,
            breedingMatureDays: this.breedingMatureDays,
            breedingActiveDays: this.breedingActiveDays,
            femaleHeatDays: this.femaleHeatDays,
            maleHeatDays: this.maleHeatDays,
            maxBreedingCount: this.maxBreedingCount,
            foodBitesPerHour: this.foodBitesPerHour,
            isActive: this.isActive,
            createdAt: this.createdAt
        };
    }
}

module.exports = Breed;