const nodemailer = require('nodemailer');
require('dotenv').config();
const { getWelcomeEmailTemplate } = require('../templates/welcomeEmail');
const { getLowCreditEmailTemplate } = require('../templates/lowCreditEmail');

// Create transporter for Brevo SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: process.env.SMTP_PORT || 465,
  secure: true, // true for 465 (SSL), false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false // Allow self-signed certificates
  },
});

const FROM_EMAIL = process.env.SMTP_FROM || 'InshuVerse <help.inshuverse@gmail.com>';

// Send welcome email
async function sendWelcomeEmail(userEmail, userName) {
  console.log('[EMAIL] sendWelcomeEmail called with:', { userEmail, userName });

  try {
    const template = getWelcomeEmailTemplate(userName, userEmail);
    const result = await transporter.sendMail({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'InshuVerse account confirmation',
      html: template.html,
      text: template.text,
    });

    console.log('[EMAIL] Welcome email sent successfully:', result);
    return { success: true, messageId: result.messageId, response: result };
  } catch (error) {
    console.error('[EMAIL] Failed to send welcome email:', error);
    return { success: false, error: error.message, details: error };
  }
}


// Send credit low notification email
async function sendCreditLowEmail(userEmail, userName, currentCredits) {
  console.log('[EMAIL] sendCreditLowEmail called with:', { userEmail, userName, currentCredits });

  try {
    const template = getLowCreditEmailTemplate(userName, currentCredits);
    const result = await transporter.sendMail({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'InshuVerse credits notification',
      html: template.html,
      text: template.text,
    });

    console.log('[EMAIL] Credit low email sent:', result);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send credit low email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendWelcomeEmail,
  sendCreditLowEmail,
};
