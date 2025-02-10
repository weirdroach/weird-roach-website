import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Get the authorization code from the query parameters
    const { code } = req.query;

    if (!code) {
        return res.status(400).json({ error: 'No authorization code provided' });
    }

    try {
        // Exchange the authorization code for an access token
        const tokenResponse = await fetch('https://www.printful.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: process.env.PRINTFUL_STORE_ID,
                client_secret: process.env.PRINTFUL_API_TOKEN,
                code: code,
                redirect_uri: `${process.env.NODE_ENV === 'production' ? 'https://weirdroach.com' : 'http://localhost:3000'}/api/auth/printful-callback`
            })
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('Token exchange failed:', tokenData);
            return res.status(tokenResponse.status).json({
                error: 'Failed to exchange authorization code for token',
                details: tokenData
            });
        }

        // Store the access token securely (you'll need to implement this)
        // For now, we'll just return it
        res.status(200).json({
            message: 'Authorization successful',
            token: tokenData
        });
    } catch (error) {
        console.error('Auth callback error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
} 