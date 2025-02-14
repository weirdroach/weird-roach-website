export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const payload = req.body;
        console.log('Test webhook received:', payload);

        // Simulate webhook processing
        if (payload.type === 'checkout.session.completed') {
            const session = payload.data.object;
            
            console.log('Processing test checkout session:', {
                id: session.id,
                customer: session.customer_details,
                shipping: session.shipping_details,
                amount: session.amount_total
            });

            return res.json({
                received: true,
                mode: 'test',
                processed: {
                    type: payload.type,
                    session_id: session.id,
                    amount: session.amount_total,
                    customer_email: session.customer_details?.email,
                    shipping_name: session.shipping_details?.name
                }
            });
        }

        return res.json({
            received: true,
            mode: 'test',
            event_type: payload.type
        });
    } catch (error) {
        console.error('Test webhook error:', error);
        return res.status(500).json({
            error: 'Test webhook handler failed',
            details: error.message
        });
    }
} 