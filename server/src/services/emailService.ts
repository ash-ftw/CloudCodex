import nodemailer from 'nodemailer';
import { config } from '../config/index';

const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
    }
});

function buildWelcomeEmail(username: string): { subject: string; html: string } {
    const subject = 'Welcome to CloudCodeX!';
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
            body { margin: 0; padding: 0; background: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .card { background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1 { color: #333333; margin-top: 0; }
            p { color: #555555; line-height: 1.6; }
            .btn { display: inline-block; background: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px; }
            .footer { text-align: center; color: #999999; font-size: 12px; margin-top: 32px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h1>Welcome, ${escapeHtml(username)}!</h1>
                <p>Thanks for signing up for <strong>CloudCodeX</strong> — your cloud-based coding environment.</p>
                <p>You can now write, run, and collaborate on code in 10+ languages right from your browser. Here are a few things to try:</p>
                <ul>
                    <li>Create a new project and start coding instantly</li>
                    <li>Connect your GitHub account to push and pull repos</li>
                    <li>Share projects and collaborate in real time</li>
                </ul>
                <a href="${escapeHtml(config.frontend.url)}" class="btn">Open CloudCodeX</a>
                <p style="margin-top: 24px;">Happy coding!<br/>The CloudCodeX Team</p>
            </div>
            <div class="footer">
                <p>You received this email because you signed up for CloudCodeX.</p>
            </div>
        </div>
    </body>
    </html>`;
    return { subject, html };
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
    if (!config.smtp.host) {
        console.warn('SMTP not configured — skipping welcome email');
        return;
    }

    const { subject, html } = buildWelcomeEmail(username);

    try {
        await transporter.sendMail({
            from: config.smtp.from,
            to,
            subject,
            html
        });
        console.log(`Welcome email sent to ${to}`);
    } catch (err) {
        console.error('Failed to send welcome email:', err);
    }
}
