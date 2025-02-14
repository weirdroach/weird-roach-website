import Stripe from 'stripe';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_API_URL = 'https://api.printful.com';

async function fetchPrintfulVariantPrice(variantId) {
    const response = await fetch(`${PRINTFUL_API_URL}/store/variants/${variantId}`, {
        headers: {
            'Authorization': `Bearer ${process.env.PRINTFUL_ACCESS_TOKEN}`,
            'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch variant price: ${await response.text()}`);
    }

    const data = await response.json();
    return data.result.retail_price;
}

async function createPrice() {
    try {
        const productId = 'prod_Rlk6oN82SpXIg4';  // New Phuture - Black (M) product
        const printfulVariantId = '14903';  // Phuture variant ID

        // Fetch the price from Printful
        console.log(`Fetching price for Printful variant ${printfulVariantId}...`);
        const retailPrice = await fetchPrintfulVariantPrice(printfulVariantId);
        console.log(`Printful retail price: $${retailPrice}`);

        console.log(`Creating price for product ${productId}...`);
        const price = await stripe.prices.create({
            product: productId,
            unit_amount: Math.round(parseFloat(retailPrice) * 100),  // Convert to cents
            currency: 'usd'
        });

        console.log('Price created successfully:', {
            id: price.id,
            product: price.product,
            unit_amount: price.unit_amount,
            currency: price.currency
        });

        // Set this as the default price for the product
        console.log('\nSetting as default price...');
        await stripe.products.update(productId, {
            default_price: price.id
        });
        console.log('✓ Default price set');

    } catch (error) {
        console.error('Error creating price:', error);
    }
}

// Run the price creation
createPrice().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
}); 