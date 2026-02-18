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
    params: { folder: 'rentconnect_master', allowed_formats: ['jpg', 'png', 'jpeg'] }
});
const upload = multer({ storage: storage });

// SCHEMAS
const UserSchema = new mongoose.Schema({
    firstName: String, lastName: String, email: { type: String, unique: true },
    password: String, phone: String, coins: { type: Number, default: 0 },
    unlockedProperties: [String] 
});

const PropertySchema = new mongoose.Schema({
    title: String, bhkType: String, rent: Number, phone: String, pincode: String,
    locality: String, district: String, state: String, houseNo: String, floorNo: String, street: String,
    furnishing: String, parking: Boolean, water: Boolean, ownerEmail: String, images: [String],
    status: { type: String, default: 'pending' },
    vacantDate: { type: String, default: 'Available Now' }
});

const TransactionSchema = new mongoose.Schema({
    userEmail: String, type: String, amount: Number,
    description: String, date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Property = mongoose.model('Property', PropertySchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// AUTH
app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({ ...req.body, password: hashedPassword, coins: 0 });
        await newUser.save();
        res.json({ email: newUser.email, firstName: newUser.firstName, coins: 0, unlocked: [] });
    } catch (e) { res.status(400).json({ error: "Email exists" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(400).json({ error: "Wrong login" });
    res.json({ email: user.email, firstName: user.firstName, coins: user.coins, unlocked: user.unlockedProperties });
});

app.get('/api/user-sync/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json({ coins: user.coins, unlocked: user.unlockedProperties });
});

// PROPERTIES
app.post('/api/properties', upload.array('images', 12), async (req, res) => {
    const newProp = new Property({ ...req.body, images: req.files.map(f => f.path) });
    await newProp.save();
    res.json({ ok: true });
});

app.get('/api/properties', async (req, res) => {
    const props = await Property.find({ status: 'verified' }).sort({ _id: -1 });
    res.json(props);
});

app.get('/api/my-properties/:email', async (req, res) => {
    const props = await Property.find({ ownerEmail: req.params.email, status: { $ne: 'unavailable' } });
    res.json(props);
});

app.patch('/api/properties/hide/:id', async (req, res) => {
    await Property.findByIdAndUpdate(req.params.id, { status: 'unavailable' });
    res.json({ ok: true });
});

app.post('/api/spend-coin', async (req, res) => {
    const { email, amount, description, propId } = req.body;
    const user = await User.findOneAndUpdate({ email }, { $inc: { coins: -amount }, $addToSet: { unlockedProperties: propId } }, { new: true });
    const tx = new Transaction({ userEmail: email, type: 'spent', amount, description });
    await tx.save();
    res.json({ ok: true, newBalance: user.coins, unlocked: user.unlockedProperties });
});

// ADMIN ENGINE
app.get('/api/admin/pending', async (req, res) => {
    const pending = await Property.find({ status: 'pending' });
    res.json(pending);
});

app.patch('/api/admin/verify-and-update/:id', async (req, res) => {
    try {
        const p = await Property.findByIdAndUpdate(req.params.id, { ...req.body, status: 'verified' });
        const user = await User.findOneAndUpdate({ email: p.ownerEmail }, { $inc: { coins: 3 } }, { new: true });
        const tx = new Transaction({ userEmail: p.ownerEmail, type: 'earned', amount: 3, description: `Verified: ${req.body.title}` });
        await tx.save();
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/delete/:id', async (req, res) => {
    await Property.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
});

app.post('/api/admin/add-coins', async (req, res) => {
    const user = await User.findOneAndUpdate({ email: req.body.email }, { $inc: { coins: req.body.amount } }, { new: true });
    const tx = new Transaction({ userEmail: req.body.email, type: 'earned', amount: req.body.amount, description: "Admin Topup" });
    await tx.save();
    res.json({ ok: true, newBalance: user.coins });
});

app.get('/api/transactions/:email', async (req, res) => {
    const txs = await Transaction.find({ userEmail: req.params.email }).sort({ date: -1 });
    res.json(txs);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log("Metro Engine Ready"));
mongoose.connect(process.env.MONGODB_URI);