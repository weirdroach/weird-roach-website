import Stripe from 'stripe';
import { buffer } from 'micro';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

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

    if (!response.ok) {
        console.error('Printful API Error:', {
            endpoint,
            status: response.status,
            error: responseText
        });
        throw new Error(`Printful API error: ${responseText}`);
    }

    return { 
        ok: response.ok,
        status: response.status,
        json: responseText ? JSON.parse(responseText) : null
    };
};

// Email configuration
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD.trim()
    },
    debug: true,
    logger: true,
    tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
    },
    pool: true,
    maxConnections: 1,
    maxMessages: Infinity,
    authMethod: 'PLAIN'
});

// Vercel Serverless Config
export const config = {
    api: { bodyParser: false },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const rawBody = await buffer(req);
        const signature = req.headers['stripe-signature'];

        console.log('Received webhook request:', {
            timestamp: new Date().toISOString(),
            signature: signature,
            rawBody: rawBody.toString()
        });

        let event;
        try {
            event = stripe.webhooks.constructEvent(
                rawBody,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
            console.log('Webhook event constructed:', event.type);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: `Webhook Error: ${err.message}` });
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('\n=== Processing Checkout Session ===');
            console.log('Session ID:', session.id);
            console.log('Payment Intent:', session.payment_intent);

            try {
                console.log('\n=== Retrieving Session Details ===');
                const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                    expand: ['line_items', 'line_items.data.price.product']
                });

                console.log('Session Line Items:', JSON.stringify(sessionWithLineItems.line_items, null, 2));

                // ✅ FIX: Ensure we get the correct Printful Variant ID
                const items = await Promise.all(sessionWithLineItems.line_items.data.map(async (item) => {
                    const stripeProduct = await stripe.products.retrieve(item.price.product.id);
                    console.log('Retrieved Stripe Product:', JSON.stringify(stripeProduct, null, 2));

                    const printfulVariantId = stripeProduct.metadata?.printful_variant_id;

                    if (!printfulVariantId) {
                        console.error(`❌ Missing Printful Variant ID for ${stripeProduct.name}`);
                        throw new Error(`Missing Printful Variant ID for ${stripeProduct.name}`);
                    }

                    return {
                        sync_variant_id: printfulVariantId,
                        quantity: item.quantity,
                        retail_price: (item.amount_total / 100).toString()
                    };
                }));

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
                    items,
                    retail_costs: {
                        subtotal: (sessionWithLineItems.amount_subtotal / 100).toString(),
                        shipping: (sessionWithLineItems.total_details.amount_shipping / 100).toString(),
                        tax: (sessionWithLineItems.total_details.amount_tax / 100).toString(),
                        total: (sessionWithLineItems.amount_total / 100).toString()
                    },
                    packing_slip: {
                        email: process.env.EMAIL_USER,
                        message: 'Thank you for your order!'
                    }
                };

                console.log('Printful Order Data:', JSON.stringify(printfulOrder, null, 2));

                const printfulResponse = await makePrintfulRequest('/orders', {
                    method: 'POST',
                    body: JSON.stringify(printfulOrder)
                });

                console.log('Created Printful order:', printfulResponse.json.result.id);

                return res.json({ received: true, printful_order_id: printfulResponse.json.result.id });
            } catch (error) {
                console.error('Error processing order:', error);
                throw error;
            }
        }

        return res.json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Webhook handler failed', details: error.message });
    }
}
