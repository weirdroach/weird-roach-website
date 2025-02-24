import fetch from "node-fetch";

const PRINTFUL_API_URL = "https://api.printful.com";
const PRINTFUL_ACCESS_TOKEN = process.env.PRINTFUL_ACCESS_TOKEN;
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const FALLBACK_VARIANT_ID = 4710789877; // Updated to sync_variant_id of French Elephant S
const PRODUCTS_API_URL = "https://www.weirdroach.com/api/products"; // Your API

// ✅ Fetch product variants from Weird Roach API
const getVariantIdFromWeirdRoach = async (productName) => {
    try {
        console.log("🔍 Fetching variants from Weird Roach API...");
        const response = await fetch(PRODUCTS_API_URL);
        
        if (!response.ok) {
            console.error(`❌ Weird Roach API request failed: ${response.status}`);
            return { sync_variant_id: FALLBACK_VARIANT_ID };
        }

        const products = await response.json();
        if (!products || products.length === 0) {
            console.error("❌ Weird Roach API returned empty response.");
            return { sync_variant_id: FALLBACK_VARIANT_ID };
        }

        // First find the matching product
        const product = products.find(p => 
            productName.toLowerCase().includes(p.name.toLowerCase()) || 
            p.name.toLowerCase().includes(productName.toLowerCase())
        );

        if (!product) {
            console.warn(`⚠️ No product found for "${productName}". Using fallback.`);
            return { sync_variant_id: FALLBACK_VARIANT_ID };
        }

        // Get the smallest size variant (usually S) as default
        const variant = product.variants.find(v => v.size === 'S') || product.variants[0];
        
        if (!variant) {
            console.warn(`⚠️ No variant found for "${productName}". Using fallback.`);
            return { sync_variant_id: FALLBACK_VARIANT_ID };
        }

        console.log(`✅ Found variant for "${productName}":`, variant.name);
        return {
            sync_variant_id: variant.sync_variant_id,
            price: variant.retail_price || null
        };
    } catch (error) {
        console.error("❌ Error fetching Weird Roach products:", error);
        return { sync_variant_id: FALLBACK_VARIANT_ID };
    }
};

// ✅ Webhook Handler
export default async function handler(req, res) {
    try {
        if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

        const event = req.body;
        if (event.type !== "checkout.session.completed") {
            return res.status(400).json({ error: "Unhandled event type" });
        }

        console.log("🛒 Processing Checkout Session:", event.data.object.id);
        const session = event.data.object;

        // ✅ Fetch line items from Stripe session
        const lineItemsResponse = await fetch(
            `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,
            {
                headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
            }
        );

        const lineItems = await lineItemsResponse.json();
        if (!lineItems.data || lineItems.data.length === 0) {
            console.error("❌ No items found in Stripe session.");
            return res.status(400).json({ error: "No valid items found for Printful" });
        }

        let items = [];
        for (const item of lineItems.data) {
            const productName = item.description;
            console.log("🔍 Searching for variant of:", productName);

            const { sync_variant_id, price } = await getVariantIdFromWeirdRoach(productName);
            items.push({
                sync_variant_id,
                quantity: item.quantity,
                retail_price: price || (item.amount_subtotal / 100).toFixed(2)
            });
        }

        if (!items.length) {
            console.error("❌ No valid items found.");
            return res.status(400).json({ error: "No valid items found for Printful" });
        }

        // ✅ Create Printful Order
        const printfulPayload = {
            store_id: PRINTFUL_STORE_ID,
            recipient: {
                name: session.customer_details.name,
                address1: session.customer_details.address.line1,
                address2: session.customer_details.address.line2 || "",
                city: session.customer_details.address.city,
                state_code: session.customer_details.address.state || "",
                country_code: session.customer_details.address.country,
                zip: session.customer_details.address.postal_code,
                email: session.customer_details.email,
                phone: session.customer_details.phone || "",
            },
            items,
            retail_costs: {
                subtotal: (session.amount_subtotal / 100).toFixed(2),
                shipping: (session.shipping_cost.amount_total / 100).toFixed(2),
                tax: "0",
                total: (session.amount_total / 100).toFixed(2),
            },
            packing_slip: {
                email: "weirdroach@gmail.com",
                phone: "",
                message: "Thank you for your order!",
            },
            confirm: true,
        };

        console.log("📦 Sending Order to Printful:", JSON.stringify(printfulPayload, null, 2));

        const printfulResponse = await fetch(`${PRINTFUL_API_URL}/orders`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${PRINTFUL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(printfulPayload),
        });

        const printfulResult = await printfulResponse.json();
        if (!printfulResponse.ok) {
            console.error("❌ Printful API Error:", printfulResult);
            return res.status(400).json({ error: "Printful order failed", details: printfulResult });
        }

        console.log("✅ Printful Order Created:", printfulResult);
        return res.status(200).json({ success: true, printfulOrder: printfulResult });

    } catch (error) {
        console.error("❌ Webhook Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}
