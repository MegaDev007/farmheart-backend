// services/animalService.js
const { pool } = require('../config/database');
const Animal = require('../models/animal');
const User = require('../models/user');
const logger = require('../utils/logger');

class AnimalService {

    // Register new animal from SL
    static async registerAnimal(animalData, slObjectKey) {
        try {
            const {
                ownerUsername,
                breedType,
                animalName,
                gender,
                slRegion,
                slPosition,
                traits,
                parentInfo
            } = animalData;

            // Find owner by SL username
            const owner = await User.findBySlUsername(ownerUsername);
            if (!owner) {
                throw new Error(`Owner not found: ${ownerUsername}`);
            }

            // Verify owner is verified
            if (!owner.isVerified) {
                throw new Error('Owner account is not verified');
            }

            // Get breed ID
            const breedResult = await pool.query(
                'SELECT id FROM animal_breeds WHERE name = $1',
                [breedType.toLowerCase()]
            );

            if (breedResult.rows.length === 0) {
                throw new Error(`Breed not found: ${breedType}`);
            }

            const breedId = breedResult.rows[0].id;

            // Check if animal already exists
            const existingAnimal = await Animal.findBySlObjectKey(slObjectKey);
            if (existingAnimal) {
                throw new Error('Animal already registered');
            }

            // Process traits data
            const processedTraits = await this.processAnimalTraits(traits, breedId);

            // Create animal
            const animal = await Animal.create({
                slObjectKey,
                slRegion,
                slPosition,
                ownerId: owner.id,
                breedId,
                name: animalName || '',
                gender,
                traits: processedTraits,
                motherId: parentInfo?.motherId || null,
                fatherId: parentInfo?.fatherId || null,
                isTwin: parentInfo?.isTwin || false,
                twinSiblingId: parentInfo?.twinSiblingId || null
            });

            logger.info('Animal registered successfully', {
                animalId: animal.id,
                slObjectKey,
                ownerUsername,
                breed: breedType
            });

            return animal;

        } catch (error) {
            logger.error('Error registering animal:', error);
            throw error;
        }
    }

    // Update animal stats from SL
    static async updateAnimalStats(slObjectKey, statsData) {
        try {
            const animal = await Animal.findBySlObjectKey(slObjectKey);
            if (!animal) {
                throw new Error('Animal not found');
            }

            await animal.updateStats(statsData);

            // Check for critical status changes
            await this.checkAnimalStatus(animal);

            return animal;

        } catch (error) {
            logger.error('Error updating animal stats:', error);
            throw error;
        }
    }

