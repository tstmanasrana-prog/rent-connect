require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// 1. CLOUDINARY CONFIG (Set these in Render/ .env)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'rent_connect_properties', allowed_formats: ['jpg', 'png', 'jpeg'] }
});
const upload = multer({ storage: storage });

// 2. DATABASE SCHEMAS
const UserSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    coins: { type: Number, default: 3 }, // Every new user gets 3 coins
    unlockedListings: [String] // IDs of properties they've paid for
});

const PropertySchema = new mongoose.Schema({
    title: String, rent: Number, phone: String, pincode: String,
    locality: String, district: String, state: String,
    category: String, type: String,
    images: [String], // Array of 12 Cloudinary URLs
    status: { type: String, default: 'pending' }, // pending, verified
    vacantDate: String,
    ownerId: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Property = mongoose.model('Property', PropertySchema);

// 3. ROUTES
// Multi-Image Upload (Max 12)
app.post('/api/properties', upload.array('images', 12), async (req, res) => {
    try {
        const imageUrls = req.files.map(file => file.path); // Cloudinary URLs
        const newProp = new Property({
            ...req.body,
            images: imageUrls,
            status: 'pending' // Admin must verify
        });
        await newProp.save();
        res.json({ message: "Property submitted for verification!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Only Verified Properties for Users
app.get('/api/properties', async (req, res) => {
    const props = await Property.find({ status: 'verified' }).sort({ createdAt: -1 });
    res.json(props);
});

// Admin Route to Verify Listing
app.patch('/api/admin/verify/:id', async (req, res) => {
    const { vacantDate } = req.body;
    await Property.findByIdAndUpdate(req.params.id, { status: 'verified', vacantDate });
    res.json({ message: "Property Verified & Live!" });
});

mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ Marketplace DB Connected'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));