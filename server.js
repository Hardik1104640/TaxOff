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
const emailTo = process.env.EMAIL_TO || smtpUser;

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
    const textBody = `New booking details:\n\nName: ${fullName}\nEmail: ${emailId}\nPhone: ${phoneNumber}\nPAN: ${panNumber}\nPlan: ${plan}\nAmount: ₹${amount}\nRazorpay Order ID: ${razorpay_order_id}\nRazorpay Payment ID: ${razorpay_payment_id}`;
    const htmlBody = `<h2>New booking received</h2><ul><li><strong>Name:</strong> ${fullName}</li><li><strong>Email:</strong> ${emailId}</li><li><strong>Phone:</strong> ${phoneNumber}</li><li><strong>PAN:</strong> ${panNumber}</li><li><strong>Plan:</strong> ${plan}</li><li><strong>Amount:</strong> ₹${amount}</li><li><strong>Razorpay Order ID:</strong> ${razorpay_order_id}</li><li><strong>Razorpay Payment ID:</strong> ${razorpay_payment_id}</li></ul>`;

    await mailer.sendMail({
      from: smtpUser,
      to: emailTo,
      subject: `New TaxOFF booking: ${fullName}`,
      text: textBody,
      html: htmlBody,
    });

    return res.json({ success: true, message: 'Booking email sent successfully.' });
  } catch (error) {
    console.error('Failed to send booking email:', error.message || error);
    return res.status(500).json({ error: 'Unable to send booking email.' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