    // Process breeding event from SL
    static async processBreeding(breedingData) {
        const {
            motherSlObjectKey,
            fatherSlObjectKey,
            breedingRegion,
            isTwins,
            offspringData
        } = breedingData;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Find parent animals
            const mother = await Animal.findBySlObjectKey(motherSlObjectKey);
            const father = await Animal.findBySlObjectKey(fatherSlObjectKey);

            if (!mother || !father) {
                throw new Error('Parent animals not found');
            }

            // Verify both animals can breed
            if (!mother.isEligibleForBreeding() || !father.isEligibleForBreeding()) {
                throw new Error('One or both animals are not eligible for breeding');
            }

            // Create breeding record
            const breedingResult = await client.query(
                `INSERT INTO breeding_records (mother_id, father_id, breeding_region, is_twins)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [mother.id, father.id, breedingRegion, isTwins]
            );

            const breedingRecord = breedingResult.rows[0];

            // Update breeding counts
            await client.query(
                'UPDATE animals SET breeding_count = breeding_count + 1, last_bred_at = NOW() WHERE id IN ($1, $2)',
                [mother.id, father.id]
            );

            // Process offspring if provided
            const offspring = [];
            if (offspringData && offspringData.length > 0) {
                for (let i = 0; i < offspringData.length; i++) {
                    const offspringInfo = offspringData[i];
                    
                    // Register offspring animal
                    const offspringAnimal = await this.registerAnimal({
                        ownerUsername: mother.ownerUsername,
                        breedType: mother.breed,
                        animalName: offspringInfo.name,
                        gender: offspringInfo.gender,
                        slRegion: breedingRegion,
                        slPosition: offspringInfo.slPosition,
                        traits: offspringInfo.traits,
                        parentInfo: {
                            motherId: mother.id,
                            fatherId: father.id,
                            isTwin: isTwins,
                            twinSiblingId: isTwins && i === 0 ? null : offspring[0]?.id
                        }
                    }, offspringInfo.slObjectKey);

                    // Create birth record
                    await client.query(
                        `INSERT INTO birth_records (breeding_record_id, offspring_id, birth_order, birth_region)
                         VALUES ($1, $2, $3, $4)`,
                        [breedingRecord.id, offspringAnimal.id, i + 1, breedingRegion]
                    );

                    offspring.push(offspringAnimal);

                    // Update twin sibling reference if twins
                    if (isTwins && offspring.length === 2) {
                        await client.query(
                            'UPDATE animals SET twin_sibling_id = $1 WHERE id = $2',
                            [offspring[1].id, offspring[0].id]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            logger.info('Breeding processed successfully', {
                breedingRecordId: breedingRecord.id,
                motherId: mother.id,
                fatherId: father.id,
                isTwins,
                offspringCount: offspring.length
            });

            return {
                breedingRecord,
                offspring
            };

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error processing breeding:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Get animal dashboard data for owner
    static async getOwnerDashboard(ownerId, filters = {}) {
        try {
            const {
                breed,
                status = 'alive',
                breedingStatus,
                sortBy = 'created_at',
                sortOrder = 'DESC',
                page = 1,
                limit = 20
            } = filters;

            const offset = (page - 1) * limit;

            // Build filter options
            const filterOptions = {
                breed,
                status,
                isBreedable: breedingStatus === 'ready' ? true : 
                           breedingStatus === 'not_ready' ? false : undefined,
                limit,
                offset,
                sortBy,
                sortOrder
            };

            // Get animals and total count
            const [animals, totalCount] = await Promise.all([
                Animal.findByOwner(ownerId, filterOptions),
                Animal.getCountByOwner(ownerId, filterOptions)
            ]);

            // Get summary statistics
            const summaryStats = await this.getOwnerSummaryStats(ownerId);

            return {
                animals: animals.map(animal => animal.toMinimalJSON()),
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit)
                },
                summary: summaryStats
            };

        } catch (error) {
            logger.error('Error getting owner dashboard:', error);
            throw error;
        }
    }

    // Get detailed animal information
    static async getAnimalDetails(animalId, requestingUserId) {
        try {
            const result = await pool.query(
                `SELECT a.*, ab.name as breed_name, u.sl_username as owner_username
                 FROM animals a
                 JOIN animal_breeds ab ON a.breed_id = ab.id
                 JOIN users u ON a.owner_id = u.id
                 WHERE a.id = $1`,
                [animalId]
            );

            if (result.rows.length === 0) {
                throw new Error('Animal not found');
            }

            const animal = new Animal(result.rows[0]);

            // Check if requesting user is the owner
            if (animal.ownerId !== requestingUserId) {
                throw new Error('Access denied');
            }

            // Load additional data
            await Promise.all([
                animal.loadTraits(),
                animal.loadParents(),
                animal.loadOffspring()
            ]);

            // Get breeding history
            const breedingHistory = await animal.getBreedingHistory();

            return {
                animal: animal.getDetailedStats(),
                breedingHistory
            };

        } catch (error) {
            logger.error('Error getting animal details:', error);
            throw error;
        }
    }

    // Get breeding planner data
    static async getBreedingPlanner(ownerId, filters = {}) {
        try {
            const { breed } = filters;

            // Get breeding-ready animals
            const breedingReadyQuery = `
                SELECT a.*, ab.name as breed_name
                FROM animals a
                JOIN animal_breeds ab ON a.breed_id = ab.id
                WHERE a.owner_id = $1 
                  AND a.status = 'alive'
                  AND a.is_breedable = true
                  AND a.heat_percent >= 100
                  AND a.happiness_percent >= 95
                  AND a.hunger_percent <= 5
                  AND a.breeding_count < 18
                  ${breed ? 'AND ab.name = $2' : ''}
                ORDER BY a.heat_percent DESC, a.happiness_percent DESC
            `;

            const params = [ownerId];
            if (breed) params.push(breed);

            const breedingReadyResult = await pool.query(breedingReadyQuery, params);
            const breedingReadyAnimals = breedingReadyResult.rows.map(row => new Animal(row));

            // Load traits for each animal
            for (const animal of breedingReadyAnimals) {
                await animal.loadTraits();
            }

            // Get recent breeding records
            const recentBreedingResult = await pool.query(
                `SELECT br.*, 
                        m.name as mother_name, f.name as father_name,
                        ab.name as breed_name
                 FROM breeding_records br
                 JOIN animals m ON br.mother_id = m.id
                 JOIN animals f ON br.father_id = f.id
                 JOIN animal_breeds ab ON m.breed_id = ab.id
                 WHERE m.owner_id = $1 OR f.owner_id = $1
                 ORDER BY br.bred_at DESC
                 LIMIT 10`,
                [ownerId]
            );

            return {
                breedingReadyAnimals: breedingReadyAnimals.map(animal => ({
                    ...animal.toMinimalJSON(),
                    traits: animal.traits
                })),
                recentBreedings: recentBreedingResult.rows,
                breedingStats: await this.getBreedingStats(ownerId)
            };

        } catch (error) {
            logger.error('Error getting breeding planner:', error);
            throw error;
        }
    }

    // Process animal traits data
    static async processAnimalTraits(traitsData, breedId) {
        const processedTraits = [];

        if (!traitsData || typeof traitsData !== 'object') {
            return processedTraits;
        }

        for (const [traitType, traitValue] of Object.entries(traitsData)) {
            try {
                // Get trait type ID
                const traitTypeResult = await pool.query(
                    'SELECT id FROM animal_trait_types WHERE breed_id = $1 AND name = $2',
                    [breedId, traitType]
                );

                if (traitTypeResult.rows.length === 0) {
                    logger.warn(`Trait type not found: ${traitType} for breed ${breedId}`);
                    continue;
                }

                // Get trait value ID
                const traitValueResult = await pool.query(
                    'SELECT id FROM animal_trait_values WHERE trait_type_id = $1 AND value = $2',
                    [traitTypeResult.rows[0].id, traitValue]
                );

                if (traitValueResult.rows.length === 0) {
                    logger.warn(`Trait value not found: ${traitValue} for type ${traitType}`);
                    continue;
                }

                processedTraits.push({
                    traitTypeId: traitTypeResult.rows[0].id,
                    traitValueId: traitValueResult.rows[0].id,
                    inheritedFrom: 'random' // This could be determined by breeding logic
                });

            } catch (error) {
                logger.error(`Error processing trait ${traitType}:`, error);
            }
        }

        return processedTraits;
    }

    // Check animal status and trigger alerts if needed
    static async checkAnimalStatus(animal) {
        const alerts = [];

        // Check for critical hunger
        if (animal.hungerPercent >= 95) {
            alerts.push({
                type: 'critical_hunger',
                message: `${animal.name} is critically hungry (${animal.hungerPercent}%)`,
                animalId: animal.id
            });
        }

        // Check for low happiness
        if (animal.happinessPercent <= 10) {
            alerts.push({
                type: 'low_happiness',
                message: `${animal.name} has very low happiness (${animal.happinessPercent}%)`,
                animalId: animal.id
            });
        }

        // Check if became inoperable
        if (!animal.isOperable && animal.hungerPercent >= 100) {
            alerts.push({
                type: 'inoperable',
                message: `${animal.name} has become inoperable due to hunger`,
                animalId: animal.id
            });
        }

        // Check if ready for breeding
        if (animal.isEligibleForBreeding()) {
            alerts.push({
                type: 'breeding_ready',
                message: `${animal.name} is ready for breeding`,
                animalId: animal.id
            });
        }

        // Store alerts if any
        if (alerts.length > 0) {
            // In a full implementation, you might want to store these in a notifications table
            // or send real-time notifications to the user
            logger.info('Animal status alerts', { animalId: animal.id, alerts });
        }

        return alerts;
    }

    // Get owner summary statistics
    static async getOwnerSummaryStats(ownerId) {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_animals,
                COUNT(*) FILTER (WHERE status = 'alive') as alive_animals,
                COUNT(*) FILTER (WHERE status = 'pet') as pet_animals,
                COUNT(*) FILTER (WHERE status = 'eden') as eden_animals,
                COUNT(*) FILTER (WHERE is_breedable = true AND status = 'alive') as breedable_animals,
                COUNT(*) FILTER (WHERE heat_percent >= 100 AND happiness_percent >= 95 AND hunger_percent <= 5 AND status = 'alive') as breeding_ready,
                COUNT(*) FILTER (WHERE hunger_percent >= 95 AND status = 'alive') as critical_hunger,
                COUNT(*) FILTER (WHERE happiness_percent <= 10 AND status = 'alive') as low_happiness,
                SUM(breeding_count) as total_breedings,
                AVG(age_days) FILTER (WHERE status = 'alive') as average_age
             FROM animals 
             WHERE owner_id = $1`,
            [ownerId]
        );

        const stats = result.rows[0];

        return {
            totalAnimals: parseInt(stats.total_animals),
            aliveAnimals: parseInt(stats.alive_animals),
            petAnimals: parseInt(stats.pet_animals),
            edenAnimals: parseInt(stats.eden_animals),
            breedableAnimals: parseInt(stats.breedable_animals),
            breedingReady: parseInt(stats.breeding_ready),
            criticalHunger: parseInt(stats.critical_hunger),
            lowHappiness: parseInt(stats.low_happiness),
            totalBreedings: parseInt(stats.total_breedings) || 0,
            averageAge: parseFloat(stats.average_age) || 0
        };
    }

