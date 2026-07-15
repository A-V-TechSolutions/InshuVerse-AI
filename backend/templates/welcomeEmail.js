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
  <title>Welcome to InshuVerse </title>
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
  <h2>Welcome to InshuVerse</h2>
  
  <p>Hello ${userName || 'User'},</p>
  
  <p>Thank you for creating your InshuVerse account.</p>
  
  <p>Your account is now active.</p>
  
  <p><strong>Email:</strong> ${userEmail}</p>
  
  <p><strong>Credits:</strong> 7</p>
  
  <p>Regards,<br>InshuVerse<br>help.inshuverse@gmail.com</p>
</body>
</html>
    `,
    text: `
Welcome to InshuVerse

Hello ${userName || 'User'},

Thank you for creating your InshuVerse account.

Your account is now active.

Email: ${userEmail}
Credits: 7

Regards,
InshuVerse
help.inshuverse@gmail.com
    `
  };
}

module.exports = { getWelcomeEmailTemplate };
