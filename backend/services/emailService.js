const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

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

  try {
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'InshuVerse AI <onboarding@resend.dev>',
      to: userEmail,
      subject: 'Welcome to InshuVerse AI - Your AI Interview Assistant',
      html: getWelcomeEmailTemplate(userName, userEmail),
    });

    console.log('[EMAIL] Welcome email sent successfully:', result);
    return { success: true, messageId: result.id, response: result };
  } catch (error) {
    console.error('[EMAIL] Failed to send welcome email:', error);
    return { success: false, error: error.message, details: error };
  }
}

// Low credits email template
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

// Send credit low notification email
async function sendCreditLowEmail(userEmail, userName, currentCredits) {
  console.log('[EMAIL] sendCreditLowEmail called with:', { userEmail, userName, currentCredits });

  try {
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Inshuverse <support@inshuverse.2bd.net>',
      to: userEmail,
      subject: 'Low Credits Warning - InshuVerse AI',
      html: getCreditLowEmailTemplate(userName, currentCredits),
    });

    console.log('[EMAIL] Credit low email sent:', result);
    return { success: true, messageId: result.id };
  } catch (error) {
    console.error('[EMAIL] Failed to send credit low email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendWelcomeEmail,
  sendCreditLowEmail,
};
