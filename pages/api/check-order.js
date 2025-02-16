import Stripe from 'stripe';
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
        throw new Error(`Printful API error: ${responseText}`);
    }

    return { 
        ok: response.ok,
        status: response.status,
        json: responseText ? JSON.parse(responseText) : null
    };
};

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get the payment intent ID from the query
        const { payment_intent } = req.query;
        if (!payment_intent) {
            return res.status(400).json({ error: 'Payment intent ID is required' });
        }

        console.log('Checking payment intent:', payment_intent);

        // Retrieve the payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);
        console.log('Payment Intent Status:', paymentIntent.status);

        // Check if payment was successful
        if (paymentIntent.status !== 'succeeded') {
            return res.json({
                status: 'error',
                message: 'Payment has not succeeded',
                payment_status: paymentIntent.status
            });
        }

        // Get the associated checkout session
        const sessions = await stripe.checkout.sessions.list({
            payment_intent: payment_intent,
            expand: ['data.line_items']
        });

        if (!sessions.data.length) {
            return res.status(404).json({ error: 'No checkout session found for this payment' });
        }

        const session = sessions.data[0];
        console.log('Found checkout session:', session.id);

        // French Elephant Pullover - Black (XL) variant ID mapping
        // Format: sync_product_id:variant_id
        const FRENCH_ELEPHANT_XL_BLACK_VARIANT_ID = '4711377369:14904';

        // Create Printful order
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
                sync_variant_id: FRENCH_ELEPHANT_XL_BLACK_VARIANT_ID,
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

        console.log('Creating Printful order:', JSON.stringify(printfulOrder, null, 2));

        // Create the order in Printful
        const printfulResponse = await makePrintfulRequest('/orders', {
            method: 'POST',
            body: JSON.stringify(printfulOrder)
        });

        if (!printfulResponse.ok) {
            throw new Error(`Failed to create Printful order: ${JSON.stringify(printfulResponse)}`);
        }

        const orderId = printfulResponse.json.result.id;
        console.log('Created Printful order:', orderId);

        // Confirm the order
        console.log('Confirming order...');
        const confirmResponse = await makePrintfulRequest(`/orders/${orderId}/confirm`, {
            method: 'POST'
        });

        if (!confirmResponse.ok) {
            throw new Error(`Failed to confirm order: ${JSON.stringify(confirmResponse)}`);
        }

        // Send confirmation email
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

        const shippingAddress = session.shipping_details.address;
        const formattedAddress = `
            ${session.shipping_details.name}<br>
            ${shippingAddress.line1}<br>
            ${shippingAddress.line2 ? shippingAddress.line2 + '<br>' : ''}
            ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}<br>
            ${shippingAddress.country}
        `;

        const emailContent = `
            <h1>Thank you for your order from Weird Roach!</h1>
            <h2>Order Details:</h2>
            <pre>1x French Elephant Pullover - Black (XL) - $32.00</pre>
            <p><strong>Subtotal:</strong> $32.00</p>
            <p><strong>Shipping:</strong> $5.00</p>
            <p><strong>Total:</strong> $37.00</p>
            
            <h2>Shipping Address:</h2>
            <p>${formattedAddress}</p>
            
            <p>Your order has been confirmed and will be shipped soon!</p>
            <p>Order ID: ${orderId}</p>
            <p>You can track your order here: https://www.printful.com/dashboard/order/${orderId}</p>
            
            <p>Thanks for the support!</p>
        `;

        await transporter.sendMail({
            from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
            to: session.customer_details.email,
            subject: 'Order Confirmation - Weird Roach Store',
            html: emailContent,
            text: `Order Details:\n\n1x French Elephant Pullover - Black (XL) - $32.00\n\nSubtotal: $32.00\nShipping: $5.00\nTotal: $37.00\n\nShipping to:\n${session.shipping_details.name}\n${shippingAddress.line1}\n${shippingAddress.line2 ? shippingAddress.line2 + '\n' : ''}${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}\n${shippingAddress.country}\n\nYour order has been confirmed and will be shipped soon!\n\nOrder ID: ${orderId}\nTrack your order: https://www.printful.com/dashboard/order/${orderId}\n\nThanks for the support!`,
            headers: {
                'X-Entity-Ref-ID': session.id,
                'X-Mailer': 'Weird Roach Store Mailer',
                'X-Priority': '1',
                'Importance': 'high'
            }
        });

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
        console.error('Error processing order:', error);
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
} 