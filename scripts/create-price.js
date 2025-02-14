import Stripe from 'stripe';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function createPrice() {
    try {
        const productId = 'prod_Rlk6oN82SpXIg4';  // New Phuture - Black (M) product
        const priceInDollars = 37.00;  // Set the price in dollars

        console.log(`Creating price for product ${productId}...`);
        const price = await stripe.prices.create({
            product: productId,
            unit_amount: Math.round(priceInDollars * 100),  // Convert to cents
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