
const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const matchLogSchema = new mongoose.Schema({
    wonTrick: Boolean,
    move: String,
    table: String,
    hand: String,
    isHuman: Boolean
});
const MatchLog = mongoose.model('MatchLog', matchLogSchema, 'matchlogs');

async function runAnalysis() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected to DB for analysis...");

        const totalMoves = await MatchLog.countDocuments();
        const winningMoves = await MatchLog.find({ wonTrick: true }).limit(2000);

        let statistics = {
            cardStats: {},
            positionStats: { first: 0, second: 0, third: 0, fourth: 0 }
        };

        winningMoves.forEach(m => {
            // Analisi carta
            const cardVal = m.move.split('-')[0];
            statistics.cardStats[cardVal] = (statistics.cardStats[cardVal] || 0) + 1;

            // Analisi posizione (quante carte c'erano già sul tavolo)
            const cardsOnTable = m.table ? m.table.split('|').filter(x => x !== "").length : 0;
            if (cardsOnTable === 0) statistics.positionStats.first++;
            else if (cardsOnTable === 1) statistics.positionStats.second++;
            else if (cardsOnTable === 2) statistics.positionStats.third++;
            else if (cardsOnTable === 3) statistics.positionStats.fourth++;
        });

        console.log("\n--- RISULTATI ANALISI TURBO ---");
        console.log(`Mosse analizzate (Vincenti): ${winningMoves.length}`);
        console.log("Distribuzione Carte Vincenti:", statistics.cardStats);
        console.log("Vittorie per Posizione al Tavolo:", statistics.positionStats);
        
        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
}

runAnalysis();
