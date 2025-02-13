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
    console.log('Printful Response Headers:', response.headers);
    console.log('Printful Response Body:', responseText);

    if (!response.ok) {
        console.error('Printful API Error:', {
            endpoint,
            status: response.status,
            statusText: response.statusText,
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

        console.log('\n=== Received Webhook Request ===');
        console.log('Timestamp:', new Date().toISOString());
        console.log('Signature:', signature);
        console.log('Raw Body:', rawBody.toString());

        let event;
        try {
            event = stripe.webhooks.constructEvent(
                rawBody,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
            console.log('\n=== Webhook Event ===');
            console.log('Event Type:', event.type);
            console.log('Event Data:', JSON.stringify(event.data, null, 2));
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
                // Get the expanded session with line items
                console.log('\n=== Retrieving Session Details ===');
                const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                    expand: ['line_items', 'line_items.data.price.product']
                });
                console.log('Session Line Items:', JSON.stringify(sessionWithLineItems.line_items, null, 2));

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
                    items: sessionWithLineItems.line_items.data.map(item => {
                        const variantId = item.price.product.metadata.printful_variant_id;
                        console.log(`Mapping line item to Printful variant: ${variantId}`);
                        return {
                            sync_variant_id: variantId,
                            quantity: item.quantity,
                            retail_price: (item.amount_total / 100).toString()
                        };
                    }),
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

                console.log('Printful Order Data:', JSON.stringify(printfulOrder, null, 2));

                // Create the order in Printful
                const printfulResponse = await makePrintfulRequest('/orders', {
                    method: 'POST',
                    body: JSON.stringify(printfulOrder)
                });

                if (!printfulResponse.ok) {
                    throw new Error(`Failed to create Printful order: ${JSON.stringify(printfulResponse)}`);
                }

                console.log('Created Printful order:', printfulResponse.json.result.id);

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

                return res.json({ 
                    received: true,
                    printful_order_id: printfulResponse.json.result.id
                });
            } catch (error) {
                console.error('Error processing order:', error);
                // Send error notification to admin
                // ... add admin notification code here ...
                throw error; // Re-throw to be caught by outer try-catch
            }
        }

        return res.json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ 
            error: 'Webhook handler failed', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
} 