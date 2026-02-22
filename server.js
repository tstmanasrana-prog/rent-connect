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
    unlockedProperties: [String],
    wishlist: [String]
});

const PropertySchema = new mongoose.Schema({
    title: String, bhkType: String, rent: Number, phone: String, pincode: String,
    locality: String, district: String, state: String, houseNo: String, floorNo: String, street: String,
    furnishing: String, tenantType: String,
    parking: Boolean, water: Boolean, gatedSecurity: Boolean, ownerEmail: String, images: [String],
    status: { type: String, default: 'pending' }, 
    vacantDate: { type: String, default: 'Available Now' },
    likesCount: { type: Number, default: 0 },
    isBrokerReported: { type: Boolean, default: false },
    reportReasons: [String], // NEW FIELD
    reportComments: String   // NEW FIELD
});

const BlacklistSchema = new mongoose.Schema({
    phone: { type: String, unique: true },
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Property = mongoose.model('Property', PropertySchema);
const Blacklist = mongoose.model('Blacklist', BlacklistSchema);
const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    userEmail: String, type: String, amount: Number, description: String, date: { type: Date, default: Date.now }
}));

// AUTH & SYNC
app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({ ...req.body, password: hashedPassword, coins: 0 });
        await newUser.save();
        res.json({ email: newUser.email, firstName: newUser.firstName, coins: 0, unlocked: [], wishlist: [] });
    } catch (e) { res.status(400).json({ error: "Email exists" }); }
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(400).json({ error: "Wrong login" });
    res.json({ email: user.email, firstName: user.firstName, coins: user.coins, unlocked: user.unlockedProperties, wishlist: user.wishlist });
});

app.get('/api/user-sync/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json({ coins: user.coins, unlocked: user.unlockedProperties, wishlist: user.wishlist });
});

// PROPERTIES
app.post('/api/properties', upload.array('images', 12), async (req, res) => {
    try {
        const banned = await Blacklist.findOne({ phone: req.body.phone });
        if(banned) return res.status(403).json({ error: "This phone number has been flagged by our safety system." });
        const newProp = new Property({ ...req.body, images: req.files.map(f => f.path) });
        await newProp.save();
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: "Error saving property" });
    }
});

app.get('/api/properties', async (req, res) => {
    const props = await Property.find({ status: 'verified' }).sort({ _id: -1 });
    res.json(props);
});

app.post('/api/spend-coin', async (req, res) => {
    const { email, amount, description, propId } = req.body;
    const user = await User.findOneAndUpdate({ email }, { $inc: { coins: -amount }, $addToSet: { unlockedProperties: propId } }, { new: true });
    const tx = new Transaction({ userEmail: email, type: 'spent', amount, description });
    await tx.save();
    res.json({ ok: true, newBalance: user.coins, unlocked: user.unlockedProperties });
});

app.get('/api/transactions/:email', async (req, res) => {
    try {
        const txs = await Transaction.find({ userEmail: req.params.email }).sort({ date: -1 });
        res.json(txs);
    } catch (err) {
        res.status(500).json({ error: "Could not load history" });
    }
});

// SOCIAL & MANAGEMENT
app.post('/api/wishlist/toggle', async (req, res) => {
    const { email, propId } = req.body;
    const user = await User.findOne({ email });
    const isLiked = user.wishlist.includes(propId);
    if (isLiked) {
        await User.updateOne({ email }, { $pull: { wishlist: propId } });
        await Property.findByIdAndUpdate(propId, { $inc: { likesCount: -1 } });
    } else {
        await User.updateOne({ email }, { $addToSet: { wishlist: propId } });
        await Property.findByIdAndUpdate(propId, { $inc: { likesCount: 1 } });
    }
    const updatedUser = await User.findOne({ email });
    res.json({ ok: true, wishlist: updatedUser.wishlist });
});

app.get('/api/my-wishlist/:email', async (req, res) => {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.json([]);
    const props = await Property.find({ _id: { $in: user.wishlist } });
    res.json(props);
});

app.get('/api/my-properties/:email', async (req, res) => {
    const props = await Property.find({ ownerEmail: req.params.email });
    res.json(props);
});

// UPGRADED REPORT ROUTE
app.post('/api/report-broker', async (req, res) => {
    try {
        const { propId, reasons, other } = req.body;
        await Property.findByIdAndUpdate(propId, { 
            isBrokerReported: true,
            reportReasons: reasons,
            reportComments: other
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: "Report failed" });
    }
});

// ADMIN
app.get('/api/admin/pending', async (req, res) => {
    res.json(await Property.find({ status: 'pending' }));
});

app.get('/api/admin/all-properties', async (req, res) => {
    res.json(await Property.find().sort({ _id: -1 }));
});

app.patch('/api/admin/verify-and-update/:id', async (req, res) => {
    const oldProp = await Property.findById(req.params.id);
    const p = await Property.findByIdAndUpdate(req.params.id, { ...req.body }, { new: true });
    if(req.body.status === 'verified' && oldProp.status === 'pending') {
        await User.findOneAndUpdate({ email: p.ownerEmail }, { $inc: { coins: 3 } });
        const tx = new Transaction({ userEmail: p.ownerEmail, type: 'earned', amount: 3, description: `Verified: ${p.title}` });
        await tx.save();
    }
    res.json({ ok: true });
});

app.post('/api/admin/blacklist', async (req, res) => {
    try {
        await new Blacklist({ phone: req.body.phone }).save();
        await Property.updateMany({ phone: req.body.phone }, { status: 'unavailable' });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "Already banned" }); }
});

app.delete('/api/admin/delete/:id', async (req, res) => {
    await Property.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
});

app.post('/api/admin/add-coins', async (req, res) => {
    const { email, amount } = req.body;
    const user = await User.findOneAndUpdate({ email: email }, { $inc: { coins: amount } }, { new: true });
    const tx = new Transaction({ 
        userEmail: email, 
        type: 'earned', 
        amount: amount, 
        description: "Bonus coins from Admin" 
    });
    await tx.save();
    res.json({ ok: true, newBalance: user.coins });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log("System Online"));
mongoose.connect(process.env.MONGODB_URI);