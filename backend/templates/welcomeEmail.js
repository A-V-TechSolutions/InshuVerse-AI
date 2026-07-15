/**
 * Welcome Email Template
 * Professional HTML email with plain text fallback
 */

function getWelcomeEmailTemplate(userName, userEmail) {
  return {
    html: `
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
      background-color: #f4f4f4;
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
      padding-left: 0;
    }
    .feature-list li {
      margin: 10px 0;
      padding-left: 20px;
      list-style: none;
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
        <a href="https://inshuverse.2bd.net" class="button">Get Started Now</a>
      </p>
      
      <p>Need help? Contact support at support@inshuverse.2bd.net</p>
      
      <div class="footer">
        <p>This email was sent to ${userEmail}</p>
        <p>© 2024 InshuVerse AI. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `,
    text: `
Welcome to InshuVerse AI!

Dear ${userName || 'User'},

Thank you for signing up for InshuVerse AI! We're excited to have you on board and can't wait to help you ace your interviews.

What You Can Do:
- Real-time Voice Transcription - Get instant transcription of your interviews
- Screenshot Analysis - Capture and analyze questions instantly
- AI-Powered Answers - Get intelligent responses powered by GPT-4 and Gemini
- Hide Mode - Protect your screen during screen sharing
- Usage Analytics - Track your credits and usage

You have been granted 7 free credits to get started. Each credit allows you to:
- Transcribe voice recordings
- Analyze screenshots
- Get AI-powered answers

Get started now: https://inshuverse.2bd.net

Need help? Contact support at support@inshuverse.2bd.net

© 2024 InshuVerse AI. All rights reserved.
    `
  };
}

module.exports = { getWelcomeEmailTemplate };
