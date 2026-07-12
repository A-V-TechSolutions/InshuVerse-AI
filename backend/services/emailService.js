const nodemailer = require('nodemailer');
require('dotenv').config();

// SMTP Configuration
const smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

// Create transporter
const transporter = nodemailer.createTransporter(smtpConfig);

// Verify SMTP connection
async function verifySmtpConnection() {
  try {
    await transporter.verify();
    console.log('[EMAIL] SMTP server is ready to send emails');
    return true;
  } catch (error) {
    console.error('[EMAIL] SMTP connection failed:', error);
    return false;
  }
}

// Welcome email template
function getWelcomeEmailTemplate(userName, userEmail) {
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
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .logo {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 10px;
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
          padding-left: 20px;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 5px;
          margin: 20px 0;
          font-weight: bold;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          color: #666;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">✨ InshuVerse AI</div>
          <p>Your AI-Powered Interview Assistant</p>
        </div>
        
        <div class="content">
          <h1 class="welcome-text">Welcome to InshuVerse AI!</h1>
          
          <p>Dear ${userName || 'User'},</p>
          
          <p>Thank you for signing up for InshuVerse AI! We're excited to have you on board and can't wait to help you ace your interviews.</p>
          
          <h3>What You Can Do:</h3>
          <ul class="feature-list">
            <li>🎤 <strong>Real-time Voice Transcription</strong> - Get instant transcription of your interviews</li>
            <li>📸 <strong>Screenshot Analysis</strong> - Capture and analyze questions instantly</li>
            <li>💬 <strong>AI-Powered Answers</strong> - Get intelligent responses powered by GPT-4 and Gemini</li>
            <li>🛡️ <strong>Hide Mode</strong> - Protect your screen during screen sharing</li>
            <li>📊 <strong>Usage Analytics</strong> - Track your credits and usage</li>
          </ul>
          
          <p>You have been granted <strong>7 free credits</strong> to get started. Each credit allows you to:</p>
          <ul class="feature-list">
            <li>Transcribe voice recordings</li>
            <li>Analyze screenshots</li>
            <li>Get AI-powered answers</li>
          </ul>
          
          <p style="text-align: center;">
            <a href="https://inshuverse-ai.onrender.com" class="button">Get Started Now</a>
          </p>
          
          <p>Need help? Check out our documentation or contact support at avtechsolutions312@gmail.com</p>
          
          <div class="footer">
            <p>This email was sent to ${userEmail}</p>
            <p>© 2024 InshuVerse AI. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Send welcome email
async function sendWelcomeEmail(userEmail, userName) {
  console.log('[EMAIL] sendWelcomeEmail called with:', { userEmail, userName });
  console.log('[EMAIL] SMTP config check:', {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER ? 'SET' : 'NOT SET',
    pass: process.env.SMTP_PASS ? 'SET' : 'NOT SET',
    from: process.env.SMTP_FROM || process.env.SMTP_USER
  });

  try {
    const mailOptions = {
      from: `"InshuVerse AI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: userEmail,
      subject: 'Welcome to InshuVerse AI - Your AI Interview Assistant',
      html: getWelcomeEmailTemplate(userName, userEmail),
    };

    console.log('[EMAIL] Attempting to send email with options:', { from: mailOptions.from, to: mailOptions.to });
    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Welcome email sent successfully:', info.messageId);
    console.log('[EMAIL] Email response:', info);
    return { success: true, messageId: info.messageId, response: info };
  } catch (error) {
    console.error('[EMAIL] Failed to send welcome email:', error);
    console.error('[EMAIL] Error details:', {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode
    });
    return { success: false, error: error.message, details: error };
  }
}

// Send credit low notification email
function getCreditLowEmailTemplate(userName, currentCredits) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Low Credits - InshuVerse AI</title>
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
        .warning {
          background: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 15px;
          margin: 20px 0;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 5px;
          margin: 20px 0;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="content">
          <h1 style="color: #f5576c;">⚠️ Low Credits Warning</h1>
          
          <p>Dear ${userName || 'User'},</p>
          
          <div class="warning">
            <strong>Your credits are running low!</strong><br>
            You currently have <strong>${currentCredits} credits</strong> remaining.
          </div>
          
          <p>Don't let your interview preparation stop! Upgrade your plan to get more credits and unlock premium features:</p>
          
          <ul>
            <li><strong>Pro Plan:</strong> 600 credits/month - $9.99</li>
            <li><strong>Ultimate Plan:</strong> 1,500 credits/month - $19.99</li>
            <li><strong>Magic Plan:</strong> 4,000 credits/month - $39.99</li>
            <li><strong>Lifetime:</strong> Unlimited credits - $199.99</li>
          </ul>
          
          <p style="text-align: center;">
            <a href="https://inshuverse-ai.onrender.com" class="button">Upgrade Now</a>
          </p>
          
          <p>Best regards,<br>InshuVerse AI Team</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function sendCreditLowEmail(userEmail, userName, currentCredits) {
  try {
    const mailOptions = {
      from: `"InshuVerse AI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: userEmail,
      subject: 'Low Credits Warning - InshuVerse AI',
      html: getCreditLowEmailTemplate(userName, currentCredits),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Credit low email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send credit low email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  verifySmtpConnection,
  sendWelcomeEmail,
  sendCreditLowEmail,
};
