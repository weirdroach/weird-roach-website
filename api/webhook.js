import Stripe from 'stripe';
import { buffer } from 'micro';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_API_TOKEN = process.env.PRINTFUL_API_TOKEN;
const STORE_ID = process.env.PRINTFUL_STORE_ID;

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

            // Create order in Printful
            const printfulResponse = await fetch('https://api.printful.com/orders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.PRINTFUL_API_TOKEN}`,
                    'Content-Type': 'application/json',
                    'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID
                },
                body: JSON.stringify({
                    recipient: {
                        name: session.shipping.name,
                        address1: session.shipping.address.line1,
                        address2: session.shipping.address.line2,
                        city: session.shipping.address.city,
                        state_code: session.shipping.address.state,
                        country_code: session.shipping.address.country,
                        zip: session.shipping.address.postal_code
                    },
                    items: session.line_items.data.map(item => ({
                        sync_variant_id: item.price.product.metadata.variant_id,
                        quantity: item.quantity
                    }))
                })
            });

            if (!printfulResponse.ok) {
                console.error('Error creating Printful order:', await printfulResponse.text());
                return res.status(500).json({ error: 'Failed to create Printful order' });
            }

            const printfulOrder = await printfulResponse.json();
            console.log('Created Printful order:', printfulOrder.result.id);

            // Format shipping address
            const shippingAddress = session.shipping.address;
            const formattedAddress = shippingAddress ? `
                ${session.shipping.name}<br>
                ${shippingAddress.line1}<br>
                ${shippingAddress.line2 ? shippingAddress.line2 + '<br>' : ''}
                ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}<br>
                ${shippingAddress.country}
            ` : 'No shipping address provided';

            // Create email content
            const items = session.line_items.data.map(item => 
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

            console.log('\n=== Sending Order Confirmation Email ===');
            console.log('Customer email:', session.customer_details?.email);
            
            const emailResult = await transporter.sendMail({
                from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
                to: session.customer_details?.email,
                subject: 'Order Confirmation - Weird Roach Store',
                html: emailContent,
                text: `Order Details:\n\n${items}\n\nTotal: $${(session.amount_total / 100).toFixed(2)}\n\nShipping to:\n${session.shipping.name}\n${shippingAddress?.line1}\n${shippingAddress?.line2 ? shippingAddress.line2 + '\n' : ''}${shippingAddress?.city}, ${shippingAddress?.state} ${shippingAddress?.postal_code}\n${shippingAddress?.country}\n\nWe'll send you another email when your order ships.\n\nThanks for the support!`,
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