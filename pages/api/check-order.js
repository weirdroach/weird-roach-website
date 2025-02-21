import Stripe from 'stripe';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import fs from 'fs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_API_URL = 'https://api.printful.com';
const PRINTFUL_ACCESS_TOKEN = process.env.PRINTFUL_ACCESS_TOKEN;
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID;
const LOG_FILE = 'server.log';

// Utility function to log events
const logEvent = (message, data = null) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    console.log(logMessage);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }

    // Append logs to a file for persistence
    fs.appendFileSync(LOG_FILE, `${logMessage}\n`);
    if (data) {
        fs.appendFileSync(LOG_FILE, `${JSON.stringify(data, null, 2)}\n`);
    }
};

// Function to make authenticated Printful API requests
const makePrintfulRequest = async (endpoint, options = {}) => {
    logEvent('Making Printful Request', { endpoint, options });

    try {
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
        logEvent('Printful Response', {
            status: response.status,
            headers: response.headers.raw(),
            body: responseText
        });

        if (!response.ok) {
            throw new Error(`Printful API error: ${responseText}`);
        }

        return { 
            ok: response.ok,
            status: response.status,
            json: responseText ? JSON.parse(responseText) : null
        };
    } catch (error) {
        logEvent('Printful API Error', error);
        throw error;
    }
};

export default async function handler(req, res) {
    logEvent('Incoming Request', { method: req.method, query: req.query });

    if (req.method !== 'GET') {
        logEvent('Invalid Request Method', { method: req.method });
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { payment_intent } = req.query;
        if (!payment_intent) {
            logEvent('Missing Payment Intent');
            return res.status(400).json({ error: 'Payment intent ID is required' });
        }

        logEvent('Retrieving Payment Intent', { payment_intent });

        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);
        logEvent('Payment Intent Retrieved', { status: paymentIntent.status });

        if (paymentIntent.status !== 'succeeded') {
            logEvent('Payment Not Succeeded', { status: paymentIntent.status });
            return res.json({
                status: 'error',
                message: 'Payment has not succeeded',
                payment_status: paymentIntent.status
            });
        }

        const sessions = await stripe.checkout.sessions.list({
            payment_intent: payment_intent,
            expand: ['data.line_items']
        });

        if (!sessions.data.length) {
            logEvent('No Checkout Session Found');
            return res.status(404).json({ error: 'No checkout session found for this payment' });
        }

        const session = sessions.data[0];
        logEvent('Found Checkout Session', { session_id: session.id });

        const FRENCH_ELEPHANT_XL_BLACK_VARIANT_ID = 14904;
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
            items: [{
                variant_id: FRENCH_ELEPHANT_XL_BLACK_VARIANT_ID,
                quantity: 1,
                retail_price: "32.00"
            }],
            retail_costs: {
                subtotal: "32.00",
                shipping: "5.00",
                tax: "0.00",
                total: "37.00"
            },
            gift: null,
            packing_slip: {
                email: process.env.EMAIL_USER,
                phone: '',
                message: 'Thank you for your order!'
            }
        };

        logEvent('Creating Printful Order', printfulOrder);
        const printfulResponse = await makePrintfulRequest('/orders', {
            method: 'POST',
            body: JSON.stringify(printfulOrder)
        });

        if (!printfulResponse.ok) {
            throw new Error(`Failed to create Printful order: ${JSON.stringify(printfulResponse)}`);
        }

        const orderId = printfulResponse.json.result.id;
        logEvent('Printful Order Created', { orderId });

        logEvent('Confirming Printful Order', { orderId });
        const confirmResponse = await makePrintfulRequest(`/orders/${orderId}/confirm`, {
            method: 'POST'
        });

        if (!confirmResponse.ok) {
            throw new Error(`Failed to confirm order: ${JSON.stringify(confirmResponse)}`);
        }

        logEvent('Sending Confirmation Email', { email: session.customer_details.email });

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
            }
        });

        await transporter.sendMail({
            from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
            to: session.customer_details.email,
            subject: 'Order Confirmation - Weird Roach Store',
            text: `Your order has been confirmed. Order ID: ${orderId}`,
            headers: {
                'X-Entity-Ref-ID': session.id,
                'X-Mailer': 'Weird Roach Store Mailer',
                'X-Priority': '1',
                'Importance': 'high'
            }
        });

        logEvent('Email Sent Successfully', { orderId });

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
            printful_order: {
                id: orderId,
                status: 'confirmed'
            }
        });
    } catch (error) {
        logEvent('Error Processing Order', { error: error.message, stack: error.stack });
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
