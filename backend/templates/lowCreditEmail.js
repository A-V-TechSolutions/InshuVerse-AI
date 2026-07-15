/**
 * Low Credits Email Template
 * Professional HTML email with plain text fallback
 */

function getLowCreditEmailTemplate(userName, currentCredits) {
  return {
    html: `
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
      background-color: #f4f4f4;
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
        <a href="https://inshuverse.2bd.net" class="button">Upgrade Now</a>
      </p>
      
      <p>Need help? Contact support at support@inshuverse.2bd.net</p>
      
      <div class="footer">
        <p>© 2024 InshuVerse AI. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `,
    text: `
Low Credits Warning - InshuVerse AI

Dear ${userName || 'User'},

⚠️ Your credits are running low!

You currently have ${currentCredits} credits remaining.

Don't let your interview preparation stop! Upgrade your plan to get more credits and unlock premium features:

Pro Plan: 600 credits/month - $9.99
Ultimate Plan: 1,500 credits/month - $19.99
Magic Plan: 4,000 credits/month - $39.99
Lifetime: Unlimited credits - $199.99

Upgrade now: https://inshuverse.2bd.net

Need help? Contact support at support@inshuverse.2bd.net

© 2024 InshuVerse AI. All rights reserved.
    `
  };
}

module.exports = { getLowCreditEmailTemplate };
