require('dotenv').config(); // Load secrets from .env
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// 1. DATABASE (Using the secret vault)
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Production Database Connected'))
    .catch(err => console.log('❌ DB Error:', err));

// 2. SCHEMA
const Property = mongoose.model('Property', new mongoose.Schema({
    title: String, rent: Number, phone: String, category: String, type: String,
    houseNo: String, apartment: String, locality: String, district: String, state: String,
    image: String,
    hasParking: Boolean, hasLift: Boolean, hasAC: Boolean,
    createdAt: { type: Date, default: Date.now }
}));

// 3. ROUTES
app.get('/api/properties', async (req, res) => {
    const props = await Property.find().sort({ createdAt: -1 });
    res.json(props);
});

// For now, we use simple upload. Soon we will switch this to Cloudinary.
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/properties', upload.single('image'), async (req, res) => {
    const data = { ...req.body, image: req.file ? `/uploads/${req.file.filename}` : '' };
    await new Property(data).save();
    res.json({ message: "Success" });
});

app.delete('/api/properties/:id', async (req, res) => {
    await Property.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Real Thing running on port ${PORT}`));