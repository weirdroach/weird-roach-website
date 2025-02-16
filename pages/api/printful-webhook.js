import nodemailer from 'nodemailer';

// Email configuration
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD.trim()
    },
    debug: true,
    logger: true,
    tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
    }
});

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const data = req.body;
        console.log('Received Printful webhook:', JSON.stringify(data, null, 2));

        // Verify that this is a shipping status update
        if (data.type === 'package_shipped') {
            const order = data.data;
            console.log('Processing shipping notification for order:', order.id);

            // Create email content
            const emailContent = `
                <h1>Your Weird Roach Order Has Shipped! 🎉</h1>
                <p>Great news! Your order has been shipped and is on its way to you.</p>
                
                <h2>Shipping Details:</h2>
                <p><strong>Order ID:</strong> ${order.id}</p>
                <p><strong>Tracking Number:</strong> ${order.tracking_number}</p>
                <p><strong>Carrier:</strong> ${order.carrier}</p>
                <p><strong>Tracking URL:</strong> <a href="${order.tracking_url}">${order.tracking_url}</a></p>
                
                <h2>Estimated Delivery:</h2>
                <p>${order.estimated_delivery_date || 'Typically 5-7 business days'}</p>
                
                <h2>Shipping Address:</h2>
                <p>
                    ${order.recipient.name}<br>
                    ${order.recipient.address1}<br>
                    ${order.recipient.address2 ? order.recipient.address2 + '<br>' : ''}
                    ${order.recipient.city}, ${order.recipient.state_code} ${order.recipient.zip}<br>
                    ${order.recipient.country_code}
                </p>
                
                <h2>Order Summary:</h2>
                ${order.items.map(item => `
                    <p>${item.quantity}x ${item.name} - $${item.retail_price}</p>
                `).join('')}
                
                <p><strong>Total:</strong> $${order.retail_costs.total}</p>
                
                <p>You can track your package using the tracking number and URL above.</p>
                
                <p>Thanks again for your support!</p>
                <p>- Weird Roach Team</p>
            `;

            // Send the email
            await transporter.sendMail({
                from: `"Weird Roach Store" <${process.env.EMAIL_USER}>`,
                to: order.recipient.email,
                subject: '🚚 Your Weird Roach Order Has Shipped!',
                html: emailContent,
                text: `
Your Weird Roach Order Has Shipped! 🎉

Great news! Your order has been shipped and is on its way to you.

Shipping Details:
Order ID: ${order.id}
Tracking Number: ${order.tracking_number}
Carrier: ${order.carrier}
Tracking URL: ${order.tracking_url}

Estimated Delivery:
${order.estimated_delivery_date || 'Typically 5-7 business days'}

Shipping Address:
${order.recipient.name}
${order.recipient.address1}
${order.recipient.address2 ? order.recipient.address2 + '\n' : ''}
${order.recipient.city}, ${order.recipient.state_code} ${order.recipient.zip}
${order.recipient.country_code}

Order Summary:
${order.items.map(item => `${item.quantity}x ${item.name} - $${item.retail_price}`).join('\n')}

Total: $${order.retail_costs.total}

You can track your package using the tracking number and URL above.

Thanks again for your support!
- Weird Roach Team
                `,
                headers: {
                    'X-Entity-Ref-ID': order.id,
                    'X-Mailer': 'Weird Roach Store Mailer',
                    'X-Priority': '1',
                    'Importance': 'high'
                }
            });

            console.log('Shipping notification email sent successfully');
            return res.json({ success: true });
        }

        // For other webhook types, just acknowledge receipt
        return res.json({ received: true });
    } catch (error) {
        console.error('Error processing Printful webhook:', error);
        return res.status(500).json({ error: error.message });
    }
} 