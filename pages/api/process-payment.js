import Stripe from 'stripe';
import fetch from 'node-fetch';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_ACCESS_TOKEN = process.env.PRINTFUL_ACCESS_TOKEN;
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID;

// Function to make authenticated Printful API requests
const makePrintfulRequest = async (endpoint, options = {}) => {
    console.log('\n=== Making Printful Request ===');
    console.log('Endpoint:', endpoint);
    console.log('Options:', JSON.stringify(options, null, 2));

    const response = await fetch(`${PRINTFUL_API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${PRINTFUL_ACCESS_TOKEN}`,
            'X-PF-Store-Id': PRINTFUL_STORE_ID,
            'Content-Type': 'application/json'
        }
    });

    const responseText = await response.text();
    console.log('Printful Response Status:', response.status);
    console.log('Printful Response Headers:', response.headers);
    console.log('Printful Response Body:', responseText);

    if (!response.ok) {
        throw new Error(`Printful API error: ${responseText}`);
    }

    return { 
        ok: response.ok,
        status: response.status,
        json: responseText ? JSON.parse(responseText) : null
    };
};

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentIntentId } = req.body;
        
        if (!paymentIntentId) {
            return res.status(400).json({ error: 'Payment Intent ID is required' });
        }

        console.log('\n=== Processing Payment Intent ===');
        console.log('Payment Intent ID:', paymentIntentId);

        // Retrieve the payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['charges.data.shipping']
        });
        console.log('Payment Intent:', JSON.stringify(paymentIntent, null, 2));

        // Get the session that created this payment
        const sessions = await stripe.checkout.sessions.list({
            payment_intent: paymentIntentId,
            expand: ['data.line_items']
        });
        
        if (!sessions.data.length) {
            throw new Error('No session found for this payment intent');
        }

        const session = sessions.data[0];
        console.log('Session:', JSON.stringify(session, null, 2));

        // Create Printful order
        const printfulOrder = {
            recipient: {
                name: session.shipping_details.name,
                address1: session.shipping_details.address.line1,
                address2: session.shipping_details.address.line2 || '',
                city: session.shipping_details.address.city,
                state_code: session.shipping_details.address.state,
                country_code: session.shipping_details.address.country,
                zip: session.shipping_details.address.postal_code,
                email: session.customer_details.email,
                phone: session.customer_details.phone || ''
            },
            items: session.line_items.data.map(item => ({
                sync_variant_id: item.price.product.metadata.printful_variant_id,
                quantity: item.quantity,
                retail_price: (item.amount_total / 100).toString()
            })),
            retail_costs: {
                subtotal: (session.amount_subtotal / 100).toString(),
                shipping: (session.total_details.amount_shipping / 100).toString(),
                tax: (session.total_details.amount_tax / 100).toString(),
                total: (session.amount_total / 100).toString()
            },
            gift: null,
            packing_slip: {
                email: process.env.EMAIL_USER,
                phone: '',
                message: 'Thank you for your order!'
            }
        };

        console.log('Printful Order:', JSON.stringify(printfulOrder, null, 2));

        // Create the order in Printful
        const printfulResponse = await makePrintfulRequest('/orders', {
            method: 'POST',
            body: JSON.stringify(printfulOrder)
        });

        return res.json({
            success: true,
            printful_order: printfulResponse.json.result,
            payment_intent: paymentIntent.id,
            session: session.id
        });
    } catch (error) {
        console.error('Error processing payment:', error);
        return res.status(500).json({
            error: 'Failed to process payment',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
} 