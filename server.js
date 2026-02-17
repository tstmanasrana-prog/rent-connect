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

// CLOUDINARY CONFIG
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

// SCHEMAS
const UserSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    coins: { type: Number, default: 0 }
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

// AUTH
app.post('/api/signup', async (req, res) => {
    try {
        const { firstName, lastName, email, password, phone } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ firstName, lastName, email, password: hashedPassword, phone, coins: 0 });
        await newUser.save();
        res.json({ coins: 0, email: newUser.email, firstName: newUser.firstName });
    } catch (error) { res.status(400).json({ error: "User already exists" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(400).json({ error: "Invalid credentials" });
    res.json({ coins: user.coins, email: user.email, firstName: user.firstName });
});

// PROPERTIES
app.post('/api/properties', upload.array('images', 12), async (req, res) => {
    const newProp = new Property({ ...req.body, images: req.files.map(f => f.path) });
    await newProp.save();
    res.json({ message: "Success" });
});

app.get('/api/properties', async (req, res) => {
    const props = await Property.find({ status: 'verified' }).sort({ createdAt: -1 });
    res.json(props);
});

// ADMIN
app.get('/api/admin/pending', async (req, res) => {
    const pending = await Property.find({ status: 'pending' });
    res.json(pending);
});

app.patch('/api/admin/verify/:id', async (req, res) => {
    const property = await Property.findByIdAndUpdate(req.params.id, { status: 'verified', vacantDate: req.body.vacantDate });
    await User.findOneAndUpdate({ email: property.ownerEmail }, { $inc: { coins: 3 } });
    res.json({ message: "Verified" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Live on ${PORT}`));
mongoose.connect(process.env.MONGODB_URI);