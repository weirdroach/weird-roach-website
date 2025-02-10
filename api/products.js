import express from 'express';
import fetch from 'node-fetch';

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
        console.log('=== Debug Environment Variables ===');
        console.log('NODE_ENV:', process.env.NODE_ENV);
        console.log('Store ID:', PRINTFUL_STORE_ID);
        console.log('Access token exists:', !!PRINTFUL_ACCESS_TOKEN);

        // Validate environment variables
        if (!PRINTFUL_ACCESS_TOKEN || !PRINTFUL_STORE_ID) {
            console.error('Printful configuration missing');
            return res.status(500).json({ 
                error: 'Configuration error',
                details: 'Printful API credentials are not fully configured'
            });
        }

        // First get the sync products
        console.log('Fetching sync products from Printful...');
        const syncResponse = await makePrintfulRequest('/store/products');

        if (!syncResponse.ok) {
            return res.status(syncResponse.status).json({
                error: 'Failed to fetch products from Printful',
                status: syncResponse.status,
                details: await syncResponse.text()
            });
        }

        const syncData = await syncResponse.json();
        console.log('Successfully fetched sync products. Count:', syncData.result?.length || 0);

        if (!syncData.result || !Array.isArray(syncData.result)) {
            console.error('Invalid sync products response:', syncData);
            return res.status(500).json({
                error: 'Invalid response format',
                details: 'Expected result array in sync products response'
            });
        }

        // Get detailed information for each product
        const productsWithDetails = await Promise.all(
            syncData.result.map(async (product) => {
                try {
                    const detailResponse = await makePrintfulRequest(`/store/products/${product.id}`);
                    if (!detailResponse.ok) {
                        console.error(`Failed to fetch details for product ${product.id}`);
                        return null;
                    }
                    const detailData = await detailResponse.json();
                    return detailData.result;
                } catch (error) {
                    console.error(`Error fetching details for product ${product.id}:`, error);
                    return null;
                }
            })
        );

        // Filter out any failed product fetches and transform the data
        const transformedProducts = productsWithDetails
            .filter(product => product !== null)
            .map(product => ({
                id: product.sync_product.id,
                name: product.sync_product.name,
                description: product.sync_product.description || '',
                thumbnail_url: product.sync_product.thumbnail_url,
                variants: product.sync_variants.map(variant => ({
                    id: variant.id,
                    size: variant.size,
                    color: variant.color,
                    price: variant.retail_price,
                    in_stock: variant.in_stock,
                    preview_url: variant.preview_url,
                    files: variant.files || [],
                    mockup_files: variant.mockup_files || []
                }))
            }));

        // Cache the response for 5 minutes
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(transformedProducts);
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
        
        if (!PRINTFUL_ACCESS_TOKEN || !PRINTFUL_STORE_ID) {
            console.error('Printful configuration missing');
            return res.status(500).json({ 
                error: 'Configuration error',
                details: 'Printful API credentials are not fully configured'
            });
        }

        // Get product details
        const response = await makePrintfulRequest(`/store/products/${productId}`);

        if (!response.ok) {
            return res.status(response.status).json({
                error: 'Failed to fetch product details from Printful',
                status: response.status,
                details: await response.text()
            });
        }

        const data = await response.json();
        console.log('Successfully fetched product details');

        // Transform the response
        const product = data.result;
        const transformedProduct = {
            id: product.sync_product.id,
            name: product.sync_product.name,
            description: product.sync_product.description || '',
            thumbnail_url: product.sync_product.thumbnail_url,
            variants: product.sync_variants.map(variant => ({
                id: variant.id,
                size: variant.size,
                color: variant.color,
                price: variant.retail_price,
                in_stock: variant.in_stock,
                preview_url: variant.preview_url,
                files: variant.files || [],
                mockup_files: variant.mockup_files || []
            }))
        };

        // Cache the response for 5 minutes
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(transformedProduct);
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

export default router; 