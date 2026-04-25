import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const reportSchema = new mongoose.Schema({
    data: { type: Date, default: Date.now },
    nickname: { type: String, default: 'Sconosciuto' },
    testo: { type: String, required: true }
});
const Report = mongoose.model('Report', reportSchema);

async function checkReports() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.log("MONGODB_URI non trovato nel file .env o nelle variabili d'ambiente.");
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        console.log("Connesso a MongoDB. Recupero segnalazioni...");
        const reports = await Report.find().sort({ data: -1 });
        
        if (reports.length === 0) {
            console.log("Nessuna segnalazione trovata nel database.");
        } else {
            console.log(`Trovate ${reports.length} segnalazioni:\n`);
            reports.forEach(r => {
                console.log(`[${r.data.toISOString()}] ${r.nickname}: ${r.testo}`);
            });
        }
    } catch (err) {
        console.error("Errore durante il recupero dei report:", err);
    } finally {
        await mongoose.disconnect();
    }
}

checkReports();
