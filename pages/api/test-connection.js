import Stripe from 'stripe';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const results = {
        printful: { status: 'unknown', error: null },
        stripe: { status: 'unknown', error: null }
    };

    // Test Printful connection
    try {
        const printfulResponse = await fetch('https://api.printful.com/store', {
            headers: {
                'Authorization': `Bearer ${process.env.PRINTFUL_ACCESS_TOKEN}`,
                'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID,
                'Content-Type': 'application/json'
            }
        });
        
        if (!printfulResponse.ok) {
            throw new Error(`HTTP error! status: ${printfulResponse.status}`);
        }
        
        const printfulData = await printfulResponse.json();
        results.printful = {
            status: 'connected',
            storeId: printfulData.result.id,
            storeName: printfulData.result.name
        };
    } catch (error) {
        results.printful = {
            status: 'error',
            error: error.message
        };
    }

    // Test Stripe connection
    try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const stripeConfig = await stripe.configurations.list();
        results.stripe = {
            status: 'connected',
            accountId: stripeConfig.data[0]?.account
        };
    } catch (error) {
        results.stripe = {
            status: 'error',
            error: error.message
        };
    }

    res.status(200).json(results);
} 