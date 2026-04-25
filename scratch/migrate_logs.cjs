
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function migrateLogs() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        
        // 1. Recupera i log umani dalla vecchia collezione (matchlogs)
        const oldLogs = await db.collection('matchlogs').find({ isHuman: true }).toArray();
        console.log(`Trovati ${oldLogs.length} log umani nella vecchia collezione.`);

        if (oldLogs.length > 0) {
            // Rimuovi gli _id per evitare conflitti nel nuovo inserimento
            const cleanedLogs = oldLogs.map(l => {
                const { _id, ...rest } = l;
                return rest;
            });

            // 2. Inseriscili nella nuova collezione humanlogs
            await db.collection('humanlogs').insertMany(cleanedLogs);
            console.log(`Migrati con successo ${oldLogs.length} log in 'humanlogs'.`);
        }

        // 3. Resetta la collezione matchlogs (Turbo) per pulire lo spazio "misto"
        // Essendo capped, dobbiamo dropparla e ricrearla
        console.log("Resezione collezione 'matchlogs' per pulizia...");
        await db.collection('matchlogs').drop();
        
        await db.createCollection('matchlogs', {
            capped: true,
            size: 25 * 1024 * 1024,
            max: 100000
        });
        console.log("Collezione 'matchlogs' resettata e pronta per i dati Turbo.");

        await mongoose.disconnect();
        console.log("Migrazione completata.");
    } catch (err) {
        console.error('Errore durante la migrazione:', err);
    }
}

migrateLogs();
