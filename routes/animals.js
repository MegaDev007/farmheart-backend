// routes/animals.js
const express = require('express');
const router = express.Router();

const AnimalController = require('../controllers/animalController');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
// const { generalLimiter, authLimiter } = require('../middleware/rateLimiting');
const { 
    validateAnimalRegistration,
    validateAnimalStats,
    validateBreeding,
    validateConsumption
} = require('../middleware/validation');

// SL-facing endpoints (public, but with rate limiting)
router.post('/register/:slObjectKey', 
    // generalLimiter, 
    validateAnimalRegistration, 
    AnimalController.registerAnimal
);

router.put('/stats/:slObjectKey', 
    // generalLimiter, 
    validateAnimalStats, 
    AnimalController.updateStats
);

router.get('/sl/:slObjectKey', 
    // generalLimiter, 
    AnimalController.getAnimalBySlKey
);

router.post('/breeding', 
    // generalLimiter, 
    validateBreeding, 
    AnimalController.processBreeding
);

router.post('/consumption/:slObjectKey', 
    // generalLimiter, 
    validateConsumption, 
    AnimalController.logConsumption
);

// Web-facing endpoints (authenticated)
router.get('/dashboard', 
    authenticateToken, 
    AnimalController.getOwnerDashboard
);

router.get('/breeding-planner', 
    authenticateToken, 
    AnimalController.getBreedingPlanner
);

router.get('/:animalId', 
    authenticateToken, 
    AnimalController.getAnimalDetails
);

router.put('/:animalId/name', 
    authenticateToken, 
    AnimalController.updateAnimalName
);

router.post('/:animalId/eden', 
    authenticateToken, 
    AnimalController.sendToEden
);

router.post('/:animalId/pet', 
    authenticateToken, 
    AnimalController.convertToPet
);

router.get('/:animalId/lineage', 
    authenticateToken, 
    AnimalController.getAnimalLineage
);

router.get('/:animalId/offspring', 
    authenticateToken, 
    AnimalController.getAnimalOffspring
);

router.get('/:animalId/breeding-history', 
    authenticateToken, 
    AnimalController.getBreedingHistory
);

router.get('/:animalId/photos', 
    authenticateToken, 
    AnimalController.getAnimalPhotos
);

// Breed information endpoints
router.get('/breeds/:breed/info', 
    optionalAuth, 
    AnimalController.getBreedInfo
);

module.exports = router;