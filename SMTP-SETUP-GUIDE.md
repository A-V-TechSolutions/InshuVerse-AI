# SMTP Email Service Setup Guide

## Overview

The InshuVerse AI backend now includes SMTP email functionality to send welcome emails to new users when they sign up. This guide explains how to configure and set up the email service.

## Features

- **Welcome Emails:** Automatically sent to new users upon signup
- **Credit Low Notifications:** (Optional) Send alerts when user credits are running low
- **HTML Email Templates:** Professional, branded email templates
- **SMTP Integration:** Uses Nodemailer for reliable email delivery

## Prerequisites

- SMTP server access (Gmail, SendGrid, Mailgun, etc.)
- SMTP credentials (host, port, username, password)
- Backend server access

## Installation

### 1. Install Nodemailer

The backend package.json has been updated to include nodemailer. Install dependencies:

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the backend directory (or use your existing `.env` file):

```bash
cd backend
cp env.example .env
```

Edit the `.env` file with your SMTP credentials:

```env
# SMTP Configuration for Email Service
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@inshuverse.ai
```

## SMTP Provider Setup

### Option 1: Gmail (Recommended for Testing)

1. **Enable 2-Factor Authentication:**
   - Go to Google Account settings
   - Security → 2-Step Verification
   - Enable 2FA

