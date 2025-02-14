import Stripe from 'stripe';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

        // 3. Get the price of the old product
        console.log('\nFetching prices...');
        const prices = await stripe.prices.list({
            product: oldProductId,
            limit: 1
        });
        
        if (prices.data.length === 0) {
            console.log('No prices found for old product');
            return;
        }

        const oldPrice = prices.data[0];
        console.log('Old price:', {
            id: oldPrice.id,
            unit_amount: oldPrice.unit_amount,
            currency: oldPrice.currency
        });

        // 4. Create new price for new product
        console.log('\nCreating new price...');
        const newPrice = await stripe.prices.create({
            product: newProduct.id,
            unit_amount: oldPrice.unit_amount,
            currency: oldPrice.currency
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