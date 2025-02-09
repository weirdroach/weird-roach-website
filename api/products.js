import fetch from 'node-fetch';

// Printful API configuration
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_API_TOKEN = process.env.PRINTFUL_API_TOKEN;
const STORE_ID = process.env.PRINTFUL_STORE_ID;

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Validate environment variables
        if (!PRINTFUL_API_TOKEN) {
            console.error('Printful API token is missing');
            return res.status(500).json({ 
                error: 'Configuration error',
                details: 'Printful API token is not configured',
                timestamp: new Date().toISOString()
            });
        }

        if (!STORE_ID) {
            console.error('Printful Store ID is missing');
            return res.status(500).json({ 
                error: 'Configuration error',
                details: 'Printful Store ID is not configured',
                timestamp: new Date().toISOString()
            });
        }

        console.log('=== Printful API Debug ===');
        console.log('Environment:', process.env.NODE_ENV);
        console.log('Fetching products from Printful...');
        console.log('Store ID:', STORE_ID);
        console.log('API Token exists:', !!PRINTFUL_API_TOKEN);
        console.log('API Token starts with:', PRINTFUL_API_TOKEN.substring(0, 4));
        
        const endpoint = `${PRINTFUL_API_URL}/sync/products`;
        console.log('Requesting from endpoint:', endpoint);

        const headers = {
            'Authorization': `Bearer ${PRINTFUL_API_TOKEN}`,
            'Content-Type': 'application/json',
            'X-PF-Store-Id': STORE_ID
        };

        const response = await fetch(endpoint, { 
            method: 'GET',
            headers,
            timeout: 10000 // 10 second timeout
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Printful API error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                headers: Object.fromEntries(response.headers.entries())
            });
            
            return res.status(response.status).json({
                error: 'Printful API error',
                status: response.status,
                details: errorText,
                timestamp: new Date().toISOString()
            });
        }

        const data = await response.json();
        
        if (!data.result || !Array.isArray(data.result)) {
            console.error('Invalid response format:', data);
            return res.status(500).json({
                error: 'Invalid response format',
                details: 'Expected result array in response',
                timestamp: new Date().toISOString()
            });
        }

        console.log('Products fetched successfully:', {
            count: data.result.length,
            products: data.result.map(p => p.name)
        });

        // Process and return the products
        const processedProducts = data.result.map(product => ({
            id: product.id,
            name: product.name,
            description: product.description || '',
            variants: product.sync_variants || [],
            thumbnail_url: product.thumbnail_url,
            retail_price: product.retail_price,
            sync_product: product.sync_product || {},
            files: product.files || [],
            options: product.options || []
        }));

        // Set cache headers
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
        res.status(200).json(processedProducts);
    } catch (error) {
        console.error('Error in /api/products:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message,
            timestamp: new Date().toISOString(),
            path: '/api/products'
        });
    }
} 