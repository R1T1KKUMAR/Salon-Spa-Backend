const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    
    // Validate name
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Name is required and must be a string' });
    }
    
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      return res.status(400).json({ message: 'Name must be between 2 and 50 characters' });
    }
    
    if (!/^[a-zA-Z\s]+$/.test(trimmedName)) {
      return res.status(400).json({ message: 'Name can only contain letters and spaces (no numbers allowed)' });
    }
    
    // Validate phone
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ message: 'Phone number is required and must be a string' });
    }
    
    const trimmedPhone = phone.trim();
    if (!/^\d{10}$/.test(trimmedPhone)) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits (numbers only)' });
    }
    
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new User({ name: trimmedName, email, phone: trimmedPhone, password: hashedPassword, role });
    await user.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const errorMessage = Object.values(err.errors).map(e => e.message).join(', ');
      return res.status(400).json({ message: errorMessage });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });
    const payload = { id: user._id, role: user.role, name: user.name, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret-change-in-prod', { expiresIn: '1d' });
    res.json({ token, user: payload });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user info
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot Password (Reset Password)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    // Validate input
    if (!email || !newPassword) {
      return res.status(400).json({ message: 'Email and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No user found with this email address' });
    }
    
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update user password
    user.password = hashedPassword;
    await user.save();
    
    res.json({ message: 'Password updated successfully! You can now log in with your new password.' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ message: 'Server error during password reset' });
  }
});

module.exports = router;