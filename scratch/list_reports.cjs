
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const reportSchema = new mongoose.Schema({
    data: { type: Date, default: Date.now },
    nickname: { type: String, default: 'Sconosciuto' },
    testo: { type: String, required: true }
});
const Report = mongoose.model('Report', reportSchema);

async function listReports() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        const reports = await Report.find().sort({ data: -1 });
        console.log(JSON.stringify(reports, null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

listReports();
