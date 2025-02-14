import Stripe from 'stripe';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

// Load environment variables
dotenv.config();

const execAsync = promisify(exec);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function checkProduct() {
    try {
        const productId = 'prod_RlgSP06ztDLNTU';  // Phuture - Black (M)
        const command = `curl -s -H "Authorization: Bearer ${process.env.STRIPE_SECRET_KEY}" https://api.stripe.com/v1/products/${productId}`;
        
        console.log('Checking current product state...');
        const { stdout } = await execAsync(command);
        console.log('Current product:', JSON.parse(stdout));
    } catch (error) {
        console.error('Error checking product:', error);
    }
}

async function fixProduct() {
    try {
        const productId = 'prod_RlgSP06ztDLNTU';  // Phuture - Black (M)
        const variantId = '14903';  // Phuture variant ID

        // First check current state
        await checkProduct();

        console.log(`\nUpdating product ${productId} with variant ID ${variantId}...`);
        
        // Update product metadata
        const updatedProduct = await stripe.products.update(productId, {
            metadata: {
                printful_variant_id: variantId
            }
        });

        console.log('Updated product:', {
            id: updatedProduct.id,
            name: updatedProduct.name,
            metadata: updatedProduct.metadata
        });

        // Verify the update
        console.log('\nVerifying update...');
        await checkProduct();

        console.log('\n✓ Product updated successfully');
    } catch (error) {
        console.error('Error updating product:', error);
    }
}

// Run the fix
fixProduct().then(() => {
    console.log('\nScript completed');
    process.exit(0);
}).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
}); 