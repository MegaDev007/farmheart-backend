// models/animal.js
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class Animal {
    constructor(data) {
        this.id = data.id;
        this.slObjectKey = data.sl_object_key;
        this.slRegion = data.sl_region;
        this.slPosition = {
            x: data.sl_position_x,
            y: data.sl_position_y,
            z: data.sl_position_z
        };
        this.ownerId = data.owner_id;
        this.breedId = data.breed_id;
        this.breed = data.breed_name;
        this.name = data.name;
        this.gender = data.gender;
        this.birthDate = data.birth_date;
        this.maturityDate = data.maturity_date;
        this.deathDate = data.death_date;
        this.status = data.status;
        this.ageDays = data.age_days;
        this.hungerPercent = data.hunger_percent;
        this.happinessPercent = data.happiness_percent;
        this.heatPercent = data.heat_percent;
        this.isBreedable = data.is_breedable;
        this.breedingCount = data.breeding_count;
        this.lastBredAt = data.last_bred_at;
        this.isOperable = data.is_operable;
        this.animationsEnabled = data.animations_enabled;
        this.movementEnabled = data.movement_enabled;
        this.hovertextEnabled = data.hovertext_enabled;
        this.motherId = data.mother_id;
        this.fatherId = data.father_id;
        this.isTwin = data.is_twin;
        this.twinSiblingId = data.twin_sibling_id;
        this.createdAt = data.created_at;
        this.updatedAt = data.updated_at;
        this.lastSyncAt = data.last_sync_at;
        
        // Additional joined data
        this.ownerUsername = data.owner_username;
        this.traits = [];
        this.parents = {
            mother: null,
            father: null
        };
        this.offspring = [];
    }

    // Create new animal (when rezzed in SL)
    static async create(animalData) {
        const {
            slObjectKey,
            slRegion,
            slPosition,
            ownerId,
            breedId,
            name,
            gender,
            traits,
            motherId,
            fatherId,
            isTwin,
            twinSiblingId
        } = animalData;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Insert animal
            const animalResult = await client.query(
                `INSERT INTO animals (
                    sl_object_key, sl_region, sl_position_x, sl_position_y, sl_position_z,
                    owner_id, breed_id, name, gender, mother_id, father_id, is_twin, twin_sibling_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *`,
                [
                    slObjectKey, slRegion, slPosition?.x, slPosition?.y, slPosition?.z,
                    ownerId, breedId, name, gender, motherId, fatherId, isTwin, twinSiblingId
                ]
            );

            const animal = new Animal(animalResult.rows[0]);

            // Insert traits if provided
            if (traits && traits.length > 0) {
                for (const trait of traits) {
                    await client.query(
                        `INSERT INTO animal_traits (animal_id, trait_type_id, trait_value_id, inherited_from)
                         VALUES ($1, $2, $3, $4)`,
                        [animal.id, trait.traitTypeId, trait.traitValueId, trait.inheritedFrom]
                    );
                }
            }

            await client.query('COMMIT');
            
            logger.info('Animal created', { animalId: animal.id, slObjectKey, ownerId });
            return animal;

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error creating animal:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Find animal by SL object key
    static async findBySlObjectKey(slObjectKey) {
        const result = await pool.query(
            `SELECT a.*, ab.name as breed_name, u.sl_username as owner_username
             FROM animals a
             JOIN animal_breeds ab ON a.breed_id = ab.id
             JOIN users u ON a.owner_id = u.id
             WHERE a.sl_object_key = $1`,
            [slObjectKey]
        );

        if (result.rows.length === 0) return null;

        const animal = new Animal(result.rows[0]);
        await animal.loadTraits();
        return animal;
    }

    // Find animals by owner
    static async findByOwner(ownerId, options = {}) {
        const {
            breed,
            status = 'alive',
            isBreedable,
            limit = 50,
            offset = 0,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = options;

        let query = `
            SELECT a.*, ab.name as breed_name, u.sl_username as owner_username
            FROM animals a
            JOIN animal_breeds ab ON a.breed_id = ab.id
            JOIN users u ON a.owner_id = u.id
            WHERE a.owner_id = $1 AND a.status = $2
        `;
        const params = [ownerId, status];
        let paramCount = 2;

        if (breed) {
            query += ` AND ab.name = $${++paramCount}`;
            params.push(breed);
        }

        if (isBreedable !== undefined) {
            query += ` AND a.is_breedable = $${++paramCount}`;
            params.push(isBreedable);
        }

        query += ` ORDER BY a.${sortBy} ${sortOrder} LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        
        const animals = result.rows.map(row => new Animal(row));
        
        // Load traits for each animal
        for (const animal of animals) {
            await animal.loadTraits();
        }

        return animals;
    }

    // Get animal count by owner
    static async getCountByOwner(ownerId, options = {}) {
        const { breed, status = 'alive', isBreedable } = options;

        let query = `
            SELECT COUNT(*) 
            FROM animals a
            JOIN animal_breeds ab ON a.breed_id = ab.id
            WHERE a.owner_id = $1 AND a.status = $2
        `;
        const params = [ownerId, status];
        let paramCount = 2;

        if (breed) {
            query += ` AND ab.name = $${++paramCount}`;
            params.push(breed);
        }

        if (isBreedable !== undefined) {
            query += ` AND a.is_breedable = $${++paramCount}`;
            params.push(isBreedable);
        }

        const result = await pool.query(query, params);
        return parseInt(result.rows[0].count);
    }

    // Update animal stats (called from SL)
    async updateStats(stats) {
        const {
            hungerPercent,
            happinessPercent,
            heatPercent,
            ageDays,
            isBreedable,
            isOperable,
            slRegion,
            slPosition
        } = stats;

        const result = await pool.query(
            `UPDATE animals SET 
                hunger_percent = COALESCE($1, hunger_percent),
                happiness_percent = COALESCE($2, happiness_percent),
                heat_percent = COALESCE($3, heat_percent),
                age_days = COALESCE($4, age_days),
                is_breedable = COALESCE($5, is_breedable),
                is_operable = COALESCE($6, is_operable),
                sl_region = COALESCE($7, sl_region),
                sl_position_x = COALESCE($8, sl_position_x),
                sl_position_y = COALESCE($9, sl_position_y),
                sl_position_z = COALESCE($10, sl_position_z),
                last_sync_at = NOW(),
                updated_at = NOW()
             WHERE id = $11
             RETURNING *`,
            [
                hungerPercent, happinessPercent, heatPercent, ageDays, 
                isBreedable, isOperable, slRegion, 
                slPosition?.x, slPosition?.y, slPosition?.z, 
                this.id
            ]
        );

        if (result.rows.length > 0) {
            Object.assign(this, new Animal(result.rows[0]));
            logger.info('Animal stats updated', { animalId: this.id, slObjectKey: this.slObjectKey });
        }

        return this;
    }

    // Update animal name
    async updateName(newName) {
        const result = await pool.query(
            `UPDATE animals SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [newName, this.id]
        );

        if (result.rows.length > 0) {
            this.name = newName;
            this.updatedAt = result.rows[0].updated_at;
        }

        return this;
    }

    // Send animal to Eden (delete)
    async sendToEden() {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Calculate Eden points based on age
            const basePoints = 100;
            const ageBonus = Math.floor(this.ageDays / 10) * 5;
            const breedingBonus = this.breedingCount * 20;
            const totalPoints = basePoints + ageBonus + breedingBonus;

            // Add Eden points transaction
            await client.query(
                `INSERT INTO eden_transactions (user_id, animal_id, transaction_type, points_amount, description, reference_type, reference_id)
                 VALUES ($1, $2, 'earned', $3, $4, 'animal_eden', $5)`,
                [
                    this.ownerId, 
                    this.id, 
                    totalPoints, 
                    `Eden points for ${this.name} (Age: ${this.ageDays} days, Bred: ${this.breedingCount} times)`,
                    this.id
                ]
            );

            // Update user's Eden points
            await client.query(
                `UPDATE users SET eden_points = COALESCE(eden_points, 0) + $1 WHERE id = $2`,
                [totalPoints, this.ownerId]
            );

            // Update animal status
            await client.query(
                `UPDATE animals SET status = 'eden', death_date = NOW(), updated_at = NOW() WHERE id = $1`,
                [this.id]
            );

            await client.query('COMMIT');

            this.status = 'eden';
            this.deathDate = new Date();

            logger.info('Animal sent to Eden', { 
                animalId: this.id, 
                ownerId: this.ownerId, 
                pointsEarned: totalPoints 
            });

            return { pointsEarned: totalPoints };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error sending animal to Eden:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Convert to pet status
    async convertToPet() {
        const result = await pool.query(
            `UPDATE animals SET 
                status = 'pet', 
                is_breedable = false, 
                heat_percent = 0,
                updated_at = NOW() 
             WHERE id = $1 
             RETURNING *`,
            [this.id]
        );

        if (result.rows.length > 0) {
            Object.assign(this, new Animal(result.rows[0]));
            logger.info('Animal converted to pet', { animalId: this.id });
        }

        return this;
    }

    // Load animal traits
    async loadTraits() {
        const result = await pool.query(
            `SELECT at.*, att.name as trait_type, att.display_name as trait_type_display,
                    atv.value as trait_value, atv.display_name as trait_value_display,
                    atv.rarity_level
             FROM animal_traits at
             JOIN animal_trait_types att ON at.trait_type_id = att.id
             JOIN animal_trait_values atv ON at.trait_value_id = atv.id
             WHERE at.animal_id = $1
             ORDER BY att.name`,
            [this.id]
        );

        this.traits = result.rows.map(row => ({
            id: row.id,
            traitType: row.trait_type,
            traitTypeDisplay: row.trait_type_display,
            traitValue: row.trait_value,
            traitValueDisplay: row.trait_value_display,
            rarityLevel: row.rarity_level,
            inheritedFrom: row.inherited_from
        }));

        return this.traits;
    }

    // Load parent information
    async loadParents() {
        if (this.motherId || this.fatherId) {
            const result = await pool.query(
                `SELECT id, name, sl_object_key, 'mother' as parent_type FROM animals WHERE id = $1
                 UNION ALL
                 SELECT id, name, sl_object_key, 'father' as parent_type FROM animals WHERE id = $2`,
                [this.motherId, this.fatherId]
            );

            result.rows.forEach(row => {
                if (row.parent_type === 'mother') {
                    this.parents.mother = {
                        id: row.id,
                        name: row.name,
                        slObjectKey: row.sl_object_key
                    };
                } else {
                    this.parents.father = {
                        id: row.id,
                        name: row.name,
                        slObjectKey: row.sl_object_key
                    };
                }
            });
        }

        return this.parents;
    }

    // Load offspring
    async loadOffspring() {
        const result = await pool.query(
            `SELECT id, name, sl_object_key, gender, birth_date, status
             FROM animals 
             WHERE mother_id = $1 OR father_id = $1
             ORDER BY birth_date DESC`,
            [this.id]
        );

        this.offspring = result.rows.map(row => ({
            id: row.id,
            name: row.name,
            slObjectKey: row.sl_object_key,
            gender: row.gender,
            birthDate: row.birth_date,
            status: row.status
        }));

        return this.offspring;
    }

    // Get breeding history
    async getBreedingHistory() {
        const result = await pool.query(
            `SELECT br.*, 
                    m.name as mother_name, f.name as father_name,
                    COUNT(births.id) as offspring_count
             FROM breeding_records br
             LEFT JOIN animals m ON br.mother_id = m.id
             LEFT JOIN animals f ON br.father_id = f.id
             LEFT JOIN birth_records births ON br.id = births.breeding_record_id
             WHERE br.mother_id = $1 OR br.father_id = $1
             GROUP BY br.id, m.name, f.name
             ORDER BY br.bred_at DESC`,
            [this.id]
        );

        return result.rows.map(row => ({
            id: row.id,
            motherName: row.mother_name,
            fatherName: row.father_name,
            bredAt: row.bred_at,
            gestationCompleteAt: row.gestation_complete_at,
            isTwins: row.is_twins,
            offspringCount: parseInt(row.offspring_count),
            breedingRegion: row.breeding_region
        }));
    }

    // Calculate breeding eligibility
    isEligibleForBreeding() {
        return (
            this.status === 'alive' &&
            this.isBreedable &&
            this.heatPercent >= 100 &&
            this.happinessPercent >= 95 &&
            this.hungerPercent <= 5 &&
            this.isOperable &&
            this.breedingCount < 18 // Max breeding count for females
        );
    }

    // Get detailed stats for display
    getDetailedStats() {
        return {
            basic: {
                id: this.id,
                name: this.name,
                breed: this.breed,
                gender: this.gender,
                ageDays: this.ageDays,
                status: this.status
            },
            vitals: {
                hunger: this.hungerPercent,
                happiness: this.happinessPercent,
                heat: this.heatPercent,
                isOperable: this.isOperable
            },
            breeding: {
                isBreedable: this.isBreedable,
                breedingCount: this.breedingCount,
                lastBredAt: this.lastBredAt,
                isEligible: this.isEligibleForBreeding()
            },
            settings: {
                animationsEnabled: this.animationsEnabled,
                movementEnabled: this.movementEnabled,
                hovertextEnabled: this.hovertextEnabled
            },
            location: {
                region: this.slRegion,
                position: this.slPosition
            },
            family: {
                motherId: this.motherId,
                fatherId: this.fatherId,
                isTwin: this.isTwin,
                twinSiblingId: this.twinSiblingId
            },
            traits: this.traits,
            timestamps: {
                birthDate: this.birthDate,
                maturityDate: this.maturityDate,
                createdAt: this.createdAt,
                lastSyncAt: this.lastSyncAt
            }
        };
    }

    // Convert to JSON for API responses
    toJSON() {
        return {
            id: this.id,
            slObjectKey: this.slObjectKey,
            slRegion: this.slRegion,
            slPosition: this.slPosition,
            ownerId: this.ownerId,
            ownerUsername: this.ownerUsername,
            breed: this.breed,
            name: this.name,
            gender: this.gender,
            birthDate: this.birthDate,
            maturityDate: this.maturityDate,
            status: this.status,
            ageDays: this.ageDays,
            stats: {
                hunger: this.hungerPercent,
                happiness: this.happinessPercent,
                heat: this.heatPercent
            },
            breeding: {
                isBreedable: this.isBreedable,
                breedingCount: this.breedingCount,
                lastBredAt: this.lastBredAt,
                isEligible: this.isEligibleForBreeding()
            },
            settings: {
                isOperable: this.isOperable,
                animationsEnabled: this.animationsEnabled,
                movementEnabled: this.movementEnabled,
                hovertextEnabled: this.hovertextEnabled
            },
            family: {
                motherId: this.motherId,
                fatherId: this.fatherId,
                isTwin: this.isTwin,
                twinSiblingId: this.twinSiblingId,
                parents: this.parents,
                offspring: this.offspring
            },
            traits: this.traits,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            lastSyncAt: this.lastSyncAt
        };
    }

    // Convert to minimal JSON for lists
    toMinimalJSON() {
        return {
            id: this.id,
            slObjectKey: this.slObjectKey,
            name: this.name,
            breed: this.breed,
            gender: this.gender,
            ageDays: this.ageDays,
            status: this.status,
            stats: {
                hunger: this.hungerPercent,
                happiness: this.happinessPercent,
                heat: this.heatPercent
            },
            isBreedable: this.isBreedable,
            isOperable: this.isOperable,
            createdAt: this.createdAt,
            lastSyncAt: this.lastSyncAt
        };
    }

    // Static method to get all animals by region
    static async findByRegion(region, limit = 50) {
        const result = await pool.query(
            `SELECT a.*, ab.name as breed_name, u.sl_username as owner_username
             FROM animals a
             JOIN animal_breeds ab ON a.breed_id = ab.id
             JOIN users u ON a.owner_id = u.id
             WHERE a.sl_region = $1 AND a.status = 'alive'
             ORDER BY a.last_sync_at DESC
             LIMIT $2`,
            [region, limit]
        );

        return result.rows.map(row => new Animal(row));
    }

    // Static method to get breeding statistics
    static async getGlobalBreedingStats() {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_breedings,
                COUNT(*) FILTER (WHERE is_twins = true) as twin_breedings,
                AVG(EXTRACT(EPOCH FROM (gestation_complete_at - bred_at))/86400) as avg_gestation_days,
                DATE_TRUNC('month', bred_at) as month,
                COUNT(*) as monthly_count
             FROM breeding_records 
             WHERE bred_at >= NOW() - INTERVAL '12 months'
             GROUP BY DATE_TRUNC('month', bred_at)
             ORDER BY month DESC`
        );

        return {
            totalBreedings: result.rows.length > 0 ? parseInt(result.rows[0].total_breedings) : 0,
            twinBreedings: result.rows.length > 0 ? parseInt(result.rows[0].twin_breedings) : 0,
            averageGestationDays: result.rows.length > 0 ? parseFloat(result.rows[0].avg_gestation_days) : 0,
            monthlyStats: result.rows.map(row => ({
                month: row.month,
                count: parseInt(row.monthly_count)
            }))
        };
    }

    // Static method to get animals needing attention
    static async findAnimalsNeedingAttention(ownerId) {
        const result = await pool.query(
            `SELECT a.*, ab.name as breed_name
             FROM animals a
             JOIN animal_breeds ab ON a.breed_id = ab.id
             WHERE a.owner_id = $1 
               AND a.status = 'alive'
               AND (
                   a.hunger_percent >= 95 OR
                   a.happiness_percent <= 10 OR
                   NOT a.is_operable
               )
             ORDER BY a.hunger_percent DESC, a.happiness_percent ASC`,
            [ownerId]
        );

        return result.rows.map(row => {
            const animal = new Animal(row);
            const alerts = [];

            if (animal.hungerPercent >= 95) {
                alerts.push({
                    type: 'critical_hunger',
                    severity: 'high',
                    message: `${animal.name} is critically hungry (${animal.hungerPercent}%)`
                });
            }

            if (animal.happinessPercent <= 10) {
                alerts.push({
                    type: 'low_happiness',
                    severity: 'medium',
                    message: `${animal.name} has very low happiness (${animal.happinessPercent}%)`
                });
            }

            if (!animal.isOperable) {
                alerts.push({
                    type: 'inoperable',
                    severity: 'high',
                    message: `${animal.name} is inoperable and needs immediate attention`
                });
            }

            return {
                animal: animal.toMinimalJSON(),
                alerts
            };
        });
    }

    // Update multiple animals' stats efficiently
    static async bulkUpdateStats(updates) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const update of updates) {
                const { slObjectKey, stats } = update;
                
                await client.query(
                    `UPDATE animals SET 
                        hunger_percent = COALESCE($1, hunger_percent),
                        happiness_percent = COALESCE($2, happiness_percent),
                        heat_percent = COALESCE($3, heat_percent),
                        age_days = COALESCE($4, age_days),
                        is_breedable = COALESCE($5, is_breedable),
                        is_operable = COALESCE($6, is_operable),
                        last_sync_at = NOW(),
                        updated_at = NOW()
                     WHERE sl_object_key = $7`,
                    [
                        stats.hungerPercent,
                        stats.happinessPercent,
                        stats.heatPercent,
                        stats.ageDays,
                        stats.isBreedable,
                        stats.isOperable,
                        slObjectKey
                    ]
                );
            }

            await client.query('COMMIT');
            logger.info('Bulk stats update completed', { updateCount: updates.length });

            return { success: true, updatedCount: updates.length };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Bulk stats update failed:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Get animal statistics by breed
    static async getBreedStatistics(breedName) {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_animals,
                COUNT(*) FILTER (WHERE status = 'alive') as alive_animals,
                COUNT(*) FILTER (WHERE is_breedable = true AND status = 'alive') as breedable_animals,
                COUNT(*) FILTER (WHERE gender = 'male' AND status = 'alive') as male_animals,
                COUNT(*) FILTER (WHERE gender = 'female' AND status = 'alive') as female_animals,
                AVG(age_days) FILTER (WHERE status = 'alive') as average_age,
                AVG(breeding_count) FILTER (WHERE status = 'alive') as average_breeding_count,
                COUNT(DISTINCT owner_id) as unique_owners
             FROM animals a
             JOIN animal_breeds ab ON a.breed_id = ab.id
             WHERE ab.name = $1`,
            [breedName.toLowerCase()]
        );

        const stats = result.rows[0];

        return {
            breedName,
            totalAnimals: parseInt(stats.total_animals),
            aliveAnimals: parseInt(stats.alive_animals),
            breedableAnimals: parseInt(stats.breedable_animals),
            maleAnimals: parseInt(stats.male_animals),
            femaleAnimals: parseInt(stats.female_animals),
            averageAge: parseFloat(stats.average_age) || 0,
            averageBreedingCount: parseFloat(stats.average_breeding_count) || 0,
            uniqueOwners: parseInt(stats.unique_owners)
        };
    }

    // Archive old animals (soft delete for historical data)
    static async archiveOldAnimals(daysOld = 365) {
        const result = await pool.query(
            `UPDATE animals 
             SET status = 'archived', updated_at = NOW()
             WHERE status = 'eden' 
               AND death_date < NOW() - INTERVAL '$1 days'
             RETURNING id`,
            [daysOld]
        );

        logger.info('Old animals archived', { archivedCount: result.rowCount });
        return result.rowCount;
    }

    // Get performance metrics for monitoring
    static async getPerformanceMetrics() {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_animals,
                COUNT(*) FILTER (WHERE last_sync_at > NOW() - INTERVAL '1 hour') as recently_active,
                COUNT(*) FILTER (WHERE last_sync_at < NOW() - INTERVAL '24 hours' AND status = 'alive') as stale_animals,
                AVG(EXTRACT(EPOCH FROM (NOW() - last_sync_at))/3600) as avg_hours_since_sync
             FROM animals 
             WHERE status = 'alive'`
        );

        return {
            totalAnimals: parseInt(result.rows[0].total_animals),
            recentlyActive: parseInt(result.rows[0].recently_active),
            staleAnimals: parseInt(result.rows[0].stale_animals),
            averageHoursSinceSync: parseFloat(result.rows[0].avg_hours_since_sync) || 0
        };
    }
}

module.exports = Animal;