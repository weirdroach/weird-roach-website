import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import https from 'https';
import http from 'http';
import fs from 'fs';
import nodemailer from 'nodemailer';

// Load environment variables from .env file
dotenv.config();

// Debug environment variables (safely)
console.log('=== Environment Variables Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PRINTFUL_API_TOKEN exists:', !!process.env.PRINTFUL_API_TOKEN);
console.log('PRINTFUL_API_TOKEN length:', process.env.PRINTFUL_API_TOKEN?.length);
console.log('PRINTFUL_API_TOKEN starts with pmtK:', process.env.PRINTFUL_API_TOKEN?.startsWith('pmtK'));
console.log('PRINTFUL_STORE_ID:', process.env.PRINTFUL_STORE_ID);
console.log('================================');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware for detailed logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    next();
});

// Set security headers
app.use((req, res, next) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    // Set Content Security Policy
    res.setHeader('Content-Security-Policy', 
        "default-src 'self' https://*.stripe.com https://*.printful.com https://*.vercel.app; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://*.stripe.com https://*.stripe.network js.stripe.com https://m.stripe.network https://m.stripe.com; " +
        "connect-src 'self' https://*.stripe.com https://api.stripe.com https://m.stripe.com https://*.stripe.network https://m.stripe.network https://api.printful.com https://*.printful.com https://js.stripe.com https://*.vercel.app wss://*.stripe.com; " +
        "style-src 'self' 'unsafe-inline' https://*.stripe.com; " +
        "img-src 'self' https://*.stripe.com https://*.printful.com data: blob: *; " +
        "frame-src 'self' https://*.stripe.com https://*.stripe.network https://js.stripe.com https://m.stripe.network https://m.stripe.com; " +
        "worker-src 'self' blob: https://*.stripe.com https://*.stripe.network; " +
        "child-src 'self' blob: https://*.stripe.com https://*.stripe.network; " +
        "font-src 'self' data:; " +
        "form-action 'self' https://*.stripe.com;"
    );

    // Set other security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    next();
});

// Serve static files from the public directory
app.use('/', express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        // Set proper content type for images
        if (filePath.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
        }
    }
}));

app.use(express.json({
    verify: (req, res, buf) => {
        if (req.url === '/webhook') {
            req.rawBody = buf;
        }
    }
}));

// Modify the domain configuration for Vercel
const getDomain = () => {
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    return process.env.NODE_ENV === 'production'
        ? 'https://weirdroach.com'
        : 'http://localhost:3000';
};

// Update the checkout session creation
app.post('/api/create-checkout-session', async (req, res) => {
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

        res.json({ 
            sessionId: session.id,
            url: session.url 
        });
    } catch (error) {
        console.error('Stripe Error:', error);
        res.status(500).json({ 
            error: 'Failed to create checkout session',
            details: error.message
        });
    }
});

