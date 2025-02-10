import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Debug environment variables
console.log('=== API Route Environment Variables ===');
console.log('Store ID:', process.env.PRINTFUL_STORE_ID);
console.log('Access token exists:', !!process.env.PRINTFUL_ACCESS_TOKEN);
console.log('====================================');

const router = express.Router();

// Printful API configuration
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_ACCESS_TOKEN = process.env.PRINTFUL_ACCESS_TOKEN;
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID;

// Function to make authenticated Printful API requests
const makePrintfulRequest = async (endpoint, options = {}) => {
    const response = await fetch(`${PRINTFUL_API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${PRINTFUL_ACCESS_TOKEN}`,
            'X-PF-Store-Id': PRINTFUL_STORE_ID,
            'Content-Type': 'application/json'
        }
    });

    // Log API response for debugging
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Printful API Error:', {
            endpoint,
            status: response.status,
            statusText: response.statusText,
            error: errorText
        });
    }

    return response;
};

// GET /api/products
router.get('/', async (req, res) => {
    try {
        console.log('=== Fetching all products ===');
        console.log('Environment check:');
        console.log('Store ID:', PRINTFUL_STORE_ID);
        console.log('Access token exists:', !!PRINTFUL_ACCESS_TOKEN);
        
        // Validate environment variables
        if (!PRINTFUL_ACCESS_TOKEN || !PRINTFUL_STORE_ID) {
            throw new Error('Printful access token or store ID is missing');
        }

        // Get all sync products
        const response = await makePrintfulRequest('/sync/products');
        console.log('Printful API response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`Printful API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Map products to include all necessary fields
        const formattedProducts = await Promise.all(data.result.map(async (product) => {
            try {
                // Fetch individual product details to get variants
                const productDetails = await makePrintfulRequest(`/sync/products/${product.id}`);
                return {
                    id: product.id,
                    name: product.name,
                    description: product.description || '',
                    thumbnail_url: product.thumbnail_url,
                    variants: productDetails.result.sync_variants || []
                };
            } catch (error) {
                console.error(`Error fetching variants for product ${product.id}:`, error);
                return {
                    id: product.id,
                    name: product.name,
                    description: product.description || '',
                    thumbnail_url: product.thumbnail_url,
                    variants: []
                };
            }
        }));

        // Cache the response for 5 minutes
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(formattedProducts);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        console.log(`=== Fetching details for product ${productId} ===`);
        console.log('Environment check:');
        console.log('Store ID:', PRINTFUL_STORE_ID);
        console.log('Access token exists:', !!PRINTFUL_ACCESS_TOKEN);
        
        // Validate environment variables
        if (!PRINTFUL_ACCESS_TOKEN || !PRINTFUL_STORE_ID) {
            console.error('Printful configuration missing');
            throw new Error('Printful access token or store ID is missing');
        }

        // Get product details using sync_product endpoint
        const response = await makePrintfulRequest(`/sync/products/${productId}`);
        
        console.log('Printful API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Printful API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            
            return res.status(response.status).json({
                error: 'Failed to fetch product details from Printful',
                status: response.status,
                details: errorText
            });
        }

        const data = await response.json();
        console.log('Successfully fetched product details');
        
        // Format the response to include all necessary fields
        const formattedProduct = {
            id: data.result.id,
            name: data.result.name,
            description: data.result.description || '',
            thumbnail_url: data.result.thumbnail_url,
            variants: data.result.sync_variants || []
        };

        // Cache the response for 5 minutes
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(formattedProduct);
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

export default router; 