
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const reportSchema = new mongoose.Schema({
    data: { type: Date, default: Date.now },
    nickname: { type: String, default: 'Sconosciuto' },
    testo: { type: String, required: true }
});
const Report = mongoose.model('Report', reportSchema);

async function deleteReports() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
        const result = await Report.deleteMany({});
        console.log(`Deleted ${result.deletedCount} reports.`);
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

deleteReports();
