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
    const response = await fetch(`${PRINTFUL_API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${PRINTFUL_ACCESS_TOKEN}`,
            'X-PF-Store-Id': PRINTFUL_STORE_ID,
            'Content-Type': 'application/json'
        }
    });

    // Log API response for debugging
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Printful API Error:', {
            endpoint,
            status: response.status,
            statusText: response.statusText,
            error: errorText
        });
    }

    return response;
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

export const config = {
    api: {
        bodyParser: false,
    },
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
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const rawBody = await buffer(req);
        const signature = req.headers['stripe-signature'];

        console.log('Received webhook request');

        let event;
        try {
            event = stripe.webhooks.constructEvent(
                rawBody,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: `Webhook Error: ${err.message}` });
        }

        console.log('Webhook event type:', event.type);

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('Processing completed checkout session:', session.id);

            // Get the expanded session with line items
            const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                expand: ['line_items']
            });

            // Create order in Printful
            console.log('\n=== Creating Printful Order ===');
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
                items: sessionWithLineItems.line_items.data.map(item => ({
                    sync_variant_id: item.price.product.metadata.printful_variant_id,
                    quantity: item.quantity,
                    retail_price: (item.amount_total / 100).toString()
                })),
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

            // Create the order in Printful
            const printfulResponse = await makePrintfulRequest('/orders', {
                method: 'POST',
                body: JSON.stringify(printfulOrder)
            });

            if (!printfulResponse.ok) {
                console.error('Error creating Printful order:', await printfulResponse.text());
                return res.status(500).json({ error: 'Failed to create Printful order' });
            }

            const printfulResult = await printfulResponse.json();
            console.log('Created Printful order:', printfulResult.result.id);

            // Format shipping address
            const shippingAddress = session.shipping_details.address;
            const formattedAddress = shippingAddress ? `
                ${session.shipping_details.name}<br>
                ${shippingAddress.line1}<br>
                ${shippingAddress.line2 ? shippingAddress.line2 + '<br>' : ''}
                ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}<br>
                ${shippingAddress.country}
            ` : 'No shipping address provided';

            // Create email content
            const items = sessionWithLineItems.line_items.data.map(item => 
                `${item.quantity}x ${item.description} - $${(item.amount_total / 100).toFixed(2)}`
            ).join('\n');

            const emailContent = `
                <h1>Thank you for your order from Weird Roach!</h1>
                <h2>Order Details:</h2>
                <pre>${items}</pre>
                <p><strong>Total:</strong> $${(sessionWithLineItems.amount_total / 100).toFixed(2)}</p>
                
                <h2>Shipping Address:</h2>
                <p>${formattedAddress}</p>
                
                <p>We'll send you another email when your order ships.</p>
                <p>Thanks for the support!</p>
            `;

            console.log('\n=== Sending Order Confirmation Email ===');
            console.log('Customer email:', session.customer_details?.email);
            
            const emailResult = await transporter.sendMail({
                from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
                to: session.customer_details?.email,
                subject: 'Order Confirmation - Weird Roach Store',
                html: emailContent,
                text: `Order Details:\n\n${items}\n\nTotal: $${(sessionWithLineItems.amount_total / 100).toFixed(2)}\n\nShipping to:\n${session.shipping_details.name}\n${shippingAddress?.line1}\n${shippingAddress?.line2 ? shippingAddress.line2 + '\n' : ''}${shippingAddress?.city}, ${shippingAddress?.state} ${shippingAddress?.postal_code}\n${shippingAddress?.country}\n\nWe'll send you another email when your order ships.\n\nThanks for the support!`,
                headers: {
                    'X-Entity-Ref-ID': session.id,
                    'X-Mailer': 'Weird Roach Store Mailer',
                    'X-Priority': '1',
                    'Importance': 'high'
                }
            });
            
            console.log('Order confirmation email sent successfully!');
            console.log('Email details:', {
                messageId: emailResult.messageId,
                accepted: emailResult.accepted,
                rejected: emailResult.rejected,
                response: emailResult.response,
                envelope: emailResult.envelope
            });
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook handler failed', details: error.message });
    }
} 