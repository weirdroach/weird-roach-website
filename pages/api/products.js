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
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        if (!PRINTFUL_ACCESS_TOKEN || !PRINTFUL_STORE_ID) {
            throw new Error('Printful access token or store ID is missing');
        }

        const productId = req.query.id;
        if (productId) {
            // Fetch single product details
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
                id: data.result.sync_product.id,
                name: data.result.sync_product.name,
                description: data.result.sync_product.description || '',
                thumbnail_url: data.result.sync_product.thumbnail_url,
                variants: data.result.sync_variants.map(variant => ({
                    id: variant.id, // Sync ID (not used in orders)
                    variant_id: variant.variant_id, // ✅ Correct Printful variant ID
                    name: variant.name,
                    retail_price: variant.retail_price,
                    sku: variant.sku,
                    image: variant.product.image
                }))
            };

            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.json(formattedProduct);
        }

        // Fetch all products
        const response = await makePrintfulRequest('/sync/products');
        if (!response.ok) {
            throw new Error(`Printful API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const formattedProducts = await Promise.all(data.result.map(async (product) => {
            try {
                const productDetails = await makePrintfulRequest(`/sync/products/${product.id}`);
                const detailsData = await productDetails.json();
                
                console.log(`Product ${product.id} details:`, JSON.stringify(detailsData, null, 2));

                if (!productDetails.ok || !detailsData.result) {
                    console.error(`Invalid product details for ${product.id}:`, detailsData);
                    return {
                        id: product.id,
                        name: product.name,
                        description: product.description || '',
                        thumbnail_url: product.thumbnail_url,
                        variants: []
                    };
                }

                // Extract correct variants with `variant_id`
                const variants = detailsData.result.sync_variants || [];
                console.log(`Found ${variants.length} variants for product ${product.id}`);

                return {
                    id: product.id,
                    name: product.name,
                    description: product.description || '',
                    thumbnail_url: product.thumbnail_url,
                    variants: variants.map(variant => ({
                        id: variant.id, // Sync ID (useful for debugging but not for orders)
                        variant_id: variant.variant_id, // ✅ Actual Printful variant ID for ordering
                        name: variant.name,
                        price: variant.retail_price,
                        sku: variant.sku,
                        image: variant.product.image || product.thumbnail_url
                    }))
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

        // Filter out products with no valid variants
        const validProducts = formattedProducts.filter(product => product.variants.length > 0);
        console.log(`Found ${validProducts.length} valid products out of ${formattedProducts.length} total`);

        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.json(validProducts);
    } catch (error) {
        console.error('Error in products API:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
