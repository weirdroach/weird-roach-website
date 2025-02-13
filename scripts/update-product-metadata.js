import Stripe from 'stripe';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map of product names to their Printful variant IDs
const PRINTFUL_VARIANT_MAP = {
    // French Elephant T-Shirt Products
    'French Elephant - Black (S)': '14904',
    'French Elephant - Black (M)': '14904',
    'French Elephant - Black (L)': '14904',
    'French Elephant - Black (XL)': '14904',
    'French Elephant - Black (2XL)': '14904',
    
    // French Elephant Pullover Products
    'French Elephant Pullover - Black (S)': '14902',
    'French Elephant Pullover - Black (M)': '14902',
    'French Elephant Pullover - Black (L)': '14902',
    'French Elephant Pullover - Black (XL)': '14902',
    'French Elephant Pullover - Black (2XL)': '14902',
    
    // Phuture Times Products
    'Phuture Times - Black (S)': '14903',
    'Phuture Times - Black (M)': '14903',
    'Phuture Times - Black (L)': '14903',
    'Phuture Times - Black (XL)': '14903',
    'Phuture Times - Black (2XL)': '14903',
    
    // Add more products here as they are created
    // Format: 'Product Name - Color (Size)': 'printful_variant_id'
};

async function updateProductMetadata() {
    try {
        console.log('Fetching all products from Stripe...');
        const products = await stripe.products.list({
            limit: 100,
            active: true
        });

        console.log(`Found ${products.data.length} products`);

        for (const product of products.data) {
            console.log(`\nProcessing product: ${product.name}`);
            
            // Check if product already has printful_variant_id
            if (product.metadata.printful_variant_id) {
                console.log(`Product already has variant ID: ${product.metadata.printful_variant_id}`);
                continue;
            }

            // Find matching variant ID
            const variantId = PRINTFUL_VARIANT_MAP[product.name];
            if (!variantId) {
                console.log(`No variant ID mapping found for: ${product.name}`);
                continue;
            }

            // Update product metadata
            console.log(`Updating metadata for ${product.name} with variant ID: ${variantId}`);
            await stripe.products.update(product.id, {
                metadata: {
                    ...product.metadata,
                    printful_variant_id: variantId
                }
            });
            console.log('✓ Updated successfully');
        }

        console.log('\nAll products processed successfully');
    } catch (error) {
        console.error('Error updating product metadata:', error);
    }
}

// Run the update
updateProductMetadata().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
}); 