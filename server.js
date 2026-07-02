const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId || !keySecret) {
  console.warn('Warning: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing in .env');
}

let razorpay = null;
if (keyId && keySecret) {
  razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = smtpUser;
const emailAdmin = process.env.EMAIL_TO || smtpUser;

let mailer = null;
if (smtpHost && smtpUser && smtpPass) {
  mailer = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '.')));

app.post(['/create-order', '/api/create-order'], async (req, res) => {
  if (!razorpay) {
    return res.status(500).json({ error: 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.' });
  }

  try {
    const { plan, amount, currency = 'INR', method } = req.body;

    if (!plan || !amount) {
      return res.status(400).json({ error: 'Plan and amount are required.' });
    }

    const order = await razorpay.orders.create({
      amount: Number(amount),
      currency,
      receipt: `taxoff_${Date.now()}`,
      payment_capture: 1,
      notes: {
        plan: plan.toString(),
        method: method || 'unknown',
      },
    });

    return res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (error) {
    console.error('Failed to create Razorpay order:', error.message || error);
    return res.status(500).json({ error: 'Unable to create order. Check server logs and Razorpay credentials.' });
  }
});

app.post(['/verify-payment', '/api/verify-payment'], (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields.' });
  }

  const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret || '')
    .update(payload)
    .digest('hex');

  if (expectedSignature === razorpay_signature) {
    return res.json({ success: true, message: 'Payment verified successfully.' });
  }

  return res.status(400).json({ success: false, error: 'Payment verification failed.' });
});

app.post(['/send-booking', '/api/send-booking'], async (req, res) => {
  if (!mailer) {
    return res.status(500).json({ error: 'Email service is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS to .env.' });
  }

  const {
    fullName,
    phoneNumber,
    emailId,
    panNumber,
    plan,
    amount,
    razorpay_payment_id,
    razorpay_order_id,
  } = req.body;

  if (!fullName || !emailId || !plan || !amount || !razorpay_payment_id || !razorpay_order_id) {
    return res.status(400).json({ error: 'Missing booking or payment fields.' });
  }

  try {
    const adminText = `New booking received:\n\nName: ${fullName}\nEmail: ${emailId}\nPhone: ${phoneNumber}\nPAN: ${panNumber}\nPlan: ${plan}\nAmount: ₹${amount}\nRazorpay Order ID: ${razorpay_order_id}\nRazorpay Payment ID: ${razorpay_payment_id}`;
    const adminHtml = `<h2>New booking received</h2><ul><li><strong>Name:</strong> ${fullName}</li><li><strong>Email:</strong> ${emailId}</li><li><strong>Phone:</strong> ${phoneNumber}</li><li><strong>PAN:</strong> ${panNumber}</li><li><strong>Plan:</strong> ${plan}</li><li><strong>Amount:</strong> ₹${amount}</li><li><strong>Razorpay Order ID:</strong> ${razorpay_order_id}</li><li><strong>Razorpay Payment ID:</strong> ${razorpay_payment_id}</li></ul>`;

    await mailer.sendMail({
      from: emailFrom,
      to: emailAdmin,
      subject: `New TaxOFF booking: ${fullName}`,
      text: adminText,
      html: adminHtml,
      replyTo: emailId,
    });

    const confirmationText = `Hi ${fullName},\n\nYour order for ${plan} has been successfully confirmed. Payment ID: ${razorpay_payment_id}. Order ID: ${razorpay_order_id}.\n\nWe are verifying your payment and booking details, and will contact you shortly with next steps.\n\nThank you for choosing Tax Return Buddy.`;
    const confirmationHtml = `<h2>Order confirmed</h2><p>Hi ${fullName},</p><p>Your order for <strong>${plan}</strong> has been successfully confirmed.</p><ul><li><strong>Payment ID:</strong> ${razorpay_payment_id}</li><li><strong>Order ID:</strong> ${razorpay_order_id}</li><li><strong>Amount:</strong> ₹${amount}</li><li><strong>PAN:</strong> ${panNumber}</li><li><strong>Phone:</strong> ${phoneNumber}</li></ul><p>We are verifying your payment and booking details, and will contact you shortly with next steps.</p><p>Thank you for choosing Tax Return Buddy.</p>`;

    await mailer.sendMail({
      from: emailFrom,
      to: emailId,
      subject: `Your TaxOFF order is confirmed: ${plan}`,
      text: confirmationText,
      html: confirmationHtml,
      replyTo: emailAdmin,
    });

    return res.json({ success: true, message: 'Admin and customer emails sent successfully.' });
  } catch (error) {
    console.error('Failed to send booking email:', error.message || error);
    return res.status(500).json({ error: 'Unable to send booking email.' });
  }
});

app.post(['/test-email', '/api/test-email'], async (req, res) => {
  if (!mailer) {
    return res.status(500).json({ error: 'Email service is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS to .env.' });
  }

  const { emailId, fullName } = req.body;
  if (!emailId) {
    return res.status(400).json({ error: 'emailId is required for test email.' });
  }

  const customerName = fullName || 'Test Customer';
  try {
    const adminText = `Test email sent by ${customerName}: ${emailId}`;
    const adminHtml = `<p>Test email sent by <strong>${customerName}</strong>: ${emailId}</p>`;

    await mailer.sendMail({
      from: emailFrom,
      to: emailAdmin,
      subject: `TaxOFF test email from ${customerName}`,
      text: adminText,
      html: adminHtml,
      replyTo: emailId,
    });

    const confirmationText = `Hi ${customerName},\n\nThis is a test email from TaxOFF. Your email delivery system is working correctly.`;
    const confirmationHtml = `<p>Hi ${customerName},</p><p>This is a test email from TaxOFF. Your email delivery system is working correctly.</p>`;

    await mailer.sendMail({
      from: emailFrom,
      to: emailId,
      subject: `TaxOFF test email delivered for ${customerName}`,
      text: confirmationText,
      html: confirmationHtml,
      replyTo: emailAdmin,
    });

    return res.json({ success: true, message: 'Test email sent to admin and customer.' });
  } catch (error) {
    console.error('Failed to send test email:', error.message || error);
    return res.status(500).json({ error: 'Unable to send test email.' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
