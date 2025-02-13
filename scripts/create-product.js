import Stripe from 'stripe';
import dotenv from 'dotenv';
import readline from 'readline';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function createProduct() {
    try {
        console.log('=== Create New Stripe Product ===\n');
        
        // Get product details
        const name = await question('Product name (e.g., "French Elephant - Black (XL)"): ');
        const description = await question('Product description: ');
        const priceInDollars = await question('Price (in USD): ');
        const printfulVariantId = await question('Printful variant ID: ');
        const imageUrl = await question('Product image URL: ');

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
            unit_amount: Math.round(parseFloat(priceInDollars) * 100),
            currency: 'usd'
        });

        console.log('\nProduct created successfully!');
        console.log('Product ID:', product.id);
        console.log('Price ID:', price.id);
        console.log('Printful Variant ID:', printfulVariantId);

    } catch (error) {
        console.error('Error creating product:', error);
    } finally {
        rl.close();
    }
}

// Run the creation script
createProduct().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
}); 