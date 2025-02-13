import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Create transporter
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD.trim()
            },
            debug: true,
            logger: true
        });

        // Verify connection
        const verification = await transporter.verify();
        
        // Test email configuration
        const emailConfig = {
            status: verification ? 'connected' : 'error',
            email: process.env.EMAIL_USER,
            smtp: {
                host: 'smtp.gmail.com',
                port: 465,
                secure: true
            }
        };

        res.status(200).json(emailConfig);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
} 