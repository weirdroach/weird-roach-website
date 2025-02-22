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
    console.log(`\n🔍 Fetching Printful: ${endpoint}`);

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
        console.error(`❌ Printful API Error (${response.status}): ${errorText}`);
        throw new Error(`Printful API error: ${response.status}`);
    }

    return response.json();
};

// Function to fetch Printful variant ID by product name
const getPrintfulVariantId = async (productName) => {
    try {
        console.log(`🔍 Searching Printful for variant of "${productName}"`);

        const printfulProducts = await makePrintfulRequest('/sync/products');

        for (const product of printfulProducts.result) {
            if (product.name.toLowerCase() === productName.toLowerCase()) {
                const productDetails = await makePrintfulRequest(`/sync/products/${product.id}`);
                const variantId = productDetails.result.sync_variants[0]?.id || null;

                console.log(`✅ Found Printful Variant ID: ${variantId} for "${productName}"`);
                return variantId;
            }
        }

        console.warn(`❌ No variant ID found for "${productName}"`);
        return null;
    } catch (error) {
        console.error(`❌ Error fetching Printful Variant ID:`, error);
        return null;
    }
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
    maxMessages: Infinity
});

// This is a special config for Vercel Serverless Functions
export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const rawBody = await buffer(req);
        const signature = req.headers['stripe-signature'];

        console.log('📩 Received webhook request:', {
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
            console.log('✅ Webhook event constructed:', event.type);
        } catch (err) {
            console.error('❌ Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: `Webhook Error: ${err.message}` });
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('🛒 Processing Checkout Session:', session.id);

            try {
                const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                    expand: ['line_items', 'line_items.data.price.product']
                });

                console.log('🛍️ Session Line Items:', JSON.stringify(sessionWithLineItems.line_items, null, 2));

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
                    items: [],
                    retail_costs: {
                        subtotal: (sessionWithLineItems.amount_subtotal / 100).toString(),
                        shipping: (sessionWithLineItems.total_details.amount_shipping / 100).toString(),
                        tax: (sessionWithLineItems.total_details.amount_tax / 100).toString(),
                        total: (sessionWithLineItems.amount_total / 100).toString()
                    },
                    gift: null,
                    packing_slip: {
                        email: process.env.EMAIL_USER,
                        phone: '',
                        message: 'Thank you for your order!'
                    }
                };

                for (const item of sessionWithLineItems.line_items.data) {
                    const variantId = await getPrintfulVariantId(item.description);
                    
                    if (!variantId) {
                        console.error(`❌ Missing Printful Variant ID for ${item.description}`);
                        continue;
                    }

                    printfulOrder.items.push({
                        sync_variant_id: variantId,
                        quantity: item.quantity,
                        retail_price: (item.amount_total / 100).toString()
                    });
                }

                if (printfulOrder.items.length === 0) {
                    throw new Error('❌ No valid items found to send to Printful');
                }

                console.log('📦 Printful Order Data:', JSON.stringify(printfulOrder, null, 2));

                const printfulResponse = await makePrintfulRequest('/orders', {
                    method: 'POST',
                    body: JSON.stringify(printfulOrder)
                });

                console.log('✅ Printful order created:', printfulResponse.json.result.id);

                return res.json({
                    received: true,
                    printful_order_id: printfulResponse.json.result.id
                });
            } catch (error) {
                console.error('❌ Error processing order:', error);
                return res.status(500).json({ error: 'Webhook handler failed', details: error.message });
            }
        }

        return res.json({ received: true });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        return res.status(500).json({ error: 'Webhook handler failed', details: error.message });
    }
}
