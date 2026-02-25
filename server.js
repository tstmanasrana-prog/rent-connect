require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer'); // NEW: For Forgot Password

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

// EMAIL SETUP (GoDaddy SMTP)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.titleservers.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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
    reportReasons: [String],
    reportComments: String   
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

// --- FORGOT PASSWORD API (NEW) ---
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(404).json({ error: "User not found with this email." });

        // For security and simplicity in V1, we send their current password. 
        // In V2 we can add a 'Reset Link' logic.
        const mailOptions = {
            from: `"RentConnect Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Password Recovery - RentConnect",
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #4f46e5;">RentConnect Support</h2>
                    <p>Hi ${user.firstName},</p>
                    <p>You recently requested to recover your password for your RentConnect account.</p>
                    <div style="background: #f3f4f6; padding: 15px; border-radius: 10px; margin: 20px 0;">
                        <p style="margin: 0; font-size: 12px; color: #666;">YOUR PASSWORD:</p>
                        <p style="margin: 0; font-size: 18px; font-weight: bold; color: #111;">${req.body.email === user.email ? "Security Note: Please change this after login." : ""}</p>
                        <p>We recommend you log in and update your password immediately from your dashboard.</p>
                    </div>
                    <p>If you didn't request this, please ignore this email.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 11px; color: #999;">Soul Shift Media Initiative | Baripada, Odisha</p>
                </div>
            `
        };

        // Note: For actual recovery of hashed passwords, we'd usually generate a temporary 6-digit PIN.
        // Since we use bcrypt, we can't "read" the old password. We will send a reset notification.
        
        await transporter.sendMail(mailOptions);
        res.json({ message: "Recovery email sent! Please check your inbox." });
        
    } catch (error) {
        console.error("Email Error:", error);
        res.status(500).json({ error: "Could not send email. Please contact support via WhatsApp." });
    }
});

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
    const tx = new Transaction({ userEmail: email, type: 'spent', amount: amount, description: description || "Contact Unlocked" });
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
        const tx = new Transaction({ userEmail: p.ownerEmail, type: 'earned', amount: 3, description: `Listing Verified: ${p.title}` });
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
        description: "Admin Credit Bonus" 
    });
    await tx.save();
    res.json({ ok: true, newBalance: user.coins });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log("System Online"));
mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_URL); // Updated for Render flexibility