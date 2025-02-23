import fetch from "node-fetch";

const PRINTFUL_API_URL = "https://api.printful.com";
const PRINTFUL_ACCESS_TOKEN = process.env.PRINTFUL_ACCESS_TOKEN;
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID; // Store ID now required

// ✅ Fallback Variant ID
const FALLBACK_VARIANT_ID = 14904;

// Function to fetch the correct variant_id
const getPrintfulVariantId = async (productName) => {
    try {
        const response = await fetch(`${PRINTFUL_API_URL}/sync/products`, {
            headers: { Authorization: `Bearer ${PRINTFUL_ACCESS_TOKEN}` },
        });
        const data = await response.json();

        for (const product of data.result) {
            if (product.name.includes(productName)) {
                const firstVariant = product.sync_variants?.[0]?.variant_id;
                if (firstVariant) return firstVariant;
            }
        }
    } catch (error) {
        console.error("❌ Error fetching Printful variants:", error);
    }
    return FALLBACK_VARIANT_ID; // Use fallback if no variant is found
};

// Webhook handler
export default async function handler(req, res) {
    try {
        if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

        const event = req.body;
        if (event.type !== "checkout.session.completed") {
            return res.status(400).json({ error: "Unhandled event type" });
        }

        console.log("🛒 Processing Checkout Session:", event.data.object.id);
        const session = event.data.object;

        // Fetch line items from Stripe session
        const lineItemsResponse = await fetch(
            `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,
            { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
        );
        const lineItems = await lineItemsResponse.json();

        let items = [];
        for (const item of lineItems.data) {
            const productName = item.description;
            console.log("🔍 Searching Printful for variant of:", productName);

            const variantId = await getPrintfulVariantId(productName);
            console.log(`✅ Found Variant ID: ${variantId} for "${productName}"`);

            items.push({
                variant_id: variantId,
                quantity: item.quantity,
                retail_price: (item.amount_subtotal / 100).toFixed(2),
            });
        }

        if (!items.length) {
            console.error("❌ No valid items found.");
            return res.status(400).json({ error: "No valid items found for Printful" });
        }

        // Create Printful Order
        const printfulPayload = {
            store_id: PRINTFUL_STORE_ID, // ✅ Store ID is now included
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
            confirm: true, // Auto-confirm order
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