// HTML route handlers
app.get(['/', '/index.html'], (req, res) => {
    console.log('Serving index.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/sounds.html', (req, res) => {
    console.log('Serving sounds.html');
    res.sendFile(path.join(__dirname, 'public', 'sounds.html'));
});

app.get('/visuals.html', (req, res) => {
    console.log('Serving visuals.html');
    res.sendFile(path.join(__dirname, 'public', 'visuals.html'));
});

app.get('/store.html', (req, res) => {
    console.log('Serving store.html');
    res.sendFile(path.join(__dirname, 'public', 'store.html'));
});

app.get('/contact.html', (req, res) => {
    console.log('Serving contact.html');
    res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// Printful API endpoint and authentication
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_API_TOKEN = process.env.PRINTFUL_API_TOKEN;
const STORE_ID = process.env.PRINTFUL_STORE_ID;

// Add this color mapping function before the /api/products endpoint
const getColorValue = (colorName) => {
    const colorMap = {
        'Black': '#000000',
        'White': '#FFFFFF',
        'Desert Dust': '#C4B6AB',
        'Dark Heather Grey': '#4A4A4A',
        'Burgundy': '#800020',
        'Charcoal Melange': '#36454F',
        'Bottle green': '#006A4E',
        // Add more color mappings as needed
    };
    return colorMap[colorName] || colorName;
};

// Endpoint to fetch products from Printful
app.get('/api/products', async (req, res) => {
    try {
        console.log('=== Printful API Debug ===');
        console.log('Fetching products from Printful...');
        console.log('Using API Token:', PRINTFUL_API_TOKEN ? `${PRINTFUL_API_TOKEN.substring(0, 4)}...` : 'Token missing');
        console.log('Using Store ID:', STORE_ID);
        console.log('API URL:', PRINTFUL_API_URL);
        const endpoint = `${PRINTFUL_API_URL}/sync/products`;
        console.log('Full endpoint:', endpoint);
        
        if (!PRINTFUL_API_TOKEN) {
            throw new Error('Printful API token is missing');
        }

        // First get the list of products
        const response = await fetch(endpoint, {
            headers: {
                'Authorization': `Bearer ${PRINTFUL_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Printful API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`Printful API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Successfully fetched products from Printful');
        
        // Transform and send the response
        const transformedProducts = data.result.map(product => ({
            id: product.id,
            name: product.name,
            variants: product.variants,
            // Add any other necessary product fields
        }));

        res.json(transformedProducts);
    } catch (error) {
        console.error('Error in /api/products:', error);
        res.status(500).json({
            error: 'Failed to fetch products',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

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

// Test email on startup
const testEmail = async () => {
    try {
        console.log('\n=== Email Configuration Test ===');
        console.log('Email User:', process.env.EMAIL_USER);
        console.log('Email Password length:', process.env.EMAIL_PASSWORD?.length);
        console.log('Raw password first/last chars:', 
            process.env.EMAIL_PASSWORD ? 
            `${process.env.EMAIL_PASSWORD.slice(0, 4)}...${process.env.EMAIL_PASSWORD.slice(-4)}` : 
            'not set');
        console.log('Trimmed password length:', process.env.EMAIL_PASSWORD?.trim().length);
        
        // Verify the connection configuration
        console.log('Verifying email configuration...');
        try {
            const verifyResult = await transporter.verify();
            console.log('Configuration verification result:', verifyResult);
        } catch (verifyError) {
            console.error('Verification error:', verifyError);
            throw verifyError;
        }
        
        console.log('Attempting to send test email...');
        const testResult = await transporter.sendMail({
            from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: 'Test Email - Server Restart',
            text: 'This is a test email to verify the email configuration is working.',
            html: `
                <h1>Test Email</h1>
                <p>This is a test email to verify the email configuration is working.</p>
                <p>Sent at: ${new Date().toISOString()}</p>
                <p>Using enhanced security configuration.</p>
            `
        });
        console.log('Test email sent successfully:', {
            messageId: testResult.messageId,
            accepted: testResult.accepted,
            rejected: testResult.rejected,
            response: testResult.response,
            envelope: testResult.envelope
        });
    } catch (error) {
        console.error('\n=== Email Test Error ===');
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            code: error.code,
            command: error.command,
            response: error.response,
            responseCode: error.responseCode,
            stack: error.stack
        });
        
        if (error.code === 'EAUTH') {
            console.error('Authentication failed. Please check:');
            console.error('1. Email password is correct');
            console.error('2. App password is properly formatted (16 characters)');
            console.error('3. 2-factor authentication is enabled');
            console.error('4. App password has proper permissions');
        }
    }
};

// Run test email on startup
testEmail();

// Stripe webhook endpoint
app.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    console.log('\n=== Webhook Request Received ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Signature:', sig);
    
    let event;

    try {
        // Try to parse the event with signature verification
        try {
            console.log('Webhook secret:', process.env.STRIPE_WEBHOOK_SECRET);
            event = stripe.webhooks.constructEvent(
                req.rawBody,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );
            console.log('Signature verification successful');
        } catch (verifyError) {
            console.error('Signature verification failed:', verifyError.message);
            return res.status(400).json({ error: 'Webhook signature verification failed' });
        }
        
        console.log('\n=== Processing Webhook Event ===');
        console.log('Event type:', event.type);
        console.log('Event ID:', event.id);
        
        // Handle the event
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('\n=== Checkout Session Details ===');
            console.log('Session ID:', session.id);
            console.log('Customer details:', JSON.stringify(session.customer_details, null, 2));
            console.log('Shipping details:', JSON.stringify(session.shipping_details, null, 2));
            
            try {
                // Use the existing transporter instead of creating a new one
                console.log('\n=== Fetching Session Line Items ===');
                const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                    expand: ['line_items']
                });
                console.log('Line items:', JSON.stringify(sessionWithLineItems.line_items, null, 2));

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
                        zip: session.shipping_details.address.postal_code
                    },
                    items: sessionWithLineItems.line_items.data.map(item => {
                        // Parse the variant info from the item description (e.g., "French Elephant Tee - Black (M)")
                        const [productName, variantInfo] = item.description.split(' - ');
                        const [color, size] = variantInfo.replace('(', '').replace(')', '').split(' ');
                        
                        return {
                            sync_variant_id: item.price.product.metadata.printful_variant_id,
                            quantity: item.quantity,
                            retail_price: (item.amount_total / 100).toString()
                        };
                    })
                };

                try {
                    const printfulResponse = await fetch(`${PRINTFUL_API_URL}/orders`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${PRINTFUL_API_TOKEN}`,
                            'Content-Type': 'application/json',
                            'X-PF-Store-Id': STORE_ID
                        },
                        body: JSON.stringify(printfulOrder)
                    });

                    if (!printfulResponse.ok) {
                        const errorText = await printfulResponse.text();
                        console.error('Printful order creation failed:', errorText);
                        throw new Error(`Failed to create Printful order: ${errorText}`);
                    }

                    const printfulResult = await printfulResponse.json();
                    console.log('Printful order created successfully:', printfulResult);
                } catch (printfulError) {
                    console.error('Error creating Printful order:', printfulError);
                    // Continue with email sending even if Printful order creation fails
                }

                // Format shipping address
                const shippingAddress = session.shipping_details?.address;
                const formattedAddress = shippingAddress ? `
                    ${session.shipping_details.name}<br>
                    ${shippingAddress.line1}<br>
                    ${shippingAddress.line2 ? shippingAddress.line2 + '<br>' : ''}
                    ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}<br>
                    ${shippingAddress.country}
                ` : 'No shipping address provided';

                // Create email content with improved formatting
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
                console.log('Email content preview:', emailContent.substring(0, 200) + '...');
                
                // Send the email using the existing transporter
                const emailResult = await transporter.sendMail({
                    from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
                    to: session.customer_details?.email,
                    subject: 'Order Confirmation - Weird Roach Store',
                    html: emailContent,
                    text: `Order Details:\n\n${items}\n\nTotal: $${(sessionWithLineItems.amount_total / 100).toFixed(2)}\n\nShipping to:\n${session.shipping_details?.name}\n${shippingAddress?.line1}\n${shippingAddress?.line2 ? shippingAddress.line2 + '\n' : ''}${shippingAddress?.city}, ${shippingAddress?.state} ${shippingAddress?.postal_code}\n${shippingAddress?.country}\n\nWe'll send you another email when your order ships.\n\nThanks for the support!`,
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
            } catch (emailError) {
                console.error('\n=== Order Confirmation Email Error ===');
                console.error('Error details:', {
                    name: emailError.name,
                    message: emailError.message,
                    code: emailError.code,
                    command: emailError.command,
                    response: emailError.response,
                    responseCode: emailError.responseCode,
                    stack: emailError.stack
                });
                throw emailError;
            }
        }

        res.status(200).json({received: true, type: event.type});
    } catch (err) {
        console.error('\n=== Webhook Error ===');
        console.error('Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        res.status(400).json({received: true, error: err.message});
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).send('Something broke!');
});

// Handle 404s
app.use((req, res) => {
    console.log('404 for:', req.url);
    res.status(404).send(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Page Not Found</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    h1 { color: #333; }
                    a { color: #0066cc; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>404 - Page Not Found</h1>
                <p>The page you're looking for doesn't exist.</p>
                <p>Requested URL: ${req.url}</p>
                <a href="/">Return to Home</a>
            </body>
        </html>
    `);
});

// Remove the HTTP/HTTPS server creation since Vercel handles this
// Instead, export the Express app
export default app; 