2. **Generate App Password:**
   - Go to Google Account settings
   - Security → App passwords
   - Select "Mail" and your device
   - Generate password (copy this - it's your SMTP_PASS)

3. **Configure .env:**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-generated-app-password
   SMTP_FROM=noreply@inshuverse.ai
   ```

### Option 2: SendGrid (Recommended for Production)

1. **Create SendGrid Account:**
   - Sign up at https://sendgrid.com
   - Verify your sender domain

2. **Get API Key:**
   - Go to Settings → API Keys
   - Create API Key with "Mail Send" permissions
   - Copy the API key

3. **Configure .env:**
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=your-sendgrid-api-key
   SMTP_FROM=noreply@inshuverse.ai
   ```

### Option 3: Mailgun

1. **Create Mailgun Account:**
   - Sign up at https://mailgun.com
   - Verify your domain

2. **Get SMTP Credentials:**
   - Go to Domains → your domain
   - Scroll to SMTP credentials
   - Copy username and password

3. **Configure .env:**
   ```env
   SMTP_HOST=smtp.mailgun.org
   SMTP_PORT=587
   SMTP_USER=postmaster@your-domain.mailgun.org
   SMTP_PASS=your-smtp-password
   SMTP_FROM=noreply@inshuverse.ai
   ```

## Email Templates

### Welcome Email

The welcome email is automatically sent when a new user signs up. It includes:

- Professional branding with InshuVerse AI logo
- Feature overview (voice transcription, screenshot analysis, AI answers, hide mode)
- Credit information (7 free credits)
- Call-to-action button to get started
- Contact information

**Template Location:** `backend/services/emailService.js` - `getWelcomeEmailTemplate()`

### Credit Low Email

A credit low notification email template is included for future use:

- Warning styling with alert colors
- Current credit balance
- Plan upgrade options
- Call-to-action button

**Template Location:** `backend/services/emailService.js` - `getCreditLowEmailTemplate()`

## Backend Integration

### User Creation Flow

When a new user signs up:

1. **Frontend:** User authenticates via Google OAuth
2. **Main Process:** Calls `checkUserPlan()` with user email and name
3. **Backend API:** `/api/user/plan/:uid` endpoint checks if user exists
4. **User Creation:** If new user, creates document with:
   - `plan: "free"`
   - `credits: 7`
   - `role: "user"` (default role)
   - `email: user@example.com`
   - `createdAt: server timestamp`
5. **Email Service:** Sends welcome email to user's email
6. **Response:** Returns plan, credits, and role to frontend

### Code Changes Made

**Backend Routes (`backend/routes/user.js`):**
- Added email and name parameters to user creation
- Set default role as "user"
- Integrated `sendWelcomeEmail()` function
- Returns role in API response

**Firebase Config (`firebase-config.js`):**
- Updated `checkUserPlan()` to accept email and name parameters
- Passes email and name to backend API
- Returns role in plan check response

**Main Process (`main.js`):**
- Updated sign-in flow to pass user email and display name to `checkUserPlan()`

**Email Service (`backend/services/emailService.js`):**
- Created new email service module
- SMTP configuration and connection verification
- Welcome email template
- Credit low email template (for future use)

## Testing

### 1. Test SMTP Connection

Start the backend server:

```bash
cd backend
npm start
```

Check console for SMTP verification message:
```
[SERVER] Email service initialized successfully
```

### 2. Test Welcome Email

1. Sign up as a new user in the InshuVerse AI app
2. Check your email inbox for welcome email
3. Verify email content and formatting

### 3. Test Email Service Directly

Create a test script `test-email.js` in backend directory:

```javascript
const { sendWelcomeEmail } = require('./services/emailService');

sendWelcomeEmail('test@example.com', 'Test User')
  .then(result => console.log('Email sent:', result))
  .catch(error => console.error('Email failed:', error));
```

Run test:
```bash
node test-email.js
```

## Deployment

### Render.com Deployment

1. **Add Environment Variables:**
   - Go to Render dashboard → your backend service
   - Settings → Environment Variables
   - Add SMTP configuration variables

2. **Redeploy:**
   - Push changes to GitHub
   - Render will auto-deploy with new environment variables

### Local Development

1. **Set .env file:**
   ```bash
   cd backend
   # Edit .env with your SMTP credentials
   ```

2. **Start server:**
   ```bash
   npm start
   ```

## Troubleshooting

### Email Not Sending

**Check SMTP Credentials:**
- Verify SMTP_USER and SMTP_PASS are correct
- For Gmail, ensure you're using an App Password, not your regular password

**Check Firewall/Network:**
- Ensure port 587 (or your SMTP port) is not blocked
- Check if your SMTP provider allows connections from your IP

**Check Logs:**
```bash
# Backend console logs
[EMAIL] Welcome email sent: <message-id>
# or
[EMAIL] Failed to send welcome email: <error>
```

### Gmail Authentication Failed

**Common Issues:**
- Using regular password instead of App Password
- 2-Factor Authentication not enabled
- Less secure apps access disabled

**Solution:**
1. Enable 2-Factor Authentication
2. Generate App Password
3. Use App Password in SMTP_PASS

### Email Goes to Spam

**Solutions:**
1. Verify your sender domain (SPF, DKIM, DMARC records)
2. Use a dedicated email service (SendGrid, Mailgun) for production
3. Check email content for spam triggers
4. Ensure SMTP_FROM matches your verified domain

### SMTP Connection Timeout

**Check:**
- SMTP_HOST is correct
- SMTP_PORT is correct (587 for TLS, 465 for SSL)
- Network connectivity to SMTP server
- Firewall rules

## Security Best Practices

1. **Never Commit .env Files:**
   - Add `.env` to `.gitignore`
   - Use environment variables in production

2. **Use App Passwords:**
   - For Gmail, always use App Passwords
   - Never use your regular account password

3. **Limit Email Permissions:**
   - Use dedicated SMTP accounts
   - Rotate passwords regularly
   - Monitor email usage

4. **Rate Limiting:**
   - Implement rate limiting for email sends
   - Monitor for abuse
   - Use reputable email providers

## Future Enhancements

### Planned Features

1. **Email Verification:**
   - Send verification email on signup
   - Require email verification before granting access

2. **Password Reset:**
   - Allow users to reset passwords via email

3. **Subscription Renewal Reminders:**
   - Send reminders before subscription expires

4. **Usage Reports:**
   - Weekly/monthly usage summary emails

5. **Admin Notifications:**
   - Notify admins of new signups
   - Alert on suspicious activity

### Customization

**To customize email templates:**

Edit `backend/services/emailService.js`:

```javascript
function getWelcomeEmailTemplate(userName, userEmail) {
  // Modify HTML template here
  return `...`;
}
```

**To add new email types:**

```javascript
async function sendCustomEmail(userEmail, subject, htmlContent) {
  try {
    const mailOptions = {
      from: `"InshuVerse AI" <${process.env.SMTP_FROM}>`,
      to: userEmail,
      subject: subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Support

For issues or questions:
- Email: avtechsolutions312@gmail.com
- GitHub: https://github.com/A-V-TechSolutions/InshuVerse-AI

## License

MIT License - Copyright © 2026 A&V Techsolutions
