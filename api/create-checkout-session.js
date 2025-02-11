import Stripe from 'stripe';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Get domain based on environment
const getDomain = () => {
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    return process.env.NODE_ENV === 'production'
        ? 'https://weirdroach.com'
        : 'http://localhost:3000';
};

// Enable CORS
const setCorsHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
};

// Vercel API handler
export default async function handler(req, res) {
    // Handle CORS
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { items } = req.body;
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Invalid items array' });
        }

        const lineItems = items.map(item => ({
            price_data: {
                currency: 'usd',
                product_data: {
                    name: item.name,
                    images: item.image ? [item.image] : [],
                    metadata: {
                        printful_variant_id: item.variant_id
                    }
                },
                unit_amount: Math.round(parseFloat(item.price) * 100),
            },
            quantity: item.quantity,
        }));

        const domain = getDomain();
        console.log('Creating Stripe session with domain:', domain);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${domain}/checkout-success.html`,
            cancel_url: `${domain}/store.html`,
            shipping_address_collection: {
                allowed_countries: ['US', 'CA', 'GB', 'AU'],
            },
            shipping_options: [
                {
                    shipping_rate_data: {
                        type: 'fixed_amount',
                        fixed_amount: {
                            amount: 500,
                            currency: 'usd',
                        },
                        display_name: 'Standard Shipping',
                        delivery_estimate: {
                            minimum: {
                                unit: 'business_day',
                                value: 5,
                            },
                            maximum: {
                                unit: 'business_day',
                                value: 7,
                            },
                        },
                    },
                },
            ],
        });

        return res.json({ 
            sessionId: session.id,
            url: session.url 
        });
    } catch (error) {
        console.error('Stripe Error:', error);
        return res.status(500).json({ 
            error: 'Failed to create checkout session',
            details: error.message
        });
    }
} 