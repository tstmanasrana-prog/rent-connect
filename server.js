require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// 1. CLOUDINARY CONFIG (Ensure these keys are in Render Settings)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'soulshift_rentals', allowed_formats: ['jpg', 'png', 'jpeg'] }
});
const upload = multer({ storage: storage });

// 2. DATABASE SCHEMAS
const UserSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    coins: { type: Number, default: 0 },
    unlockedListings: [String]
});

const PropertySchema = new mongoose.Schema({
    title: String, rent: Number, phone: String, pincode: String,
    locality: String, ownerEmail: String,
    images: [String],
    status: { type: String, default: 'pending' },
    vacantDate: { type: String, default: 'Available Now' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Property = mongoose.model('Property', PropertySchema);

// 3. AUTHENTICATION
app.post('/api/signup', async (req, res) => {
    try {
        const { firstName, lastName, email, password, phone } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ firstName, lastName, email, password: hashedPassword, phone, coins: 0 });
        await newUser.save();
        const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET || 'SECRET');
        res.json({ token, coins: 0, email: newUser.email, firstName: newUser.firstName });
    } catch (error) { res.status(400).json({ error: "User already exists or missing data" }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials" });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'SECRET');
    res.json({ token, coins: user.coins, email: user.email, firstName: user.firstName });
});

// 4. PROPERTY ACTIONS
app.post('/api/properties', upload.array('images', 12), async (req, res) => {
    try {
        const imageUrls = req.files.map(file => file.path);
        const newProp = new Property({ ...req.body, images: imageUrls });
        await newProp.save();
        res.json({ message: "Success" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/properties', async (req, res) => {
    const props = await Property.find({ status: 'verified' }).sort({ createdAt: -1 });
    res.json(props);
});

// 5. ADMIN ACTIONS
app.get('/api/admin/pending', async (req, res) => {
    const pending = await Property.find({ status: 'pending' });
    res.json(pending);
});

app.patch('/api/admin/verify/:id', async (req, res) => {
    const { vacantDate } = req.body;
    const property = await Property.findByIdAndUpdate(req.params.id, { status: 'verified', vacantDate });
    await User.findOneAndUpdate({ email: property.ownerEmail }, { $inc: { coins: 3 } });
    res.json({ message: "Verified" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Live on ${PORT}`));
mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ DB Connected'));