    // Get breeding statistics
    static async getBreedingStats(ownerId) {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_breedings,
                COUNT(*) FILTER (WHERE is_twins = true) as twin_breedings,
                COUNT(DISTINCT mother_id) as breeding_mothers,
                COUNT(DISTINCT father_id) as breeding_fathers,
                DATE_TRUNC('month', bred_at) as month,
                COUNT(*) as monthly_count
             FROM breeding_records br
             JOIN animals a ON (br.mother_id = a.id OR br.father_id = a.id)
             WHERE a.owner_id = $1
             GROUP BY DATE_TRUNC('month', bred_at)
             ORDER BY month DESC
             LIMIT 12`,
            [ownerId]
        );

        return {
            totalBreedings: result.rows.length > 0 ? parseInt(result.rows[0].total_breedings) : 0,
            twinBreedings: result.rows.length > 0 ? parseInt(result.rows[0].twin_breedings) : 0,
            breedingMothers: result.rows.length > 0 ? parseInt(result.rows[0].breeding_mothers) : 0,
            breedingFathers: result.rows.length > 0 ? parseInt(result.rows[0].breeding_fathers) : 0,
            monthlyBreedings: result.rows.map(row => ({
                month: row.month,
                count: parseInt(row.monthly_count)
            }))
        };
    }

    // Log consumption event
    static async logConsumption(slObjectKey, consumableType, amount = 1) {
        try {
            const animal = await Animal.findBySlObjectKey(slObjectKey);
            if (!animal) {
                throw new Error('Animal not found');
            }

            // Get consumable type ID
            const consumableResult = await pool.query(
                `SELECT ct.* FROM consumable_types ct
                 JOIN animal_breeds ab ON ct.breed_id = ab.id
                 WHERE ab.id = $1 AND ct.name = $2`,
                [animal.breedId, consumableType]
            );

            if (consumableResult.rows.length === 0) {
                throw new Error(`Consumable type not found: ${consumableType}`);
            }

            const consumable = consumableResult.rows[0];

            // Log consumption
            await pool.query(
                `INSERT INTO consumption_logs (animal_id, consumable_type_id, amount_consumed, sl_region)
                 VALUES ($1, $2, $3, $4)`,
                [animal.id, consumable.id, amount, animal.slRegion]
            );

            logger.info('Consumption logged', {
                animalId: animal.id,
                consumableType,
                amount
            });

            return { success: true };

        } catch (error) {
            logger.error('Error logging consumption:', error);
            throw error;
        }
    }

    // Get global system statistics
    static async getGlobalStats() {
        try {
            const result = await pool.query(
                `SELECT 
                    COUNT(*) as total_animals,
                    COUNT(DISTINCT owner_id) as total_owners,
                    COUNT(*) FILTER (WHERE status = 'alive') as alive_animals,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as registered_today,
                    COUNT(*) FILTER (WHERE last_sync_at > NOW() - INTERVAL '1 hour') as active_animals,
                    SUM(breeding_count) as total_breedings_ever
                 FROM animals`
            );

            const breedingResult = await pool.query(
                `SELECT COUNT(*) as recent_breedings
                 FROM breeding_records 
                 WHERE bred_at > NOW() - INTERVAL '24 hours'`
            );

            const stats = result.rows[0];
            const breedingStats = breedingResult.rows[0];

            return {
                totalAnimals: parseInt(stats.total_animals),
                totalOwners: parseInt(stats.total_owners),
                aliveAnimals: parseInt(stats.alive_animals),
                registeredToday: parseInt(stats.registered_today),
                activeAnimals: parseInt(stats.active_animals),
                totalBreedingsEver: parseInt(stats.total_breedings_ever) || 0,
                recentBreedings: parseInt(breedingStats.recent_breedings)
            };

        } catch (error) {
            logger.error('Error getting global stats:', error);
            throw error;
        }
    }

    // Health check for animals (find stale/problematic animals)
    static async performHealthCheck() {
        try {
            const result = await pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE last_sync_at < NOW() - INTERVAL '24 hours' AND status = 'alive') as stale_animals,
                    COUNT(*) FILTER (WHERE hunger_percent >= 100 AND status = 'alive') as starving_animals,
                    COUNT(*) FILTER (WHERE happiness_percent <= 0 AND status = 'alive') as unhappy_animals,
                    COUNT(*) FILTER (WHERE created_at = updated_at) as never_updated
                 FROM animals`
            );

            const healthStats = result.rows[0];

            return {
                staleAnimals: parseInt(healthStats.stale_animals),
                starvingAnimals: parseInt(healthStats.starving_animals),
                unhappyAnimals: parseInt(healthStats.unhappy_animals),
                neverUpdated: parseInt(healthStats.never_updated)
            };

        } catch (error) {
            logger.error('Error performing health check:', error);
            throw error;
        }
    }
}

module.exports = AnimalService;