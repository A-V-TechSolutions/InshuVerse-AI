/**
 * Welcome Email Template
 * Simplified plain text to avoid Gmail spam filters
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
  <h2>Welcome to InshuVerse AI</h2>
  
  <p>Hello ${userName || 'User'},</p>
  
  <p>Thank you for creating your InshuVerse AI account.</p>
  
  <p>Your account is now active.</p>
  
  <p><strong>Email:</strong> ${userEmail}</p>
  
  <p><strong>Free Credits:</strong> 7</p>
  
  <p>Regards,<br>InshuVerse AI<br>support@inshuverse.2bd.net</p>
</body>
</html>
    `,
    text: `
Welcome to InshuVerse AI

Hello ${userName || 'User'},

Thank you for creating your InshuVerse AI account.

Your account is now active.

Email: ${userEmail}
Free Credits: 7

Regards,
InshuVerse AI
support@inshuverse.2bd.net
    `
  };
}

module.exports = { getWelcomeEmailTemplate };
