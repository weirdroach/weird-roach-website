import fetch from 'node-fetch';

export default async function handler(req, res) {
    const PRINTFUL_API_TOKEN = process.env.PRINTFUL_API_TOKEN;
    const STORE_ID = process.env.PRINTFUL_STORE_ID;

    try {
        console.log('=== Printful API Test ===');
        console.log('Store ID:', STORE_ID);
        console.log('Token exists:', !!PRINTFUL_API_TOKEN);
        console.log('Token starts with:', PRINTFUL_API_TOKEN ? PRINTFUL_API_TOKEN.substring(0, 6) : 'missing');

        const response = await fetch('https://api.printful.com/store', {
            headers: {
                'Authorization': `Bearer ${PRINTFUL_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        
        res.status(200).json({
            success: response.ok,
            status: response.status,
            data: data,
            tokenPrefix: PRINTFUL_API_TOKEN ? PRINTFUL_API_TOKEN.substring(0, 6) : 'missing',
            storeId: STORE_ID
        });
    } catch (error) {
        console.error('Test Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            tokenPrefix: PRINTFUL_API_TOKEN ? PRINTFUL_API_TOKEN.substring(0, 6) : 'missing',
            storeId: STORE_ID
        });
    }
} 