import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ES Module path handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple env file locations for local development
const envPaths = [
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env')
];

// Load the first env file that exists
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        console.log('\n=== Loading Environment File ===');
        console.log('Found env file at:', envPath);
        dotenv.config({ path: envPath });
        break;
    }
}

// Fallback to hardcoded values for local development
if (!process.env.PRINTFUL_ACCESS_TOKEN && !process.env.VERCEL) {
    console.log('\n=== Using Local Development Values ===');
    process.env.PRINTFUL_ACCESS_TOKEN = 'your_local_token_here';
    process.env.PRINTFUL_STORE_ID = 'your_local_store_id_here';
}

// Debug environment variables
console.log('\n=== Products API Environment Variables ===');
console.log('PRINTFUL_ACCESS_TOKEN exists:', !!process.env.PRINTFUL_ACCESS_TOKEN);
console.log('PRINTFUL_STORE_ID exists:', !!process.env.PRINTFUL_STORE_ID);
console.log('=====================================\n');

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
            error: errorText
        });
        throw new Error(`Printful API request failed: ${response.status} ${errorText}`);
    }

    return response.json();
};

// Helper function to validate and extract size
const extractSize = (name) => {
    const validSizes = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    const nameParts = name.split(' / ');
    
    // Check all parts of the name for a valid size
    for (const part of nameParts) {
        if (validSizes.includes(part)) {
            return part;
        }
    }
    
    return ''; // Return empty string if no valid size found
};

// Helper function to extract and map color
const extractColor = (name) => {
    const nameParts = name.split(' / ');
    const colorPart = nameParts[1] || '';
    
    // Map of known color variations to standardized names
    const colorMap = {
        'Black': 'Black',
        'White': 'White',
        'Desert Dust': 'Desert Dust',
        'Bottle green': 'Bottle green',
        'Burgundy': 'Burgundy',
        'Charcoal Melange': 'Charcoal Melange',
        'Dark Heather Grey': 'Dark Heather Grey',
        // Add more color mappings as needed
    };

    // First check if what we think is color is actually a size
    const validSizes = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    if (validSizes.includes(colorPart)) {
        return 'Pink'; // Default to pink if we found a size instead of a color
    }

    // Debug logging
    console.log('Processing color:', {
        name,
        nameParts,
        colorPart,
        mappedColor: colorMap[colorPart] || 'Pink'
    });

    return colorMap[colorPart] || 'Pink'; // Default to pink if color not in map
};

// Helper function to extract variant details
const extractVariantDetails = (variant) => {
    const size = extractSize(variant.name);
    const color = extractColor(variant.name);
    
    // Get the preview file specifically
    const previewFile = variant.files?.find(f => f.type === "preview");
    const designFile = variant.files?.[0];  // Keep the first file as fallback

    return {
        variant_id: variant.variant_id,
        sync_variant_id: variant.id,
        external_id: variant.external_id,
        name: variant.name,
        color: color,
        size: size,
        retail_price: variant.retail_price,
        sku: variant.sku,
        product_image: variant.product.image,
        product_name: variant.product.name,
        file: {
            filename: designFile.filename,
            preview_url: previewFile?.preview_url || designFile?.preview_url,
            thumbnail_url: previewFile?.thumbnail_url || designFile?.thumbnail_url,
            width: designFile?.width,
            height: designFile?.height
        }
    };
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

        const { id, raw } = req.query;
        const isRawMode = raw === 'true';

        if (id) {
            // Fetch single product details
            const response = await makePrintfulRequest(`/store/products/${id}?store_id=${PRINTFUL_STORE_ID}`);
            
            if (isRawMode) {
                return res.json(response);
            }

            // Return simplified data
            const formattedProduct = {
                id: response.result.sync_product.id,
                external_id: response.result.sync_product.external_id,
                name: response.result.sync_product.name,
                thumbnail_url: response.result.sync_product.thumbnail_url,
                variants_count: {
                    total: response.result.sync_product.variants,
                    synced: response.result.sync_product.synced
                },
                variants: response.result.sync_variants.map(extractVariantDetails)
            };

            return res.json(formattedProduct);
        }

        // Fetch all products
        const response = await makePrintfulRequest(`/store/products?store_id=${PRINTFUL_STORE_ID}`);
        
        if (isRawMode) {
            return res.json(response);
        }

        // Get detailed information for each product
        const formattedProducts = await Promise.all(response.result.map(async (product) => {
            try {
                const details = await makePrintfulRequest(`/store/products/${product.id}?store_id=${PRINTFUL_STORE_ID}`);
                return {
                    id: product.id,
                    name: product.name,
                    thumbnail_url: product.thumbnail_url,
                    variants: details.result.sync_variants.map(extractVariantDetails)
                };
            } catch (error) {
                console.error(`Error fetching details for product ${product.id}:`, error);
                return null;
            }
        }));

        // Filter out any failed product fetches
        const validProducts = formattedProducts.filter(Boolean);

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
