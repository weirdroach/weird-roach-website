export default function handler(req, res) {
    const clientId = process.env.PRINTFUL_STORE_ID;
    const redirectUri = `${process.env.NODE_ENV === 'production' ? 'https://weirdroach.com' : 'http://localhost:3000'}/api/auth/printful-callback`;
    const scopes = 'orders products files webhooks'; // Add all required scopes

    const authUrl = `https://www.printful.com/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=${encodeURIComponent(scopes)}`;

    // Redirect the user to Printful's authorization page
    res.redirect(authUrl);
} 