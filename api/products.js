import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Debug environment variables
console.log('=== API Route Environment Variables ===');
console.log('Store ID:', process.env.PRINTFUL_STORE_ID);
console.log('Access token exists:', !!process.env.PRINTFUL_ACCESS_TOKEN);
console.log('====================================');

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

// Enable CORS
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
};

// Vercel API handler
export default async function handler(req, res) {
    // Handle CORS
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Validate environment variables
        if (!PRINTFUL_ACCESS_TOKEN || !PRINTFUL_STORE_ID) {
            throw new Error('Printful access token or store ID is missing');
        }

        // Handle product ID route
        const productId = req.query.id;
        if (productId) {
            // Get specific product details
            const response = await makePrintfulRequest(`/sync/products/${productId}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                return res.status(response.status).json({
                    error: 'Failed to fetch product details from Printful',
                    status: response.status,
                    details: errorText
                });
            }

            const data = await response.json();
            const formattedProduct = {
                id: data.result.id,
                name: data.result.name,
                description: data.result.description || '',
                thumbnail_url: data.result.thumbnail_url,
                variants: data.result.sync_variants || []
            };

            // Cache the response for 5 minutes
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.json(formattedProduct);
        }

        // Get all products
        const response = await makePrintfulRequest('/sync/products');
        if (!response.ok) {
            throw new Error(`Printful API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const formattedProducts = await Promise.all(data.result.map(async (product) => {
            try {
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
        return res.json(formattedProducts);
    } catch (error) {
        console.error('Error in products API:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
} 