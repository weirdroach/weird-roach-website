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
import productsRouter from './api/products.js';

// Load environment variables from .env file
dotenv.config();

// Debug environment variables (safely)
console.log('=== Environment Variables Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PRINTFUL_CLIENT_ID exists:', !!process.env.PRINTFUL_CLIENT_ID);
console.log('PRINTFUL_CLIENT_SECRET exists:', !!process.env.PRINTFUL_CLIENT_SECRET);
console.log('================================');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware for parsing JSON bodies
app.use(express.json());

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

// Use the products router
app.use('/api/products', productsRouter);

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

// Test Printful connection on startup
const testPrintfulConnection = async () => {
    try {
        const response = await fetch('https://api.printful.com/store', {
            headers: {
                'Authorization': `Bearer ${process.env.PRINTFUL_ACCESS_TOKEN}`,
                'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API test failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log('Printful connection successful:', {
            store_id: data.result.id,
            name: data.result.name,
            type: data.result.type
        });
    } catch (error) {
        console.error('Printful API test failed:', error.message);
    }
};

// Run Printful connection test on startup
testPrintfulConnection();

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
        
        return true; // Return true if email test succeeds
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
        
        throw error; // Re-throw the error to be caught by the server startup
    }
};

// Stripe webhook endpoint
app.post('/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    console.log('\n=== Webhook Request Received ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Signature:', sig);
    
    let event;
    let retryCount = 0;
    const MAX_RETRIES = 3;

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
            
            const createPrintfulOrder = async () => {
                try {
                    // Use the existing transporter instead of creating a new one
                    console.log('\n=== Fetching Session Line Items ===');
                    const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
                        expand: ['line_items', 'line_items.data.price.product']
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

                    // Create the order in Printful with retry logic
                    let printfulResponse;
                    while (retryCount < MAX_RETRIES) {
                        try {
                            printfulResponse = await fetch('https://api.printful.com/orders', {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${process.env.PRINTFUL_ACCESS_TOKEN}`,
                                    'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(printfulOrder)
                            });

                            if (!printfulResponse.ok) {
                                const errorText = await printfulResponse.text();
                                throw new Error(`Printful API error: ${errorText}`);
                            }

                            const printfulData = await printfulResponse.json();
                            console.log('Printful order created successfully:', printfulData.result.id);

                            // Store order status
                            const orderStatus = {
                                stripe_session_id: session.id,
                                printful_order_id: printfulData.result.id,
                                status: 'created',
                                created_at: new Date().toISOString(),
                                customer_email: session.customer_details.email
                            };

                            console.log('Order status:', orderStatus);
                            
                            // Send confirmation email
                            await sendOrderConfirmationEmail(session, sessionWithLineItems, printfulData.result.id);
                            
                            return printfulData;
                        } catch (error) {
                            console.error(`Attempt ${retryCount + 1} failed:`, error);
                            retryCount++;
                            if (retryCount === MAX_RETRIES) {
                                throw error;
                            }
                            // Exponential backoff
                            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                        }
                    }
                } catch (error) {
                    console.error('Error creating Printful order:', error);
                    // Send error notification to admin
                    await sendErrorNotificationEmail(error, session);
                    throw error;
                }
            };

            try {
                const printfulResult = await createPrintfulOrder();
                return res.json({ 
                    received: true,
                    printful_order_id: printfulResult.result.id
                });
            } catch (error) {
                console.error('Failed to create Printful order:', error);
                // Return 200 to acknowledge webhook receipt but indicate error
                return res.json({ 
                    received: true,
                    error: 'Failed to create Printful order',
                    details: error.message
                });
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
});

// Helper function to send order confirmation email
async function sendOrderConfirmationEmail(session, sessionWithLineItems, printfulOrderId) {
    const items = sessionWithLineItems.line_items.data
        .map(item => `${item.quantity}x ${item.description} - $${(item.amount_total / 100).toFixed(2)}`)
        .join('\n');

    const shippingAddress = session.shipping_details.address;
    
    const emailContent = `
        <h2>Order Confirmation</h2>
        <p>Thank you for your order! Your order details are below:</p>
        <p><strong>Order ID:</strong> ${printfulOrderId}</p>
        <h3>Items:</h3>
        <pre>${items}</pre>
        <p><strong>Total:</strong> $${(session.amount_total / 100).toFixed(2)}</p>
        <h3>Shipping Address:</h3>
        <p>
            ${session.shipping_details.name}<br>
            ${shippingAddress.line1}<br>
            ${shippingAddress.line2 ? shippingAddress.line2 + '<br>' : ''}
            ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}<br>
            ${shippingAddress.country}
        </p>
        <p>We'll send you another email when your order ships.</p>
        <p>Thanks for the support!</p>
    `;

    await transporter.sendMail({
        from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
        to: session.customer_details.email,
        subject: 'Order Confirmation - Weird Roach Store',
        html: emailContent,
        text: `Order Details:\n\nOrder ID: ${printfulOrderId}\n\n${items}\n\nTotal: $${(session.amount_total / 100).toFixed(2)}\n\nShipping to:\n${session.shipping_details.name}\n${shippingAddress.line1}\n${shippingAddress.line2 ? shippingAddress.line2 + '\n' : ''}${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}\n${shippingAddress.country}\n\nWe'll send you another email when your order ships.\n\nThanks for the support!`,
        headers: {
            'X-Entity-Ref-ID': session.id,
            'X-Mailer': 'Weird Roach Store Mailer',
            'X-Priority': '1',
            'Importance': 'high'
        }
    });
}

// Helper function to send error notification email to admin
async function sendErrorNotificationEmail(error, session) {
    const emailContent = `
        <h2>⚠️ Order Processing Error</h2>
        <p>An error occurred while processing an order:</p>
        <pre>${error.stack}</pre>
        <h3>Order Details:</h3>
        <p><strong>Session ID:</strong> ${session.id}</p>
        <p><strong>Customer:</strong> ${session.customer_details.email}</p>
        <p><strong>Amount:</strong> $${(session.amount_total / 100).toFixed(2)}</p>
        <p>Please check the logs and handle this order manually if needed.</p>
    `;

    await transporter.sendMail({
        from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER, // Send to admin email
        subject: '⚠️ Order Processing Error - Weird Roach Store',
        html: emailContent,
        text: `Order Processing Error\n\nAn error occurred while processing an order:\n\n${error.stack}\n\nOrder Details:\nSession ID: ${session.id}\nCustomer: ${session.customer_details.email}\nAmount: $${(session.amount_total / 100).toFixed(2)}\n\nPlease check the logs and handle this order manually if needed.`,
        headers: {
            'X-Entity-Ref-ID': session.id,
            'X-Mailer': 'Weird Roach Store Mailer',
            'X-Priority': '1',
            'Importance': 'high'
        }
    });
}

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

// Remove local server startup code and export for Vercel
export default app;