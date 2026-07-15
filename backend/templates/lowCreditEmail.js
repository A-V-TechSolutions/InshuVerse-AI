/**
 * Low Credits Email Template
 * Simplified plain text to avoid Gmail spam filters
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
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
  </style>
</head>
<body>
  <h2>Low Credits Warning</h2>
  
  <p>Hello ${userName || 'User'},</p>
  
  <p>Your credits are running low.</p>
  
  <p><strong>Current Credits:</strong> ${currentCredits}</p>
  
  <p>To continue using InshuVerse AI, please upgrade your plan.</p>
  
  <p>Regards,<br>InshuVerse AI<br>support@inshuverse.2bd.net</p>
</body>
</html>
    `,
    text: `
Low Credits Warning - InshuVerse AI

Hello ${userName || 'User'},

Your credits are running low.

Current Credits: ${currentCredits}

To continue using InshuVerse AI, please upgrade your plan.

Regards,
InshuVerse AI
support@inshuverse.2bd.net
    `
  };
}

module.exports = { getLowCreditEmailTemplate };
