const nodemailer = require('nodemailer');
require('dotenv').config();

// SMTP Configuration
const smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const transporter = nodemailer.createTransport(smtpConfig);

// Welcome email template
function getWelcomeEmailTemplate(userName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to InshuVerse AI</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 10px;
          padding: 30px;
          color: white;
        }
        .content {
          background: white;
          border-radius: 10px;
          padding: 30px;
          color: #333;
        }
        .welcome-text {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 20px;
          color: #667eea;
        }
        .feature-list {
          margin: 20px 0;
        }
        .feature-list li {
          margin: 10px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h1 class="welcome-text">🎉 Welcome to InshuVerse AI</h1>
          <p>Hi ${userName},</p>
          <p>Welcome to InshuVerse AI!</p>
          <p>Your account has been created successfully.</p>
          <p><strong>Plan:</strong> Free</p>
          <p><strong>Credits:</strong> 7</p>
          <p>You can now enjoy:</p>
          <ul class="feature-list">
            <li>✓ AI Chat</li>
            <li>✓ Manual Listening</li>
            <li>✓ Automatic Listening</li>
            <li>✓ OCR</li>
            <li>✓ Smart Assistance</li>
          </ul>
          <p>Upgrade anytime for more credits.</p>
          <p>Regards,<br>A&V Techsolutions</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Send welcome email
async function sendWelcomeEmail(userEmail, userName) {
  try {
    const mailOptions = {
      from: `"InshuVerse AI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: userEmail,
      subject: '🎉 Welcome to InshuVerse AI',
      html: getWelcomeEmailTemplate(userName),
    };
    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Welcome email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send welcome email:', error);
    return { success: false, error: error.message };
  }
}

// Login notification email template
function getLoginEmailTemplate(userName, loginTime, ipAddress, device) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Login Detected</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          border-radius: 10px;
          padding: 30px;
          color: white;
        }
        .content {
          background: white;
          border-radius: 10px;
          padding: 30px;
          color: #333;
        }
        .info {
          background: #f3f4f6;
          padding: 15px;
          margin: 10px 0;
          border-radius: 5px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h1>New Login Detected</h1>
          <p>Hi ${userName},</p>
          <p>You have successfully logged into your InshuVerse AI account.</p>
          <div class="info">
            <p><strong>Login Time:</strong> ${loginTime}</p>
            <p><strong>IP Address:</strong> ${ipAddress}</p>
            <p><strong>Device:</strong> ${device}</p>
          </div>
          <p>If this wasn't you, please contact help@inshuverse.ai</p>
          <p>Regards,<br>A&V Techsolutions</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Send login notification email
async function sendLoginEmail(userEmail, userName, loginTime, ipAddress, device) {
  try {
    const mailOptions = {
      from: `"InshuVerse AI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: userEmail,
      subject: 'New Login Detected',
      html: getLoginEmailTemplate(userName, loginTime, ipAddress, device),
    };
    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Login email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send login email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendWelcomeEmail,
  sendLoginEmail,
};
