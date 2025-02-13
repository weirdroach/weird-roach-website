import Stripe from 'stripe';
import fetch from 'node-fetch';

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
    console.log('Printful Response Body:', responseText);

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
            payment_intent: payment_intent
        });

        if (!sessions.data.length) {
            return res.status(404).json({ error: 'No checkout session found for this payment' });
        }

        const session = sessions.data[0];
        console.log('Found checkout session:', session.id);

        // Get session with line items
        const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items']
        });

        // Get line items with product details
        const lineItems = [];
        for (const item of expandedSession.line_items.data) {
            console.log('\nProcessing line item:', {
                price_id: item.price.id,
                quantity: item.quantity,
                amount_total: item.amount_total,
                description: item.description
            });
            
            const price = await stripe.prices.retrieve(item.price.id);
            console.log('Retrieved price:', {
                id: price.id,
                product_id: price.product,
                unit_amount: price.unit_amount,
                currency: price.currency
            });
            
            const product = await stripe.products.retrieve(price.product);
            console.log('Retrieved product:', {
                id: product.id,
                name: product.name,
                metadata: product.metadata,
                description: product.description,
                images: product.images
            });

            // If product has no metadata, try to find a matching product with metadata
            let productWithMetadata = product;
            if (!product.metadata.printful_variant_id) {
                console.log('Product has no metadata, searching for matching product...');
                
                const products = await stripe.products.list({
                    limit: 100,
                    active: true
                });
                
                // Normalize product names for comparison
                const normalizeProductName = (name) => {
                    return name.toLowerCase()
                        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                        .trim();               // Remove leading/trailing spaces
                };
                
                const currentProductName = normalizeProductName(product.name);
                console.log('Looking for products matching:', currentProductName);
                
                // Find products with matching names
                const matchingProducts = products.data.filter(p => {
                    const normalizedName = normalizeProductName(p.name);
                    const isMatch = normalizedName === currentProductName;
                    console.log(`Comparing "${normalizedName}" with "${currentProductName}": ${isMatch}`);
                    return isMatch && p.metadata.printful_variant_id;
                });
                
                console.log('Found matching products:', matchingProducts.map(p => ({
                    id: p.id,
                    name: p.name,
                    metadata: p.metadata
                })));
                
                if (matchingProducts.length > 0) {
                    const matchingProduct = matchingProducts[0];
                    console.log('Using matching product:', {
                        id: matchingProduct.id,
                        name: matchingProduct.name,
                        metadata: matchingProduct.metadata
                    });
                    productWithMetadata = matchingProduct;
                }
            }

            // Check if product has required metadata
            if (!productWithMetadata.metadata.printful_variant_id) {
                console.error('Product is missing printful_variant_id:', {
                    product_id: product.id,
                    name: product.name,
                    metadata: product.metadata
                });
                return res.status(400).json({
                    status: 'error',
                    message: `Product "${product.name}" is missing Printful variant ID in metadata`,
                    details: {
                        product_id: product.id,
                        name: product.name,
                        metadata: product.metadata
                    }
                });
            }
            
            lineItems.push({
                ...item,
                price: {
                    ...price,
                    product: productWithMetadata
                }
            });
        }

        console.log('\nPreparing Printful order with line items:', 
            lineItems.map(item => ({
                description: item.description,
                quantity: item.quantity,
                amount_total: item.amount_total,
                price_id: item.price.id,
                product_id: item.price.product.id,
                variant_id: item.price.product.metadata.printful_variant_id
            }))
        );

        // Check if order already exists for this payment intent
        console.log('Checking for existing orders...');
        const existingOrdersResponse = await makePrintfulRequest('/orders', {
            method: 'GET'
        });

        if (existingOrdersResponse.ok) {
            const existingOrder = existingOrdersResponse.json.result.find(order => 
                order.retail_costs.total === (expandedSession.amount_total / 100).toString() &&
                order.recipient.email === session.customer_details.email &&
                order.created > paymentIntent.created - 3600 // Within the last hour
            );

            if (existingOrder) {
                console.log('Found existing order:', existingOrder.id);
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
                    printful_order: existingOrder
                });
            }
        }

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
            items: lineItems.map(item => {
                const variantId = item.price.product.metadata.printful_variant_id;
                console.log(`\nProcessing Printful order item:`, {
                    description: item.description,
                    metadata: item.price.product.metadata,
                    variant_id: variantId,
                    quantity: item.quantity,
                    amount_total: item.amount_total
                });
                
                if (!variantId) {
                    console.error('Missing printful_variant_id in product metadata:', item.price.product);
                    throw new Error(`Missing Printful variant ID for product: ${item.price.product.name}`);
                }

                // Get the sync variant ID from Printful
                const syncVariantId = 4711377369; // This is the sync variant ID we found earlier
                
                return {
                    sync_variant_id: syncVariantId,
                    quantity: item.quantity,
                    retail_price: (item.amount_total / 100).toString()
                };
            }),
            retail_costs: {
                subtotal: (expandedSession.amount_subtotal / 100).toString(),
                shipping: (expandedSession.total_details.amount_shipping / 100).toString(),
                tax: (expandedSession.total_details.amount_tax / 100).toString(),
                total: (expandedSession.amount_total / 100).toString()
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
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create Printful order',
                printful_error: printfulResponse.json
            });
        }

        // Confirm the order
        const orderId = printfulResponse.json.result.id;
        console.log('Confirming Printful order:', orderId);

        const confirmResponse = await makePrintfulRequest(`/orders/${orderId}/confirm`, {
            method: 'POST'
        });

        if (!confirmResponse.ok) {
            console.error('Failed to confirm order:', confirmResponse.json);
            return res.status(500).json({
                status: 'error',
                message: 'Failed to confirm Printful order',
                printful_error: confirmResponse.json
            });
        }

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
                ...printfulResponse.json.result,
                confirmed: confirmResponse.json.result
            }
        });
    } catch (error) {
        console.error('Error checking order:', error);
        return res.status(500).json({
            status: 'error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
} 