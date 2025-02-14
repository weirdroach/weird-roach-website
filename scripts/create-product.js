import Stripe from 'stripe';
import dotenv from 'dotenv';
import readline from 'readline';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_API_URL = 'https://api.printful.com';

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify readline.question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

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

async function createProduct() {
    try {
        console.log('=== Create New Stripe Product ===\n');
        
        // Get product details
        const name = await question('Product name (e.g., "French Elephant - Black (XL)"): ');
        const description = await question('Product description: ');
        const printfulVariantId = await question('Printful variant ID: ');
        const imageUrl = await question('Product image URL: ');

        // Fetch price from Printful
        console.log('\nFetching price from Printful...');
        const retailPrice = await fetchPrintfulVariantPrice(printfulVariantId);
        console.log(`Printful retail price: $${retailPrice}`);

        // Create product
        console.log('\nCreating product in Stripe...');
        const product = await stripe.products.create({
            name,
            description,
            images: imageUrl ? [imageUrl] : [],
            metadata: {
                printful_variant_id: printfulVariantId
            }
        });

        // Create price
        console.log('Creating price...');
        const price = await stripe.prices.create({
            product: product.id,
            unit_amount: Math.round(parseFloat(retailPrice) * 100),
            currency: 'usd'
        });

        console.log('\nProduct created successfully!');
        console.log('Product ID:', product.id);
        console.log('Price ID:', price.id);
        console.log('Printful Variant ID:', printfulVariantId);
        console.log('Retail Price:', `$${retailPrice}`);

    } catch (error) {
        console.error('Error creating product:', error);
    } finally {
        rl.close();
    }
}

// Run the product creation
createProduct().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
}); 