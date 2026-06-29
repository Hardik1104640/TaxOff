const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
