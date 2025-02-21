import Stripe from 'stripe';
import fetch from 'node-fetch';
import fs from 'fs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_ACCESS_TOKEN = process.env.PRINTFUL_ACCESS_TOKEN;
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID;
const LOG_FILE = 'server.log';

// Function to log events for debugging in Vercel & locally
const logEvent = (message, data = null) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    console.log(logMessage);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }

    // Write logs to a file for local debugging (not persistent on Vercel)
    try {
        fs.appendFileSync(LOG_FILE, `${logMessage}\n`);
        if (data) {
            fs.appendFileSync(LOG_FILE, `${JSON.stringify(data, null, 2)}\n`);
        }
    } catch (err) {
        console.error('Failed to write to log file', err);
    }
};

// Function to make authenticated Printful API requests
const makePrintfulRequest = async (endpoint, options = {}) => {
    logEvent('Making Printful Request', { endpoint, options });

    try {
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
        logEvent('Printful Response', {
            status: response.status,
            headers: response.headers.raw(),
            body: responseText
        });

        if (!response.ok) {
            logEvent('Printful API Error', { status: response.status, responseText });
            throw new Error(`Printful API error: ${responseText}`);
        }

        return {
            ok: response.ok,
            status: response.status,
            json: responseText ? JSON.parse(responseText) : null
        };
    } catch (error) {
        logEvent('Printful API Request Failed', { error: error.message, stack: error.stack });
        throw error;
    }
};

// API Route Handler
export default async function handler(req, res) {
    logEvent('Incoming Request', { method: req.method, body: req.body });

    // CORS Handling
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        logEvent('CORS Preflight Response');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        logEvent('Invalid Method Access', { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentIntentId } = req.body;
        if (!paymentIntentId) {
            logEvent('Missing Payment Intent ID');
            return res.status(400).json({ error: 'Payment Intent ID is required' });
        }

        logEvent('Retrieving Payment Intent from Stripe', { paymentIntentId });

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['charges.data.shipping']
        });

        logEvent('Stripe Payment Intent Retrieved', { status: paymentIntent.status, paymentIntent });

        // Fetch Stripe Checkout Session
        const sessions = await stripe.checkout.sessions.list({
            payment_intent: paymentIntentId,
            expand: ['data.line_items']
        });

        if (!sessions.data.length) {
            logEvent('No Stripe Checkout Session Found', { paymentIntentId });
            throw new Error('No session found for this payment intent');
        }

        const session = sessions.data[0];
        logEvent('Stripe Checkout Session Retrieved', { sessionId: session.id, session });

        // Create Printful Order
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

        logEvent('Printful Order Prepared', printfulOrder);

        // Send Order to Printful
        const printfulResponse = await makePrintfulRequest('/orders', {
            method: 'POST',
            body: JSON.stringify(printfulOrder)
        });

        logEvent('Printful Order Created Successfully', { printfulOrderId: printfulResponse.json.result.id });

        return res.json({
            success: true,
            printful_order: printfulResponse.json.result,
            payment_intent: paymentIntent.id,
            session: session.id
        });

    } catch (error) {
        logEvent('Error Processing Order', { error: error.message, stack: error.stack });
        return res.status(500).json({
            error: 'Failed to process payment',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
