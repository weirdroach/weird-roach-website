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
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
        res.setHeader(
            'Access-Control-Allow-Headers',
            'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Stripe-Signature'
        );
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const rawBody = await buffer(req);
        const signature = req.headers['stripe-signature'];

        console.log('Received webhook request');
        
        // For test requests, just log and return success
        if (signature === 'test_signature') {
            const payload = JSON.parse(rawBody.toString());
            console.log('Test webhook received:', payload);
            return res.json({ 
                received: true,
                mode: 'test',
                event: payload
            });
        }

        // Handle real Stripe webhooks
        try {
            const event = stripe.webhooks.constructEvent(
                rawBody,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
            
            console.log('Webhook event type:', event.type);
            
            if (event.type === 'checkout.session.completed') {
                const session = event.data.object;
                console.log('Processing completed checkout session:', session.id);

                // For test requests, skip the session retrieval
                const sessionWithLineItems = signature === 'test_signature' ? 
                    { line_items: { data: [{ quantity: 1, description: 'Test Item', amount_total: 2000 }] } } :
                    await stripe.checkout.sessions.retrieve(session.id, {
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
                        sync_variant_id: item.price?.product?.metadata?.printful_variant_id || 'test_variant_id',
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

                if (signature !== 'test_signature') {
                    // Create the order in Printful only for real requests
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
                } else {
                    console.log('Test mode - Printful order would be:', printfulOrder);
                }

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
                    <p><strong>Total:</strong> $${(session.amount_total / 100).toFixed(2)}</p>
                    
                    <h2>Shipping Address:</h2>
                    <p>${formattedAddress}</p>
                    
                    <p>We'll send you another email when your order ships.</p>
                    <p>Thanks for the support!</p>
                `;

                if (signature !== 'test_signature') {
                    // Send email only for real requests
                    console.log('\n=== Sending Order Confirmation Email ===');
                    console.log('Customer email:', session.customer_details?.email);
                    
                    const emailResult = await transporter.sendMail({
                        from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
                        to: session.customer_details?.email,
                        subject: 'Order Confirmation - Weird Roach Store',
                        html: emailContent,
                        text: `Order Details:\n\n${items}\n\nTotal: $${(session.amount_total / 100).toFixed(2)}\n\nShipping to:\n${session.shipping_details.name}\n${shippingAddress?.line1}\n${shippingAddress?.line2 ? shippingAddress.line2 + '\n' : ''}${shippingAddress?.city}, ${shippingAddress?.state} ${shippingAddress?.postal_code}\n${shippingAddress?.country}\n\nWe'll send you another email when your order ships.\n\nThanks for the support!`,
                        headers: {
                            'X-Entity-Ref-ID': session.id,
                            'X-Mailer': 'Weird Roach Store Mailer',
                            'X-Priority': '1',
                            'Importance': 'high'
                        }
                    });
                    
                    console.log('Order confirmation email sent successfully!');
                } else {
                    console.log('Test mode - Email would be sent with content:', emailContent);
                }
            }

            return res.json({ received: true, mode: 'live' });
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: `Webhook Error: ${err.message}` });
        }
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Webhook handler failed', details: error.message });
    }
} 