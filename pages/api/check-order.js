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
    console.log('Printful Response Body:', responseText);

    return { 
        ok: response.ok,
        status: response.status,
        json: responseText ? JSON.parse(responseText) : null
    };
};

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get the payment intent ID from the query
        const { payment_intent } = req.query;
        if (!payment_intent) {
            return res.status(400).json({ error: 'Payment intent ID is required' });
        }

        console.log('Checking payment intent:', payment_intent);

        // Retrieve the payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent, {
            expand: ['charges', 'latest_charge']
        });

        console.log('Payment Intent Status:', paymentIntent.status);

        // Get the associated checkout session
        const sessions = await stripe.checkout.sessions.list({
            payment_intent: payment_intent,
            expand: ['data.line_items', 'data.line_items.data.price.product']
        });

        if (!sessions.data.length) {
            return res.status(404).json({ error: 'No checkout session found for this payment' });
        }

        const session = sessions.data[0];
        console.log('Found checkout session:', session.id);
        console.log('Session data:', JSON.stringify(session, null, 2));

        // Check if payment was successful
        if (paymentIntent.status !== 'succeeded') {
            return res.json({
                status: 'error',
                message: 'Payment has not succeeded',
                payment_status: paymentIntent.status
            });
        }

        // Get line items with expanded product data
        const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items', 'line_items.data.price.product']
        });

        console.log('Line items:', JSON.stringify(expandedSession.line_items, null, 2));

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
            items: expandedSession.line_items.data.map(item => {
                const variantId = item.price.product.metadata.printful_variant_id;
                console.log(`Processing line item:`, {
                    description: item.description,
                    metadata: item.price.product.metadata,
                    variant_id: variantId
                });
                return {
                    sync_variant_id: variantId,
                    quantity: item.quantity,
                    retail_price: (item.amount_total / 100).toString()
                };
            }),
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

        console.log('Creating Printful order:', JSON.stringify(printfulOrder, null, 2));

        // Create the order in Printful
        const printfulResponse = await makePrintfulRequest('/orders', {
            method: 'POST',
            body: JSON.stringify(printfulOrder)
        });

        if (!printfulResponse.ok) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create Printful order',
                printful_error: printfulResponse.json
            });
        }

        return res.json({
            status: 'success',
            payment_intent: {
                id: paymentIntent.id,
                status: paymentIntent.status,
                amount: paymentIntent.amount,
                created: paymentIntent.created
            },
            session: {
                id: session.id,
                customer_email: session.customer_details?.email,
                shipping_name: session.shipping_details?.name
            },
            printful_order: printfulResponse.json.result
        });
    } catch (error) {
        console.error('Error checking order:', error);
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
} 