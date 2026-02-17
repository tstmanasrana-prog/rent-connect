require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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

const UserSchema = new mongoose.Schema({
    firstName: String, lastName: String, email: { type: String, unique: true },
    password: String, phone: String, coins: { type: Number, default: 0 }
});

const PropertySchema = new mongoose.Schema({
    title: String, rent: Number, phone: String, pincode: String,
    locality: String, ownerEmail: String, images: [String],
    status: { type: String, default: 'pending' }, // pending, verified, unavailable
    vacantDate: { type: String, default: 'Available Now' }
});

const User = mongoose.model('User', UserSchema);
const Property = mongoose.model('Property', PropertySchema);

// AUTH
app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({ ...req.body, password: hashedPassword, coins: 0 });
        await newUser.save();
        res.json({ email: newUser.email, firstName: newUser.firstName, coins: 0 });
    } catch (e) { res.status(400).json({ error: "Already exists" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(400).json({ error: "Wrong credentials" });
    res.json({ email: user.email, firstName: user.firstName, coins: user.coins });
});

// PROPERTIES
app.post('/api/properties', upload.array('images', 12), async (req, res) => {
    const newProp = new Property({ ...req.body, images: req.files.map(f => f.path) });
    await newProp.save();
    res.json({ ok: true });
});

app.get('/api/properties', async (req, res) => {
    // Only show verified properties to the public
    const props = await Property.find({ status: 'verified' }).sort({ _id: -1 });
    res.json(props);
});

// USER DASHBOARD ROUTE
app.get('/api/my-properties/:email', async (req, res) => {
    // Fetch all properties (Verified & Pending) for this user, but NOT unavailable ones
    const props = await Property.find({ 
        ownerEmail: req.params.email, 
        status: { $ne: 'unavailable' } 
    }).sort({ _id: -1 });
    res.json(props);
});

// SOFT DELETE ROUTE
app.patch('/api/properties/hide/:id', async (req, res) => {
    try {
        await Property.findByIdAndUpdate(req.params.id, { status: 'unavailable' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

// ADMIN
app.get('/api/admin/pending', async (req, res) => {
    const pending = await Property.find({ status: 'pending' });
    res.json(pending);
});

app.patch('/api/admin/verify/:id', async (req, res) => {
    try {
        const property = await Property.findByIdAndUpdate(req.params.id, { 
            status: 'verified', 
            vacantDate: req.body.vacantDate 
        });
        await User.findOneAndUpdate({ email: property.ownerEmail }, { $inc: { coins: 3 } });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log("Server Running"));
mongoose.connect(process.env.MONGODB_URI);