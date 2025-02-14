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

async function recreateProduct() {
    try {
        const oldProductId = 'prod_RlgSP06ztDLNTU';
        const printfulVariantId = '14903';

        // 1. Get the old product details
        console.log('Fetching old product...');
        const oldProduct = await stripe.products.retrieve(oldProductId);
        console.log('Old product:', {
            id: oldProduct.id,
            name: oldProduct.name,
            images: oldProduct.images,
            metadata: oldProduct.metadata
        });

        // 2. Create new product with correct metadata
        console.log('\nCreating new product...');
        const newProduct = await stripe.products.create({
            name: oldProduct.name,
            images: oldProduct.images,
            metadata: {
                printful_variant_id: printfulVariantId
            },
            active: true
        });
        console.log('New product created:', {
            id: newProduct.id,
            name: newProduct.name,
            metadata: newProduct.metadata
        });

        // 3. Fetch price from Printful
        console.log('\nFetching price from Printful...');
        const retailPrice = await fetchPrintfulVariantPrice(printfulVariantId);
        console.log(`Printful retail price: $${retailPrice}`);

        // 4. Create new price for new product
        console.log('\nCreating new price...');
        const newPrice = await stripe.prices.create({
            product: newProduct.id,
            unit_amount: Math.round(parseFloat(retailPrice) * 100),
            currency: 'usd'
        });
        console.log('New price created:', {
            id: newPrice.id,
            unit_amount: newPrice.unit_amount,
            currency: newPrice.currency
        });

        // 5. Archive old product
        console.log('\nArchiving old product...');
        await stripe.products.update(oldProductId, {
            active: false
        });
        console.log('Old product archived');

        console.log('\n✓ Product recreation completed successfully');
        console.log('New product ID:', newProduct.id);
        console.log('New price ID:', newPrice.id);
        console.log('Retail Price:', `$${retailPrice}`);
    } catch (error) {
        console.error('Error recreating product:', error);
    }
}

// Run the recreation
recreateProduct().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
}); 