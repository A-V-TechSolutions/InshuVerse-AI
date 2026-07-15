const { Resend } = require('resend');
require('dotenv').config();
const { getWelcomeEmailTemplate } = require('../templates/welcomeEmail');
const { getLowCreditEmailTemplate } = require('../templates/lowCreditEmail');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'InshuVerse AI <support@inshuverse.2bd.net>';

// Send welcome email
async function sendWelcomeEmail(userEmail, userName) {
  console.log('[EMAIL] sendWelcomeEmail called with:', { userEmail, userName });

  try {
    const template = getWelcomeEmailTemplate(userName, userEmail);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'Welcome to InshuVerse AI - Your AI Interview Assistant',
      html: template.html,
      text: template.text,
    });

    console.log('[EMAIL] Welcome email sent successfully:', result);
    return { success: true, messageId: result.data?.id, response: result };
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
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: userEmail,
      subject: 'Low Credits Warning - InshuVerse AI',
      html: template.html,
      text: template.text,
    });

    console.log('[EMAIL] Credit low email sent:', result);
    return { success: true, messageId: result.data?.id };
  } catch (error) {
    console.error('[EMAIL] Failed to send credit low email:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendWelcomeEmail,
  sendCreditLowEmail,
};
