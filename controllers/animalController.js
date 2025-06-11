// controllers/animalController.js
const AnimalService = require('../services/animalService');
const Animal = require('../models/animal');
const logger = require('../utils/logger');
const { pool } = require('../config/database'); 

class AnimalController {

    // Register new animal from SL
    static async registerAnimal(req, res, next) {
        try {
            const { slObjectKey } = req.params;
            const animalData = req.body;

            // Validate required fields
            const requiredFields = ['ownerUsername', 'breedType', 'gender'];
            for (const field of requiredFields) {
                if (!animalData[field]) {
                    return res.status(400).json({
                        success: false,
                        error: `Missing required field: ${field}`
                    });
                }
            }

            const animal = await AnimalService.registerAnimal(animalData, slObjectKey);

            res.status(201).json({
                success: true,
                message: 'Animal registered successfully',
                data: {
                    animal: animal.toJSON()
                }
            });

        } catch (error) {
            if (error.message.includes('already registered')) {
                return res.status(409).json({
                    success: false,
                    error: error.message
                });
            }
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Update animal stats from SL
    static async updateStats(req, res, next) {
        try {
            const { slObjectKey } = req.params;
            const statsData = req.body;

            const animal = await AnimalService.updateAnimalStats(slObjectKey, statsData);

            res.json({
                success: true,
                message: 'Animal stats updated successfully',
                data: {
                    animal: animal.toMinimalJSON()
                }
            });

        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Get animal by SL object key
    static async getAnimalBySlKey(req, res, next) {
        try {
            const { slObjectKey } = req.params;

            const animal = await Animal.findBySlObjectKey(slObjectKey);
            if (!animal) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found'
                });
            }

            res.json({
                success: true,
                data: {
                    animal: animal.toJSON()
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Get owner's animal dashboard
    static async getOwnerDashboard(req, res, next) {
        try {
            const { userId } = req.user;
            const filters = {
                breed: req.query.breed,
                status: req.query.status,
                breedingStatus: req.query.breedingStatus,
                sortBy: req.query.sortBy,
                sortOrder: req.query.sortOrder,
                page: parseInt(req.query.page) || 1,
                limit: parseInt(req.query.limit) || 20
            };

            const dashboard = await AnimalService.getOwnerDashboard(userId, filters);

            res.json({
                success: true,
                data: dashboard
            });

        } catch (error) {
            next(error);
        }
    }

    // Get detailed animal information
    static async getAnimalDetails(req, res, next) {
        try {
            const { animalId } = req.params;
            const { userId } = req.user;

            const animalDetails = await AnimalService.getAnimalDetails(
                parseInt(animalId), 
                userId
            );

            res.json({
                success: true,
                data: animalDetails
            });

        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            if (error.message.includes('Access denied')) {
                return res.status(403).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Update animal name
    static async updateAnimalName(req, res, next) {
        try {
            const { animalId } = req.params;
            const { name } = req.body;
            const { userId } = req.user;

            if (!name || name.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Animal name is required'
                });
            }

            if (name.length > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'Animal name must be 100 characters or less'
                });
            }

            // Get animal and verify ownership
            const result = await pool.query(
                'SELECT * FROM animals WHERE id = $1 AND owner_id = $2',
                [animalId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or access denied'
                });
            }

            const animal = new Animal(result.rows[0]);
            await animal.updateName(name.trim());

            res.json({
                success: true,
                message: 'Animal name updated successfully',
                data: {
                    animal: animal.toMinimalJSON()
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Send animal to Eden
    static async sendToEden(req, res, next) {
        try {
            const { animalId } = req.params;
            const { userId } = req.user;

            // Get animal and verify ownership
            const result = await pool.query(
                'SELECT * FROM animals WHERE id = $1 AND owner_id = $2 AND status = $3',
                [animalId, userId, 'alive']
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or cannot be sent to Eden'
                });
            }

            const animal = new Animal(result.rows[0]);
            const edenResult = await animal.sendToEden();

            res.json({
                success: true,
                message: `${animal.name} has been sent to Eden`,
                data: {
                    pointsEarned: edenResult.pointsEarned,
                    animal: animal.toMinimalJSON()
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Convert animal to pet
    static async convertToPet(req, res, next) {
        try {
            const { animalId } = req.params;
            const { userId } = req.user;

            // Get animal and verify ownership
            const result = await pool.query(
                'SELECT * FROM animals WHERE id = $1 AND owner_id = $2 AND status = $3',
                [animalId, userId, 'alive']
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or cannot be converted to pet'
                });
            }

            const animal = new Animal(result.rows[0]);
            await animal.convertToPet();

            res.json({
                success: true,
                message: `${animal.name} has been converted to a pet`,
                data: {
                    animal: animal.toMinimalJSON()
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Get breeding planner
    static async getBreedingPlanner(req, res, next) {
        try {
            const { userId } = req.user;
            const filters = {
                breed: req.query.breed
            };

            const breedingPlanner = await AnimalService.getBreedingPlanner(userId, filters);

            res.json({
                success: true,
                data: breedingPlanner
            });

        } catch (error) {
            next(error);
        }
    }

    // Process breeding from SL
    static async processBreeding(req, res, next) {
        try {
            const breedingData = req.body;

            // Validate required fields
            const requiredFields = ['motherSlObjectKey', 'fatherSlObjectKey', 'breedingRegion'];
            for (const field of requiredFields) {
                if (!breedingData[field]) {
                    return res.status(400).json({
                        success: false,
                        error: `Missing required field: ${field}`
                    });
                }
            }

            const result = await AnimalService.processBreeding(breedingData);

            res.json({
                success: true,
                message: 'Breeding processed successfully',
                data: {
                    breedingRecordId: result.breedingRecord.id,
                    offspring: result.offspring.map(animal => animal.toMinimalJSON())
                }
            });

        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Log consumption from SL
    static async logConsumption(req, res, next) {
        try {
            const { slObjectKey } = req.params;
            const { consumableType, amount } = req.body;

            if (!consumableType) {
                return res.status(400).json({
                    success: false,
                    error: 'Consumable type is required'
                });
            }

            await AnimalService.logConsumption(slObjectKey, consumableType, amount);

            res.json({
                success: true,
                message: 'Consumption logged successfully'
            });

        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Get animal lineage/family tree
    static async getAnimalLineage(req, res, next) {
        try {
            const { animalId } = req.params;
            const { userId } = req.user;
            const depth = parseInt(req.query.depth) || 3;

            // Validate inputs
            if (!animalId || isNaN(parseInt(animalId))) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid animal ID'
                });
            }

            if (depth < 1 || depth > 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Depth must be between 1 and 10'
                });
            }

            // Verify ownership
            const ownershipResult = await pool.query(
                'SELECT id, owner_id FROM animals WHERE id = $1',
                [animalId]
            );

            if (ownershipResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found'
                });
            }

            if (ownershipResult.rows[0].owner_id !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
            }

            // Build lineage tree using the CLASS NAME, not 'this'
            const lineage = await AnimalController.buildLineageTreeOptimized(parseInt(animalId), depth);

            res.json({
                success: true,
                data: {
                    lineage
                }
            });

        } catch (error) {
            console.error('Error in getAnimalLineage:', error);
            next(error);
        }
    }

    static async buildLineageTreeOptimized(animalId, maxDepth) {
        try {
            console.log(`Building lineage tree for animal ${animalId} with depth ${maxDepth}`);

            // Use PostgreSQL recursive CTE for efficient lineage traversal
            const lineageQuery = `
                WITH RECURSIVE lineage_tree AS (
                    -- Base case: start with the requested animal
                    SELECT 
                        a.id,
                        a.name,
                        a.gender,
                        a.mother_id,
                        a.father_id,
                        a.birth_date,
                        ab.name as breed_name,
                        0 as depth,
                        'self' as relation
                    FROM animals a
                    JOIN animal_breeds ab ON a.breed_id = ab.id
                    WHERE a.id = $1
                    
                    UNION ALL
                    
                    -- Recursive case: get parents
                    SELECT 
                        a.id,
                        a.name,
                        a.gender,
                        a.mother_id,
                        a.father_id,
                        a.birth_date,
                        ab.name as breed_name,
                        lt.depth + 1 as depth,
                        CASE 
                            WHEN a.id = lt.mother_id THEN 'mother'
                            WHEN a.id = lt.father_id THEN 'father'
                            ELSE 'ancestor'
                        END as relation
                    FROM animals a
                    JOIN animal_breeds ab ON a.breed_id = ab.id
                    JOIN lineage_tree lt ON (a.id = lt.mother_id OR a.id = lt.father_id)
                    WHERE lt.depth < $2
                )
                SELECT DISTINCT * FROM lineage_tree 
                ORDER BY depth, relation, name;
            `;

            const result = await pool.query(lineageQuery, [animalId, maxDepth]);
            
            if (result.rows.length === 0) {
                return null;
            }

            // Get traits for all animals in lineage
            const animalIds = result.rows.map(row => row.id);
            const traitsQuery = `
                SELECT 
                    at.animal_id,
                    att.name as trait_type,
                    att.display_name as trait_type_display,
                    atv.value as trait_value,
                    atv.display_name as trait_value_display,
                    atv.rarity_level
                FROM animal_traits at
                JOIN animal_trait_types att ON at.trait_type_id = att.id
                JOIN animal_trait_values atv ON at.trait_value_id = atv.id
                WHERE at.animal_id = ANY($1)
                ORDER BY at.animal_id, att.name;
            `;

            const traitsResult = await pool.query(traitsQuery, [animalIds]);
            
            // Organize traits by animal ID
            const traitsByAnimal = {};
            traitsResult.rows.forEach(trait => {
                if (!traitsByAnimal[trait.animal_id]) {
                    traitsByAnimal[trait.animal_id] = [];
                }
                traitsByAnimal[trait.animal_id].push({
                    traitType: trait.trait_type,
                    traitTypeDisplay: trait.trait_type_display,
                    traitValue: trait.trait_value,
                    traitValueDisplay: trait.trait_value_display,
                    rarityLevel: trait.rarity_level
                });
            });

            // Build the hierarchical structure - USE CLASS NAME
            return AnimalController.buildHierarchicalStructure(result.rows, traitsByAnimal, animalId);

        } catch (error) {
            console.error('Error building lineage tree:', error);
            throw new Error('Failed to build lineage tree');
        }
    }

    // Helper method to build hierarchical structure from flat lineage data
    static buildHierarchicalStructure(lineageRows, traitsByAnimal, rootAnimalId) {
        try {
            const animalsMap = new Map();
            
            // Create animal objects
            lineageRows.forEach(row => {
                const animal = {
                    id: row.id,
                    name: row.name,
                    breed: row.breed_name,
                    gender: row.gender,
                    birthDate: row.birth_date,
                    depth: row.depth,
                    relation: row.relation,
                    traits: traitsByAnimal[row.id] || [],
                    parents: {}
                };
                
                animalsMap.set(row.id, animal);
            });

            // Build parent-child relationships
            lineageRows.forEach(row => {
                const animal = animalsMap.get(row.id);
                
                if (row.mother_id && animalsMap.has(row.mother_id)) {
                    animal.parents.mother = animalsMap.get(row.mother_id);
                }
                
                if (row.father_id && animalsMap.has(row.father_id)) {
                    animal.parents.father = animalsMap.get(row.father_id);
                }
            });

            // Return the root animal with full lineage
            return animalsMap.get(rootAnimalId) || null;

        } catch (error) {
            console.error('Error building hierarchical structure:', error);
            throw new Error('Failed to build hierarchical structure');
        }
    }


    // Alternative simple lineage method (fallback)
    static async buildLineageTreeSimple(animalId, depth, currentDepth = 0) {
        if (currentDepth >= depth) return null;

        try {
            const result = await pool.query(
                `SELECT a.*, ab.name as breed_name
                 FROM animals a
                 LEFT JOIN animal_breeds ab ON a.breed_id = ab.id
                 WHERE a.id = $1`,
                [animalId]
            );

            if (result.rows.length === 0) return null;

            const animalData = result.rows[0];
            const animal = {
                id: animalData.id,
                name: animalData.name,
                breed: animalData.breed_name,
                gender: animalData.gender,
                birthDate: animalData.birth_date,
                traits: [],
                parents: {}
            };

            // Load traits for this animal
            try {
                const traitsResult = await pool.query(
                    `SELECT att.name as trait_type, att.display_name as trait_type_display,
                            atv.value as trait_value, atv.display_name as trait_value_display,
                            atv.rarity_level
                     FROM animal_traits at
                     JOIN animal_trait_types att ON at.trait_type_id = att.id
                     JOIN animal_trait_values atv ON at.trait_value_id = atv.id
                     WHERE at.animal_id = $1`,
                    [animalId]
                );

                animal.traits = traitsResult.rows.map(trait => ({
                    traitType: trait.trait_type,
                    traitTypeDisplay: trait.trait_type_display,
                    traitValue: trait.trait_value,
                    traitValueDisplay: trait.trait_value_display,
                    rarityLevel: trait.rarity_level
                }));
            } catch (traitsError) {
                console.warn('Could not load traits for animal:', animalId, traitsError.message);
                animal.traits = [];
            }

            // Recursively load parents
            if (animalData.mother_id) {
                animal.parents.mother = await this.buildLineageTreeSimple(
                    animalData.mother_id, 
                    depth, 
                    currentDepth + 1
                );
            }

            if (animalData.father_id) {
                animal.parents.father = await this.buildLineageTreeSimple(
                    animalData.father_id, 
                    depth, 
                    currentDepth + 1
                );
            }

            return animal;

        } catch (error) {
            console.error(`Error building lineage for animal ${animalId}:`, error);
            return null;
        }
    }

    // Get animal offspring
    static async getAnimalOffspring(req, res, next) {
        try {
            const { animalId } = req.params;
            const { userId } = req.user;

            // Verify ownership
            const result = await pool.query(
                'SELECT * FROM animals WHERE id = $1 AND owner_id = $2',
                [animalId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or access denied'
                });
            }

            const animal = new Animal(result.rows[0]);
            const offspring = await animal.loadOffspring();

            res.json({
                success: true,
                data: {
                    offspring
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Get animal breeding history
    static async getBreedingHistory(req, res, next) {
        try {

            const { animalId } = req.params;
            const { userId } = req.user;

            // Verify ownership
            const result = await pool.query(
                'SELECT * FROM animals WHERE id = $1 AND owner_id = $2',
                [animalId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or access denied'
                });
            }

            const animal = new Animal(result.rows[0]);
            const breedingHistory = await animal.getBreedingHistory();

            res.json({
                success: true,
                data: {
                    breedingHistory
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Get animal photos
    static async getAnimalPhotos(req, res, next) {
        try {
            const { animalId } = req.params;
            const { userId } = req.user;

            // Verify ownership
            const result = await pool.query(
                'SELECT * FROM animals WHERE id = $1 AND owner_id = $2',
                [animalId, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or access denied'
                });
            }

            const photosResult = await pool.query(
                `SELECT ap.*, u.sl_username as uploaded_by_username
                 FROM animal_photos ap
                 LEFT JOIN users u ON ap.uploaded_by = u.id
                 WHERE ap.animal_id = $1
                 ORDER BY ap.is_primary DESC, ap.created_at DESC`,
                [animalId]
            );

            res.json({
                success: true,
                data: {
                    photos: photosResult.rows
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Helper method to build lineage tree
    static async buildLineageTree(animalId, depth, currentDepth = 0) {
        if (currentDepth >= depth) return null;

        const result = await pool.query(
            `SELECT a.*, ab.name as breed_name
             FROM animals a
             JOIN animal_breeds ab ON a.breed_id = ab.id
             WHERE a.id = $1`,
            [animalId]
        );

        if (result.rows.length === 0) return null;

        const animal = new Animal(result.rows[0]);
        await animal.loadTraits();

        const lineageNode = {
            id: animal.id,
            name: animal.name,
            breed: animal.breed,
            gender: animal.gender,
            birthDate: animal.birthDate,
            traits: animal.traits,
            parents: {}
        };

        // Recursively load parents - USE CLASS NAME
        if (animal.motherId) {
            lineageNode.parents.mother = await AnimalController.buildLineageTree(
                animal.motherId, 
                depth, 
                currentDepth + 1
            );
        }

        if (animal.fatherId) {
            lineageNode.parents.father = await AnimalController.buildLineageTree(
                animal.fatherId, 
                depth, 
                currentDepth + 1
            );
        }

        return lineageNode;
    }

    // Get breed information and traits
    static async getBreedInfo(req, res, next) {
        try {
            const { breed } = req.params;

            const breedResult = await pool.query(
                'SELECT * FROM animal_breeds WHERE name = $1 AND is_active = true',
                [breed.toLowerCase()]
            );

            if (breedResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Breed not found'
                });
            }

            const breedInfo = breedResult.rows[0];

            // Get trait types and values
            const traitsResult = await pool.query(
                `SELECT att.id as trait_type_id, att.name as trait_type, att.display_name as trait_type_display,
                        atv.id as trait_value_id, atv.value as trait_value, atv.display_name as trait_value_display,
                        atv.rarity_level
                 FROM animal_trait_types att
                 LEFT JOIN animal_trait_values atv ON att.id = atv.trait_type_id AND atv.is_active = true
                 WHERE att.breed_id = $1
                 ORDER BY att.name, atv.rarity_level, atv.display_name`,
                [breedInfo.id]
            );

            // Organize traits by type
            const traits = {};
            traitsResult.rows.forEach(row => {
                if (!traits[row.trait_type]) {
                    traits[row.trait_type] = {
                        id: row.trait_type_id,
                        name: row.trait_type,
                        displayName: row.trait_type_display,
                        values: []
                    };
                }

                if (row.trait_value_id) {
                    traits[row.trait_type].values.push({
                        id: row.trait_value_id,
                        value: row.trait_value,
                        displayName: row.trait_value_display,
                        rarityLevel: row.rarity_level
                    });
                }
            });

            res.json({
                success: true,
                data: {
                    breed: breedInfo,
                    traits: Object.values(traits)
                }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = AnimalController;