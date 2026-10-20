import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import filter from 'leo-profanity';
import cookieParser from 'cookie-parser';
import { ScopaGame } from './games/scopa.js';
import { RubamazzettoGame } from './games/rubamazzetto.js';
import { BriscolaGame } from './games/briscola.js';
import { TressetteGame, TressettePlayer } from './games/tressette.js';

const ADMIN_KEY = process.env.ADMIN_KEY || "Lucas2024!"; // Cambiala nel file .env

// Gestione Robustezza: Evita il crash del processo per errori non gestiti
process.on('uncaughtException', (err) => {
    console.error('❌ CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

// Inizializza il filtro con le lingue supportate
filter.loadDictionary('en');
filter.add(filter.list('it'));
filter.add(filter.list('fr'));
filter.add(filter.list('es'));
filter.add(filter.list('de'));
filter.add(filter.list('pt'));
filter.add(filter.list('ru'));

// Aggiunta manuale di parole volgari o inappropriate per maggiore sicurezza
const paroleProibite = ['cazzo', 'vaffa', 'stronzo', 'puttana', 'porco', 'bastardo', 'merda', 'coglion', 'hezbollah', 'dioc', 'madonn', 'mannaggia'];
filter.add(paroleProibite);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Schema Utente MongoDB
const userSchema = new mongoose.Schema({
    uniqueCode: { type: String, required: true, unique: true },
    nickname: { type: String, required: true },
    partiteGiocate: { type: Number, default: 0 },
    partiteVinte: { type: Number, default: 0 },
    punteggioTotale: { type: Number, default: 0 },
    elo: { type: Number, default: 1000 },
    eloCiapano: { type: Number, default: 1000 },
    eloScopa: { type: Number, default: 1000 },
    eloRubamazzetto: { type: Number, default: 1000 },
    eloBriscola: { type: Number, default: 1000 },
    eloTressette: { type: Number, default: 1000 },
    lastLogin: { type: Date, default: Date.now },
    stemmi: { type: [String], default: [] }
});

// INDICI PER PERFORMANCE (Classifiche e Ricerche istantanee)
userSchema.index({ punteggioTotale: -1 });
userSchema.index({ elo: -1 });
userSchema.index({ eloCiapano: -1 });
userSchema.index({ eloScopa: -1 });
userSchema.index({ eloRubamazzetto: -1 });
userSchema.index({ eloBriscola: -1 });
userSchema.index({ eloTressette: -1 });
userSchema.index({ lastLogin: -1 });
userSchema.index({ nickname: 'text' }); // Per ricerca veloce per nome

const User = mongoose.model('User', userSchema);

// Catalogo stemmi disponibili
const BADGE_CATALOG = [
    { id: "admin", icon: "👑", name: "Admin / Creatore", color: "#e74c3c" },
    { id: "aquila", icon: "🦅", name: "Aquila", color: "#f39c12" },
    { id: "idf", icon: "✡️", name: "IDF 🇮🇱", color: "#005eb8" },
    { id: "stella", icon: "⭐", name: "Stella / VIP", color: "#f1c40f" },
    { id: "fuoco", icon: "🔥", name: "Fuoco / Campione", color: "#e74c3c" },
    { id: "diamante", icon: "💎", name: "Diamante", color: "#00d2d3" },
    { id: "fulmine", icon: "⚡", name: "Fulmine", color: "#feca57" },
    { id: "cuore", icon: "❤️", name: "Cuore", color: "#ff4757" },
    { id: "teschio", icon: "💀", name: "Teschio", color: "#a4b0be" },
    { id: "drago", icon: "🐉", name: "Drago", color: "#2ed573" },
    { id: "lupo", icon: "🐺", name: "Lupo", color: "#747d8c" },
    { id: "leone", icon: "🦁", name: "Leone", color: "#ffa502" },
    { id: "volpe", icon: "🦊", name: "Volpe", color: "#ff7f50" },
    { id: "alieno", icon: "👽", name: "Alieno", color: "#2ed573" },
    { id: "robot", icon: "🤖", name: "Robot", color: "#70a1ff" },
    { id: "mago", icon: "🧙", name: "Mago", color: "#9b59b6" },
    { id: "scudo", icon: "🛡️", name: "Scudo", color: "#3498db" },
    { id: "spada", icon: "⚔️", name: "Guerriero", color: "#e74c3c" },
    { id: "trifoglio", icon: "🍀", name: "Fortuna", color: "#2ecc71" },
    { id: "joker", icon: "🃏", name: "Joker", color: "#9b59b6" },
    { id: "razzo", icon: "🚀", name: "Razzo", color: "#e056fd" },
    { id: "trofeo", icon: "🏆", name: "Trofeo Speciale", color: "#f1c40f" }
];

const userStemmiMap = new Map();
const userStemmiByName = new Map();

async function initStemmiCache() {
    if (!dbConnected) return;
    try {
        await User.updateOne({ nickname: new RegExp("^LUCA$", "i"), stemmi: { $exists: false } }, { $set: { stemmi: ["admin"] } });
        await User.updateOne({ nickname: new RegExp("^IDF$", "i"), stemmi: { $exists: false } }, { $set: { stemmi: ["idf"] } });
        await User.updateOne({ nickname: new RegExp("^CRAZY$", "i"), stemmi: { $exists: false } }, { $set: { stemmi: ["aquila"] } });

        const allUsersWithBadges = await User.find({ stemmi: { $exists: true, $not: { $size: 0 } } });
        userStemmiMap.clear();
        userStemmiByName.clear();
        allUsersWithBadges.forEach(u => {
            if (u.uniqueCode) userStemmiMap.set(u.uniqueCode, u.stemmi);
            if (u.nickname) userStemmiByName.set(u.nickname.trim().toUpperCase(), u.stemmi);
        });
        console.log(`🏅 Cache stemmi caricata: ${allUsersWithBadges.length} utenti con stemmi personalizzati.`);
    } catch (e) {
        console.error("Errore inizializzazione stemmi cache:", e);
    }
}

// Schema Segnalazioni Bug
const reportSchema = new mongoose.Schema({
    data: { type: Date, default: Date.now },
    nickname: { type: String, default: 'Sconosciuto' },
    testo: { type: String, required: true },
    roomCode: { type: String, default: null },
    matchId: { type: String, default: null }
});
const Report = mongoose.model('Report', reportSchema);

// Schema Utenti Bannati
const bannedUserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now }
});
const BannedUser = mongoose.model('BannedUser', bannedUserSchema);


// --- NUOVO: Schema per Training AI (Capped Collection 25MB) ---
const matchLogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    matchId: String,            // ID unico della partita per correlazione
    hostNickname: String,       // Nickname di chi ha creato la lobby
    numPlayers: Number,
    roundCards: Number,
    playerIndex: Number,
    uniqueCode: String,         // Codice univoco dell'utente (per replay personali)
    nickname: String,           // Nickname del giocatore al momento della mossa
    isHuman: Boolean,
    elo: { type: Number, default: 1000 },
    aiVariant: { type: String, default: "Human" }, // Es: V4_A80_C20_S50
    dichiarazione: Number,
    preseFatte: Number,
    obiettivoRimanente: Number, // Prese mancanti per fare la dichiarazione
    finalScores: { type: Array, default: [] }, // Classifica finale della partita (nickname e punti)
    isCompleted: { type: Boolean, default: false }, // La partita è stata terminata correttamente?
    allHands: { type: Array, default: [] },    // Mani di tutti i giocatori (per replay multi-prospettiva)
    table: String,              // Carte già sul tavolo
    history: String,            // Carte già uscite nel giro
    voidSuits: String,          // Info sui semi finiti (es: "P1:Spade,P2:Coppe")
    move: String,               // Carta giocata
    wonTrick: Boolean,          // Ha vinto la presa? (Retrocompatibilità)
    trickWinnerId: Number       // ID del vincitore (impostato solo sull'ultima mossa del giro)
});

// INDICI PER PERFORMANCE (Log e Statistiche)
matchLogSchema.index({ timestamp: -1 });
matchLogSchema.index({ matchId: 1 });

const MatchLog = mongoose.model('MatchLog', matchLogSchema);

// --- NUOVO: Schema per Human Logs (Dati reali preziosi) ---
const HumanMatchLog = mongoose.model('HumanMatchLog', matchLogSchema, 'humanlogs');


// --- NUOVO: Schema per il Salvataggio dello Stato (Persistenza Match) ---
const matchStateSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true },
    host: String,
    parametri: Object,
    giocatori: Array,
    gameInstance: Object,
    timestamp: { type: Date, default: Date.now }
});
const MatchState = mongoose.model('MatchState', matchStateSchema);


// --- INTEGRAZIONE IA (GEMINI API) ---
async function checkWithAI(nickname) {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) return false;

    try {
        const prompt = `Analizza questo nickname per un gioco di carte: "${nickname}". 
        È offensivo, volgare, contiene bestemmie o riferimenti inappropriati? 
        Fai molta attenzione ai tentativi di camuffamento: scambi di lettere (es. "l" invece di "r" come in "polcodio"), uso di numeri (es. "0" invece di "o"), punti o spazi.
        Se il nome assomiglia o ammicca chiaramente a una bestemmia o a un insulto, consideralo inaccettabile.
        Rispondi ESCLUSIVAMENTE con la parola "REJECT" se è inaccettabile, oppure "PASS" se va bene.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

        console.log(`🤖 IA Mod: [${nickname}] -> ${aiResponse}`);
        return aiResponse === "REJECT";
    } catch (e) {
        console.error("Errore Gemini API:", e);
    }
    return false;
}

let dbConnected = false;
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(async () => {
            console.log('🔗 Connesso a MongoDB Atlas!');
            dbConnected = true;

            // Inizializza collezioni Capped (Limite spazio)
            try {
                // LOG AI (40MB - Ridotto per liberare spazio per i replay umani, totale Atlas 512MB)
                const collectionsMatch = await mongoose.connection.db.listCollections({ name: 'matchlogs' }).toArray();
                if (collectionsMatch.length === 0) {
                    await mongoose.connection.db.createCollection('matchlogs', {
                        capped: true,
                        size: 40 * 1024 * 1024,
                        max: 150000
                    });
                    console.log("📦 Collezione 'matchlogs' (Capped 40MB) creata.");
                } else {
                    try {
                        await mongoose.connection.db.command({ collMod: 'matchlogs', cappedSize: 40 * 1024 * 1024, cappedMax: 150000 });
                        console.log("📦 Collezione 'matchlogs' ridimensionata a 40MB.");
                    } catch (e) {
                        try {
                            await mongoose.connection.db.command({ collMod: 'matchlogs', cappedSize: 40 * 1024 * 1024 });
                        } catch (e2) { }
                    }
                }

                // REPORT BUG (5MB - 1000 report)
                const collectionsReports = await mongoose.connection.db.listCollections({ name: 'reports' }).toArray();
                if (collectionsReports.length === 0) {
                    await mongoose.connection.db.createCollection('reports', {
                        capped: true,
                        size: 5 * 1024 * 1024,
                        max: 1000
                    });
                    console.log("📦 Collezione 'reports' (Capped) creata.");
                } else {
                    try {
                        await mongoose.connection.db.command({ convertToCapped: 'reports', size: 5 * 1024 * 1024 });
                        console.log("📦 Collezione 'reports' convertita in Capped.");
                    } catch (e) { }
                }

                // HUMAN LOGS (200MB - Memoria espansa da 10MB a 200MB per migliaia di partite reali)
                const collectionsHuman = await mongoose.connection.db.listCollections({ name: 'humanlogs' }).toArray();
                if (collectionsHuman.length === 0) {
                    await mongoose.connection.db.createCollection('humanlogs', {
                        capped: true,
                        size: 200 * 1024 * 1024,
                        max: 400000
                    });
                    console.log("📦 Collezione 'humanlogs' (Capped 200MB) creata.");
                } else {
                    try {
                        await mongoose.connection.db.command({ collMod: 'humanlogs', cappedSize: 200 * 1024 * 1024, cappedMax: 400000 });
                        console.log("📦 Collezione 'humanlogs' ridimensionata con successo a 200MB (max 400.000 mosse).");
                    } catch (e) {
                        try {
                            await mongoose.connection.db.command({ collMod: 'humanlogs', cappedSize: 200 * 1024 * 1024 });
                            console.log("📦 Collezione 'humanlogs' ridimensionata con successo a 200MB (solo size).");
                        } catch (e2) {
                            console.log("Nota su humanlogs:", e2.message);
                        }
                    }
                }
            } catch (e) { console.log("Nota: Inizializzazione collezioni già completata."); }

            // --- PULIZIA SPECIFICA RICHIESTA: Elimina utenti offensivi e bestemmie ---
            try {
                // Rimuove account che contengono parole inaccettabili (cazzo, hezbollah, o radici di bestemmie)
                const deletedOffensive = await User.deleteMany({
                    nickname: { $regex: new RegExp("(cazzo|hezbollah|diocane|porcodio|madonn|dioporco|diop|mailona26|polcodio|LaMammaDiLuca)", "i") }
                });
                if (deletedOffensive.deletedCount > 0) {
                    console.log(`🗑️ Rimossi ${deletedOffensive.deletedCount} account con nickname offensivo.`);
                }
            } catch (err) {
                console.error('Errore durante la rimozione automatica:', err);
            }

            // --- NUOVO: Ripristino stati match ---
            await caricaStatiMatch();
            await initStemmiCache();
        })
        .catch(err => console.error('Errore connessione MongoDB:', err));
} else {
    console.log('⚠️ Nessun MONGODB_URI trovato! Classifiche e Login provvisori (non persistenti).');
}

app.use(express.static(__dirname));
app.use(cookieParser());

// --- MIDDLEWARE DI PROTEZIONE ADMIN ---
const authAdmin = (req, res, next) => {
    const authCookie = req.cookies.admin_session;
    if (authCookie === ADMIN_KEY) {
        return next();
    }

    // Se è una chiamata API, restituisci un errore JSON invece dell'HTML di login
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: "Sessione scaduta o non autorizzata. Ricarica la pagina." });
    }

    // Se non autenticato, mostra la pagina di login
    const returnUrl = req.originalUrl || '/stato-allenamento-777';
    res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Area Protetta</title>
                <style>
                    body { background: #0f0f0f; color: #ff0000; font-family: monospace; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .login-box { border: 1px solid #ff0000; padding: 30px; border-radius: 10px; text-align: center; box-shadow: 0 0 20px rgba(255,0,0,0.2); }
                    input { background: #1a1a1a; border: 1px solid #ff0000; color: white; padding: 10px; margin: 10px 0; width: 200px; text-align: center; }
                    button { background: #ff0000; color: black; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; }
                    button:hover { background: white; }
                </style>
            </head>
            <body>
                <div class="login-box">
                    <h2>⚠️ ACCESSO RISERVATO</h2>
                    <p>Inserisci il Codice Operatore</p>
                    <form action="/admin-login-verify" method="POST">
                        <input type="hidden" name="returnUrl" value="${returnUrl}">
                        <input type="password" name="code" placeholder="******" autofocus required><br>
                        <button type="submit">SBLOCCA SISTEMA</button>
                    </form>
                    ${req.query.err ? '<p style="font-size:0.8em;">Codice Errato!</p>' : ''}
                </div>
            </body>
            </html>
        `);
};

// Rotta per verificare il login
app.post('/admin-login-verify', express.urlencoded({ extended: true }), (req, res) => {
    const code = req.body.code ? req.body.code.trim() : "";
    const adminKey = ADMIN_KEY ? ADMIN_KEY.trim() : "";
    const returnUrl = req.body.returnUrl || '/stato-allenamento-777';

    if (code === adminKey) {
        res.cookie('admin_session', adminKey, { maxAge: 86400000, httpOnly: true, path: '/' }); // Scade in 24h
        res.redirect(returnUrl);
    } else {
        res.redirect(returnUrl + (returnUrl.includes('?') ? '&' : '?') + 'err=1');
    }
});

// --- ROTTE PROTETTE DA authAdmin ---
app.get('/api/admin/badges-catalog', authAdmin, (req, res) => {
    res.json({ success: true, catalog: BADGE_CATALOG });
});

app.post('/api/admin/user/:uniqueCode/badges', authAdmin, express.json(), async (req, res) => {
    if (!dbConnected) return res.status(500).json({ success: false, error: "DB non connesso" });
    try {
        const { uniqueCode } = req.params;
        let { stemmi } = req.body;
        if (!Array.isArray(stemmi)) {
            stemmi = [];
        }
        stemmi = [...new Set(stemmi.map(s => String(s).trim()).filter(Boolean))];

        const user = await User.findOneAndUpdate(
            { uniqueCode: uniqueCode },
            { $set: { stemmi: stemmi } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, error: "Utente non trovato" });
        }

        userStemmiMap.set(user.uniqueCode, user.stemmi);
        if (user.nickname) {
            userStemmiByName.set(user.nickname.trim().toUpperCase(), user.stemmi);
        }

        const stemmaCalcolato = ottieniStemma(user.uniqueCode, user.nickname);

        io.emit('stemma_aggiornato', {
            uniqueCode: user.uniqueCode,
            nickname: user.nickname,
            stemma: stemmaCalcolato,
            stemmi: user.stemmi
        });

        for (const code in lobbies) {
            let modified = false;
            lobbies[code].giocatori.forEach(g => {
                if (g.uniqueCode === user.uniqueCode || (g.nome && g.nome.trim().toUpperCase() === user.nickname.trim().toUpperCase())) {
                    g.stemma = stemmaCalcolato;
                    modified = true;
                }
            });
            if (modified) {
                inviaAggiornamentoLobby(code);
            }
        }

        res.json({ success: true, stemmi: user.stemmi, stemma: stemmaCalcolato });
    } catch (e) {
        console.error("Errore salvataggio stemmi:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/find-user/:query', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const query = req.params.query;
        // Cerca per nickname (anche parziale/regex) o per uniqueCode
        const users = await User.find({
            $or: [
                { nickname: { $regex: new RegExp(query, "i") } },
                { uniqueCode: query }
            ]
        }).limit(20);

        if (users.length === 0) return res.json({ success: false, error: "Nessun utente trovato" });
        const usersWithStemmi = users.map(u => {
            const uObj = u.toObject ? u.toObject() : { ...u };
            uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
            uObj.stemmi = u.stemmi || (userStemmiMap.get(u.uniqueCode) || []);
            return uObj;
        });
        res.json({ success: true, users: usersWithStemmi });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA: LISTA COMPLETA UTENTI (OTTIMIZZATA CON INDICI) ---
app.get('/api/admin/all-users', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });

    try {
        // Grazie agli indici aggiunti prima, questa query è velocissima anche con molti utenti
        const users = await User.find().sort({ lastLogin: -1 }).limit(1000);
        const usersWithStemmi = users.map(u => {
            const uObj = u.toObject ? u.toObject() : { ...u };
            uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
            uObj.stemmi = u.stemmi || (userStemmiMap.get(u.uniqueCode) || []);
            return uObj;
        });
        res.json({ success: true, users: usersWithStemmi });
    } catch (e) {
        console.error("Errore rotta all-users:", e);
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVE ROTTE PER REPLAY ---
app.get('/api/replays/:uniqueCode', async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const { search, limit: reqLimit } = req.query;
        const filter = { uniqueCode: req.params.uniqueCode };

        // Se c'è una ricerca, cerchiamo tra i nickname presenti nel match
        if (search) {
            filter.nickname = new RegExp(search, 'i');
        }

        // --- NUOVO: Filtro Qualità Replay ---
        // Se non è un admin, mostriamo solo i replay salvati col nuovo sistema sequenziale
        // Il nuovo sistema garantisce la presenza di 'trickWinnerId' in almeno una mossa del match.
        const isAdmin = req.cookies['admin_session'] === ADMIN_KEY;
        if (!isAdmin) {
            filter.trickWinnerId = { $exists: true };
        }

        const limitParsed = parseInt(reqLimit) || 50;
        const limit = Math.min(Math.max(limitParsed, 1), 200);

        const replays = await HumanMatchLog.aggregate([
            { $match: filter },
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: "$matchId",
                    timestamp: { $first: "$timestamp" },
                    numPlayers: { $first: "$numPlayers" },
                    hostNickname: { $first: "$hostNickname" },
                    humanPlayers: { $addToSet: { $cond: ["$isHuman", "$nickname", "$$REMOVE"] } },
                    finalScores: { $first: "$finalScores" },
                    isCompleted: { $first: "$isCompleted" }
                }
            },
            { $sort: { timestamp: -1 } },
            { $limit: limit }
        ]);
        res.json({ success: true, replays });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA: REPLAY PER ADMIN (Tutte le partite + Ricerca) ---
app.get('/api/admin/replays', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const { search, limit: reqLimit } = req.query;
        const filter = {};
        if (search) {
            filter.nickname = new RegExp(search, 'i');
        }

        const limitParsed = parseInt(reqLimit) || 200;
        const limit = Math.min(Math.max(limitParsed, 1), 500);

        const replays = await HumanMatchLog.aggregate([
            { $match: filter },
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: "$matchId",
                    timestamp: { $first: "$timestamp" },
                    numPlayers: { $first: "$numPlayers" },
                    hostNickname: { $first: "$hostNickname" },
                    humanPlayers: { $addToSet: { $cond: ["$isHuman", "$nickname", "$$REMOVE"] } },
                    finalScores: { $first: "$finalScores" },
                    isCompleted: { $first: "$isCompleted" }
                }
            },
            { $sort: { timestamp: -1 } },
            { $limit: limit }
        ]);
        res.json({ success: true, replays });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.get('/api/replay/:matchId', async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const moves = await HumanMatchLog.find({ matchId: req.params.matchId }).sort({ timestamp: 1 });
        res.json({ success: true, moves });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA: ELIMINA UTENTE PER ADMIN ---
app.get('/api/admin/delete-user/:uniqueCode', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const code = req.params.uniqueCode;
        const result = await User.deleteOne({ uniqueCode: code });
        if (result.deletedCount === 0) return res.json({ success: false, error: "Nessun utente eliminato" });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA: BANNA E ELIMINA UTENTE PER ADMIN ---
app.get('/api/admin/ban-user/:uniqueCode', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const code = req.params.uniqueCode;
        const user = await User.findOne({ uniqueCode: code });
        if (!user) return res.json({ success: false, error: "Utente non trovato" });

        // Aggiungi al ban list (se non già presente)
        try {
            await new BannedUser({ nickname: user.nickname }).save();
        } catch (err) {
            // Se è già bannato, procediamo comunque alla cancellazione dell'account
        }

        // Elimina l'utente
        await User.deleteOne({ uniqueCode: code });

        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA: TOGGLE MASTER AI ---
app.post('/api/admin/toggle-turbo', authAdmin, (req, res) => {
    turboEnabled = !turboEnabled;
    if (turboEnabled) {
        avviaAutoTraining(); // Riavvia subito se viene acceso
    } else {
        isSimulando = false;
    }
    res.json({ success: true, enabled: turboEnabled });
});

// ROTTA SEGRETA PER LEGGERE I REPORT (Sia da DB che da file se esiste)
app.get('/stato-segreta-report-777', authAdmin, async (req, res) => {
    try {
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin - Bug Reports</title>
            <style>
                body { background: #1a1a1a; color: #eee; font-family: sans-serif; padding: 20px; }
                .report-card { background: #2c3e50; padding: 15px; border-radius: 8px; border-left: 5px solid #e74c3c; margin-bottom: 10px; position: relative; }
                .report-date { color: #f1c40f; font-weight: bold; }
                .report-user { color: #3498db; }
                .delete-btn { position: absolute; top: 15px; right: 15px; background: none; border: none; font-size: 1.5rem; cursor: pointer; transition: transform 0.2s; }
                .delete-btn:hover { transform: scale(1.2); }
            </style>
        </head>
        <body>
            <h1 style="color: #e74c3c;">🪲 Segnalazioni Bug Ricevute</h1>
            <div id="reports-container" style="display: flex; flex-direction: column; gap: 10px;">`;

        if (dbConnected) {
            const reports = await Report.find().sort({ data: -1 });
            if (reports.length === 0) {
                html += "<p>Nessuna segnalazione nel database.</p>";
            } else {
                reports.forEach(r => {
                    const matchInfo = r.matchId ? '<br><span style="color: #2ecc71; font-size: 0.8rem;">Partita ID: ' + r.matchId + ' (Room: ' + r.roomCode + ')</span>' : '';
                    html += `
                    <div class="report-card" id="card-${r._id}">
                        <button class="delete-btn" onclick="eliminaReport('${r._id}')">🗑️</button>
                        <span class="report-date">${r.data.toLocaleString('it-IT')}</span> - 
                        <span class="report-user">Utente: ${r.nickname}</span>
                        ${matchInfo}
                        <br>
                        <p style="margin-top: 10px; font-style: italic;">"${r.testo}"</p>
                    </div>`;
                });
            }
        } else {
            html += "<p style='color: orange;'>⚠️ Database non connesso.</p>";
        }

        html += `
            </div>
            <script>
                async function eliminaReport(id) {
                    if(!confirm('Vuoi eliminare questa segnalazione?')) return;
                    try {
                        const res = await fetch('/elimina-report-777', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: id })
                        });
                        const data = await res.json();
                        if(data.ok) {
                            document.getElementById('card-' + id).remove();
                        } else {
                            alert('Errore durante l\\'eliminazione');
                        }
                    } catch(e) {
                        alert('Errore di connessione');
                    }
                }
            </script>
        </body>
        </html>`;
        res.send(html);
    } catch (err) {
        res.status(500).send("Errore nel recupero dei report.");
    }
});

// ROTTA SEGRETA: RESET LOG TURBO
app.post('/reset-turbo-logs-777', authAdmin, express.json(), async (req, res) => {
    try {
        if (!dbConnected) return res.status(500).json({ ok: false, msg: "DB non connesso" });

        console.log("⚠️ RESET RICHIESTO: Svuotamento log Turbo...");
        await mongoose.connection.db.collection('matchlogs').drop();
        await mongoose.connection.db.createCollection('matchlogs', {
            capped: true,
            size: 40 * 1024 * 1024,
            max: 150000
        });

        res.json({ ok: true });
    } catch (err) {
        console.error("Errore reset turbo:", err);
        res.status(500).json({ ok: false });
    }
});

// ROTTA SEGRETA PER SCARICARE I LOG AI IN FORMATO EXCEL (CSV) - OTTIMIZZATA CON STREAMING
app.get('/scarica-dataset-lucas-777', authAdmin, async (req, res) => {
    try {
        if (!dbConnected) return res.status(500).send("DB non connesso");

        const type = req.query.type || 'turbo';
        const Model = (type === 'human') ? HumanMatchLog : MatchLog;
        const filename = (type === 'human') ? 'lucas_HUMAN_data.csv' : 'lucas_TURBO_data.csv';

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

        // Scriviamo l'intestazione
        res.write("Timestamp,MatchId,NumPlayers,RoundCards,PlayerIdx,IsHuman,AIVariant,Decl,Made,Target,Hand,Table,History,VoidSuits,Move,Won\n");

        // Usiamo un CURSORE per leggere i dati uno alla volta (Streaming)
        // Questo evita di saturare la RAM del server con 400k+ documenti
        const cursor = Model.find().sort({ timestamp: 1 }).cursor();

        cursor.on('data', (l) => {
            const row = [
                l.timestamp ? l.timestamp.toISOString() : '',
                l.matchId,
                l.numPlayers,
                l.roundCards,
                l.playerIndex,
                l.isHuman ? 1 : 0,
                l.aiVariant || "N/A",
                l.dichiarazione,
                l.preseFatte,
                l.obiettivoRimanente,
                `"${l.hand || ''}"`,
                `"${l.table || ''}"`,
                `"${l.history || ''}"`,
                `"${l.voidSuits || ''}"`,
                l.move,
                l.wonTrick ? 1 : 0
            ].join(',') + "\n";

            res.write(row);
        });

        cursor.on('end', () => {
            res.end();
        });

        cursor.on('error', (err) => {
            console.error("Errore durante lo streaming CSV:", err);
            if (!res.headersSent) res.status(500).send("Errore durante il download");
            res.end();
        });

    } catch (err) {
        console.error("Errore generale download CSV:", err);
        if (!res.headersSent) res.status(500).send("Errore generazione CSV");
    }
});

// --- NUOVA ROTTA SEGRETA: ELIMINA REPLAY SINGOLO ---
app.get('/delete-replay-777/:matchId', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        const matchId = req.params.matchId;
        const result = await HumanMatchLog.deleteMany({ matchId: matchId });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA SEGRETA: PULIZIA MASSIVA REPLAY OBSOLETI ---
app.get('/clean-old-replays-777', authAdmin, async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        // Elimina tutti i log che non hanno il campo trickWinnerId (vecchio sistema)
        const result = await HumanMatchLog.deleteMany({ trickWinnerId: { $exists: false } });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVA ROTTA SEGRETA: ESPANSIONE MEMORIA REPLAY ---
app.post('/api/admin/expand-replays', authAdmin, async (req, res) => {
    if (!dbConnected) return res.status(500).json({ success: false, error: "DB non connesso" });
    try {
        let msg = "";
        try {
            await mongoose.connection.db.command({ collMod: 'humanlogs', cappedSize: 200 * 1024 * 1024, cappedMax: 400000 });
            msg = "Memoria humanlogs espansa a 200MB (max 400.000 mosse).";
        } catch (err1) {
            await mongoose.connection.db.command({ collMod: 'humanlogs', cappedSize: 200 * 1024 * 1024 });
            msg = "Memoria humanlogs espansa a 200MB (solo size).";
        }
        let humanStats = null;
        try {
            humanStats = await mongoose.connection.db.command({ collStats: 'humanlogs' });
        } catch (e) { }
        res.json({ success: true, message: msg, stats: humanStats });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ROTTA SEGRETA: DASHBOARD MONITORAGGIO AI
app.get('/stato-allenamento-777', authAdmin, async (req, res) => {
    try {
        if (!dbConnected) return res.status(500).send("Database non connesso.");

        // Statistiche dal DB
        const totaleTurbo = await MatchLog.countDocuments();
        const totaleHuman = await HumanMatchLog.countDocuments();
        const partiteTurbo = (await MatchLog.distinct("matchId")).length;
        const partiteHuman = (await HumanMatchLog.distinct("matchId")).length;
        const ultimoLog = await MatchLog.findOne().sort({ timestamp: -1 });
        const ultimoHuman = await HumanMatchLog.findOne().sort({ timestamp: -1 });

        let humanStats = null;
        let turboStats = null;
        try {
            humanStats = await mongoose.connection.db.command({ collStats: 'humanlogs' });
        } catch (e) { }
        try {
            turboStats = await mongoose.connection.db.command({ collStats: 'matchlogs' });
        } catch (e) { }

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Lucas AI - Monitor</title>
            <style>
                body { background: #0f0f0f; color: #00ff00; font-family: 'Courier New', Courier, monospace; padding: 40px; }
                .panel { border: 1px solid #00ff00; padding: 20px; border-radius: 10px; box-shadow: 0 0 15px rgba(0,255,0,0.2); }
                .card { border: 1px solid #333; padding: 15px; margin-top: 15px; border-radius: 8px; }
                .status { font-size: 1.5rem; font-weight: bold; margin-bottom: 20px; }
                .active { color: #00ff00; }
                .paused { color: #ff0000; }
                .metric { margin: 10px 0; font-size: 1.2rem; }
                .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; border: 1px solid #00ff00; color: #00ff00; text-decoration: none; cursor: pointer; background: transparent; }
                .btn-danger { border-color: #ff0000; color: #ff0000; }
                .btn:hover { background: #00ff00; color: #000; }
            </style>
            <script src="/socket.io/socket.io.js"></script>
        </head>
        <body>
            <div class="panel">
                <h1>🤖 LUCAS AI - MONITORING CENTER</h1>
                <hr style="border: 0.5px solid #00ff00;">
                
                <div class="status">
                    STATO: <span class="${isSimulando ? 'active' : 'paused'}">
                        ${isSimulando ? '● IN CORSO (Simulazione Turbo)' : '○ IN PAUSA (Giocatori Reali Online)'}
                    </span>
                </div>

                <div class="metric">Giocatori Reali Online: ${umaniConnessi - osservatoriAdmin}</div>
                <div class="metric">Admin in Osservazione: ${osservatoriAdmin}</div>
                
                <div class="card">
                    <h2>⚙️ Gestione Auto-Training</h2>
                    <p>Stato Simulatore AI: <strong id="master-ai-status">${turboEnabled ? '<span style="color:#00ff00;">ACCESO</span>' : '<span style="color:#ff0000;">SPENTO</span>'}</strong></p>
                    <button class="btn" style="border-color:#3498db; color:#3498db;" onclick="toggleTurbo()">Attiva / Disattiva Auto-Training</button>
                    <p style="font-size: 0.8em; color: #888; margin-top: 10px;">Nota: Anche se ACCESO, il simulatore si ferma se ci sono umani online per non appesantire il server.</p>
                </div>

                <div class="card">
                    <h2>⚙️ Gestione Log</h2>
                    <p>Attenzione: l'operazione è irreversibile.</p>
                    <button class="btn btn-danger" onclick="confermaSvuota()">🗑️ SVUOTA LOG TURBO</button>
                </div>

                <div class="card">
                    <h2>👤 Gestione Utente & Stemmi</h2>
                    <div style="display:flex; gap:10px; margin-bottom:10px;">
                        <input type="text" id="user-query" placeholder="Nickname o UniqueID..." style="flex-grow:1; padding:8px; border-radius:5px; border:1px solid #444; background:#222; color:white;">
                        <button class="btn" onclick="cercaUtente()">🔍 Cerca</button>
                        <button class="btn" onclick="caricaTuttiUtenti()">📋 Lista Completa</button>
                    </div>
                    
                    <div id="user-info-box" style="display:none; background:rgba(0,0,0,0.4); padding:15px; border-radius:8px; font-size:0.95em; border:1px solid #00ff00; margin-bottom: 15px; box-shadow: 0 0 10px rgba(0,255,0,0.15);">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:8px; margin-bottom:10px;">
                            <h3 style="margin:0; color:#00ff00;">👤 Dettagli: <span id="info-nick" style="color:#f1c40f;">-</span></h3>
                            <span style="font-size:0.8em; color:#888;">ID: <span id="info-code" style="font-family:monospace; color:#aaa;">-</span></span>
                        </div>
                        
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap:10px; margin-bottom:15px; background:rgba(255,255,255,0.03); padding:8px; border-radius:5px;">
                            <div><strong>Partite:</strong> <span id="info-matches" style="color:#f1c40f;">0</span></div>
                            <div><strong>Vinte:</strong> <span id="info-wins" style="color:#2ecc71;">0</span></div>
                            <div><strong>Punti:</strong> <span id="info-points" style="color:#e67e22;">0</span></div>
                            <div><strong>ELO:</strong> <span id="info-elo" style="color:#3498db;">1000</span></div>
                        </div>

                        <!-- SEZIONE STEMMI (BADGES) -->
                        <div style="border:1px solid #444; background:rgba(0,0,0,0.3); border-radius:6px; padding:12px; margin-bottom:15px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <strong style="color:#f1c40f; font-size:1.05em;">🏅 Stemmi Assegnati:</strong>
                                <span id="badge-save-status" style="font-size:0.85em; color:#2ecc71; font-weight:bold; display:none;">✅ Modifiche salvate!</span>
                            </div>
                            
                            <!-- Contenitore chips stemmi -->
                            <div id="current-badges-container" style="display:flex; flex-wrap:wrap; gap:8px; min-height:36px; padding:8px; background:#111; border-radius:5px; border:1px dashed #555; align-items:center;">
                                <span style="color:#666; font-style:italic; font-size:0.85em;">Nessuno stemma assegnato</span>
                            </div>

                            <!-- Controlli per aggiungere stemmi -->
                            <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                                <select id="badge-select" style="padding:7px 10px; background:#222; color:#fff; border:1px solid #555; border-radius:5px; font-size:0.9em; cursor:pointer;">
                                </select>
                                
                                <input type="text" id="custom-badge-input" placeholder="Emoji personalizzato (es: 🎯)" style="display:none; width:180px; padding:7px; background:#222; color:white; border:1px solid #00ff00; border-radius:5px; font-size:0.9em;">
                                
                                <button class="btn" onclick="aggiungiStemmaUtente()" style="margin:0; padding:7px 14px; border-color:#f1c40f; color:#f1c40f; font-weight:bold;">➕ Aggiungi</button>
                                <button class="btn" onclick="salvaStemmiUtente()" style="margin:0; padding:7px 16px; border-color:#2ecc71; color:#2ecc71; font-weight:bold; background:rgba(46, 204, 113, 0.1);">💾 Salva Stemmi</button>
                            </div>
                        </div>

                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-danger" id="btn-delete-user" style="flex:1; margin-top:0;">❌ ELIMINA UTENTE</button>
                            <button class="btn" id="btn-ban-user" style="flex:1; margin-top:0; border-color:#e67e22; color:#e67e22;">🚫 BAN & ELIMINA</button>
                        </div>
                    </div>

                    <div id="all-users-container" style="display:none; max-height:400px; overflow-y:auto; border:1px solid #333; margin-top:10px;">
                        <table style="width:100%; border-collapse:collapse; font-size:0.8em;">
                            <thead style="background:#111; position:sticky; top:0;">
                                <tr>
                                    <th style="padding:5px; border:1px solid #333;">Nick</th>
                                    <th style="padding:5px; border:1px solid #333;">Stemmi</th>
                                    <th style="padding:5px; border:1px solid #333;">Punti</th>
                                    <th style="padding:5px; border:1px solid #333;">ELO</th>
                                    <th style="padding:5px; border:1px solid #333;">Giocate</th>
                                    <th style="padding:5px; border:1px solid #333;">Vinte</th>
                                    <th style="padding:5px; border:1px solid #333;">Last Login</th>
                                    <th style="padding:5px; border:1px solid #333;">Azioni</th>
                                </tr>
                            </thead>
                            <tbody id="users-tbody"></tbody>
                        </table>
                    </div>
                </div>

                <div class="card">
                    <h2>🎬 Replay Explorer (Global)</h2>
                    <div style="display:flex; gap:10px; margin-bottom:10px;">
                        <input type="text" id="admin-replay-search" placeholder="Cerca per nickname in tutto il DB..." style="flex-grow:1; padding:10px; border-radius:5px; border:1px solid #444; background:#222; color:white; outline:none;">
                        <button class="btn" onclick="cercaReplaysAdmin()">🔍 Cerca Replays</button>
                    </div>
                    <div id="admin-replays-list" style="max-height:500px; overflow-y:auto; border:1px solid #333; padding:15px; background:rgba(0,0,0,0.2); border-radius:8px;">
                        <p style="color:#888; text-align:center;">Inserisci un nome o premi cerca per vedere gli ultimi match globali.</p>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                    <div>
                        <h3>💾 DATASET TURBO (AI)</h3>
                        <div class="metric">Mosse registrate: ${totaleTurbo.toLocaleString()}</div>
                        <div class="metric">Partite: ${partiteTurbo}</div>
                        <div class="metric">Memoria: ${turboStats ? (turboStats.size / (1024 * 1024)).toFixed(1) + ' MB' : 'N/D'} / ${turboStats && turboStats.maxSize ? (turboStats.maxSize / (1024 * 1024)).toFixed(0) + ' MB' : '40 MB'}</div>
                        <a href="/scarica-dataset-lucas-777?type=turbo" class="btn">SCARICA TURBO CSV</a>
                    </div>
                    <div style="border-left: 1px solid #00ff00; padding-left: 20px;">
                        <h3>💎 DATASET UMANO (REPLAY)</h3>
                        <div class="metric">Mosse registrate: ${totaleHuman.toLocaleString()}</div>
                        <div class="metric">Partite archiviate: ${partiteHuman}</div>
                        <div class="metric">Memoria: ${humanStats ? (humanStats.size / (1024 * 1024)).toFixed(1) + ' MB' : 'N/D'} / ${humanStats && humanStats.maxSize ? (humanStats.maxSize / (1024 * 1024)).toFixed(0) + ' MB' : '200 MB'}</div>
                        <a href="/scarica-dataset-lucas-777?type=human" class="btn">SCARICA HUMAN CSV</a>
                        <button class="btn" style="border-color:#3498db; color:#3498db; margin-top:10px; display:block;" onclick="espandiReplay()">🚀 Espandi Memoria Replay a 200MB</button>
                    </div>
                </div>
                
                <br>
                <div class="metric">Ultimo Log (AI): ${ultimoLog ? ultimoLog.timestamp.toLocaleString('it-IT') : '---'}</div>
                <div class="metric">Ultimo Log (Umano): ${ultimoHuman ? ultimoHuman.timestamp.toLocaleString('it-IT') : '---'}</div>
                
                <br>
                <a href="/stato-segreta-report-777" class="btn">VEDI BUG REPORT</a>
            </div>

            <script>
                const socket = io({ query: { role: 'admin' } });

                async function espandiReplay() {
                    if (confirm("Vuoi assicurarti che la memoria dei replay umani sia espansa a 200MB su MongoDB?")) {
                        try {
                            const res = await fetch('/api/admin/expand-replays', { method: 'POST' });
                            const data = await res.json();
                            if (data.success) {
                                alert("Successo: " + data.message);
                                location.reload();
                            } else {
                                alert("Errore: " + data.error);
                            }
                        } catch (e) {
                            alert("Errore di rete");
                        }
                    }
                }

                async function toggleTurbo() {
                    try {
                        const res = await fetch('/api/admin/toggle-turbo', { method: 'POST' });
                        if (res.status === 401) return location.reload();
                        const data = await res.json();
                        if (data.success) {
                            location.reload();
                        }
                    } catch (e) {
                        alert("Errore di rete");
                    }
                }

                function confermaSvuota() {
                    if (confirm("ATTENZIONE: Stai per eliminare TUTTI i log Turbo (AI). L'azione è irreversibile. Procedere?")) {
                        fetch('/reset-turbo-logs-777', { method: 'POST' }).then(res => res.json()).then(data => {
                            if (data.ok) { alert('Archivio Turbo svuotato!'); location.reload(); }
                            else alert('Errore durante il reset.');
                        });
                    }
                }

                const BADGE_CATALOG = ${JSON.stringify(BADGE_CATALOG)};
                let currentUserSelected = null;
                let currentEditingBadges = [];

                function escapeHtml(str) {
                    if (!str) return '';
                    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
                }

                function popolaSelectStemmi() {
                    const sel = document.getElementById('badge-select');
                    if (!sel) return;
                    sel.innerHTML = '<option value="">-- Scegli uno stemma da aggiungere --</option>' +
                        BADGE_CATALOG.map(b => \`<option value="\${b.id}">\${b.icon} \${b.name}</option>\`).join('') +
                        '<option value="__custom__">🎨 Altro (Emoji o testo personalizzato)...</option>';
                    
                    sel.onchange = () => {
                        const customInput = document.getElementById('custom-badge-input');
                        if (sel.value === '__custom__') {
                            customInput.style.display = 'inline-block';
                            customInput.focus();
                        } else {
                            customInput.style.display = 'none';
                        }
                    };
                }

                function apriDettaglioUtente(user) {
                    currentUserSelected = user;
                    currentEditingBadges = Array.isArray(user.stemmi) ? [...user.stemmi] : [];
                    
                    if (currentEditingBadges.length === 0 && user.stemma) {
                        currentEditingBadges = user.stemma.split(',').map(s => s.trim()).filter(s => s && !['oro', 'argento', 'bronzo'].includes(s));
                    }

                    const box = document.getElementById('user-info-box');
                    box.style.display = 'block';
                    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

                    document.getElementById('info-nick').innerText = user.nickname;
                    document.getElementById('info-code').innerText = user.uniqueCode;
                    document.getElementById('info-matches').innerText = user.partiteGiocate ?? 0;
                    document.getElementById('info-wins').innerText = user.partiteVinte ?? 0;
                    document.getElementById('info-points').innerText = user.punteggioTotale ?? 0;
                    document.getElementById('info-elo').innerText = user.elo ?? 1000;

                    renderBadgesChips();

                    document.getElementById('btn-delete-user').onclick = () => eseguiAzioneUtente('delete', user);
                    document.getElementById('btn-ban-user').onclick = () => eseguiAzioneUtente('ban', user);
                }

                function renderBadgesChips() {
                    const container = document.getElementById('current-badges-container');
                    if (!container) return;

                    if (!currentEditingBadges || currentEditingBadges.length === 0) {
                        container.innerHTML = '<span style="color:#888; font-style:italic; font-size:0.85em;">Nessuno stemma assegnato. Scegli uno stemma qui sotto per aggiungerlo.</span>';
                        return;
                    }

                    container.innerHTML = currentEditingBadges.map((badgeKey, idx) => {
                        const found = BADGE_CATALOG.find(b => b.id.toLowerCase() === badgeKey.toLowerCase());
                        const icon = found ? found.icon : badgeKey;
                        const name = found ? found.name : badgeKey;
                        return \`
                            <span style="display:inline-flex; align-items:center; gap:6px; background:#222; border:1px solid #555; padding:5px 10px; border-radius:15px; font-size:0.9em; box-shadow:0 2px 4px rgba(0,0,0,0.5);">
                                <span style="font-size:1.15em;">\${icon}</span>
                                <span style="color:#eee; font-weight:500;">\${escapeHtml(name)}</span>
                                <button type="button" onclick="rimuoviStemma(\${idx})" style="background:transparent; border:none; color:#ff4d4d; font-weight:bold; cursor:pointer; font-size:1em; padding:0 2px; margin-left:4px;" title="Rimuovi stemma">✕</button>
                            </span>
                        \`;
                    }).join('');
                }

                function aggiungiStemmaUtente() {
                    if (!currentUserSelected) return alert("Seleziona prima un utente!");
                    const sel = document.getElementById('badge-select');
                    let val = sel.value;
                    if (!val) return alert("Seleziona uno stemma dalla lista o scegli 'Altro'!");

                    if (val === '__custom__') {
                        const customInput = document.getElementById('custom-badge-input');
                        val = customInput.value.trim();
                        if (!val) return alert("Inserisci un emoji o un testo per lo stemma personalizzato!");
                    }

                    if (currentEditingBadges.some(b => b.toLowerCase() === val.toLowerCase())) {
                        return alert("Questo stemma è già presente nella lista dell'utente!");
                    }

                    currentEditingBadges.push(val);
                    renderBadgesChips();

                    sel.value = "";
                    const customInput = document.getElementById('custom-badge-input');
                    customInput.value = "";
                    customInput.style.display = "none";
                }

                function rimuoviStemma(index) {
                    if (index >= 0 && index < currentEditingBadges.length) {
                        currentEditingBadges.splice(index, 1);
                        renderBadgesChips();
                    }
                }

                async function salvaStemmiUtente() {
                    if (!currentUserSelected) return alert("Nessun utente selezionato.");
                    
                    try {
                        const res = await fetch('/api/admin/user/' + encodeURIComponent(currentUserSelected.uniqueCode) + '/badges', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ stemmi: currentEditingBadges })
                        });

                        if (res.status === 401) {
                            alert("Sessione scaduta! Ricarica la pagina.");
                            return location.reload();
                        }

                        const data = await res.json();
                        if (data.success) {
                            currentUserSelected.stemmi = data.stemmi;
                            currentUserSelected.stemma = data.stemma;
                            const statusEl = document.getElementById('badge-save-status');
                            if (statusEl) {
                                statusEl.style.display = 'inline';
                                setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
                            }
                            aggiornaRigaUtenteTabella(currentUserSelected);
                        } else {
                            alert("Errore salvataggio: " + (data.error || "Sconosciuto"));
                        }
                    } catch (e) {
                        alert("Errore di connessione: " + e.message);
                    }
                }

                function aggiornaRigaUtenteTabella(user) {
                    const row = document.getElementById('row-user-' + user.uniqueCode);
                    if (!row) return;
                    const badges = Array.isArray(user.stemmi) ? user.stemmi : [];
                    const badgesIcons = badges.map(bKey => {
                        const f = BADGE_CATALOG.find(b => b.id.toLowerCase() === bKey.toLowerCase());
                        return f ? f.icon : bKey;
                    }).join(' ');
                    if (row.children && row.children[1]) {
                        row.children[1].innerText = badgesIcons || '-';
                        row.children[1].title = badges.join(', ');
                    }
                }

                async function cercaUtente() {
                    try {
                        const q = document.getElementById('user-query').value.trim();
                        if (!q) return;
                        const res = await fetch('/api/admin/find-user/' + encodeURIComponent(q));
                        
                        if (res.status === 401) {
                            alert("Sessione scaduta! Ricarica la pagina.");
                            return location.reload();
                        }
                        
                        const data = await res.json();
                        const box = document.getElementById('user-info-box');
                        
                        if (data.success && data.users.length > 0) {
                            if (data.users.length === 1) {
                                apriDettaglioUtente(data.users[0]);
                            } else {
                                box.style.display = 'none';
                                renderListaUtenti(data.users);
                            }
                        } else {
                            alert("Utente non trovato!");
                            box.style.display = 'none';
                        }
                    } catch(e) { alert("Errore durante la ricerca: " + e.message); }
                }

                async function eseguiAzioneUtente(tipo, user) {
                    const msg = tipo === 'ban' 
                        ? "ATTENZIONE: Vuoi BANNARE ed ELIMINARE l'utente " + user.nickname + "? Non potrà più registrarsi con questo nome."
                        : "Sei sicuro di voler eliminare l'utente " + user.nickname + "?";
                    
                    if (!confirm(msg)) return;

                    try {
                        const url = tipo === 'ban' ? '/api/admin/ban-user/' : '/api/admin/delete-user/';
                        const res = await fetch(url + encodeURIComponent(user.uniqueCode));
                        if (res.status === 401) return location.reload();
                        
                        const resData = await res.json();
                        if (resData.success) {
                            alert(tipo === 'ban' ? "Utente BANNATO ed eliminato." : "Utente eliminato.");
                            document.getElementById('user-info-box').style.display = 'none';
                            document.getElementById('user-query').value = '';
                            if (document.getElementById('all-users-container').style.display !== 'none') {
                                caricaTuttiUtenti();
                            }
                        } else {
                            alert("Errore: " + resData.error);
                        }
                    } catch(e) { alert("Errore durante l'operazione"); }
                }

                function renderListaUtenti(users) {
                    const container = document.getElementById('all-users-container');
                    const tbody = document.getElementById('users-tbody');
                    container.style.display = 'block';
                    tbody.innerHTML = '';

                    users.forEach(u => {
                        const tr = document.createElement('tr');
                        tr.id = 'row-user-' + u.uniqueCode;
                        const lastDate = u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'N/A';
                        const elo = u.elo || 1000;

                        const badges = Array.isArray(u.stemmi) ? u.stemmi : (u.stemma ? u.stemma.split(',') : []);
                        const badgesIcons = badges.map(bKey => {
                            const f = BADGE_CATALOG.find(b => b.id.toLowerCase() === bKey.toLowerCase());
                            return f ? f.icon : bKey;
                        }).join(' ');
                        
                        const tdNick = document.createElement('td');
                        tdNick.style = "padding:6px; border:1px solid #333; color:#f1c40f; cursor:pointer;";
                        tdNick.innerHTML = \`<strong>\${escapeHtml(u.nickname)}</strong>\`;
                        tdNick.onclick = () => apriDettaglioUtente(u);

                        const tdStemmi = document.createElement('td');
                        tdStemmi.style = "padding:6px; border:1px solid #333; text-align:center; font-size:1.15em;";
                        tdStemmi.innerText = badgesIcons || '-';
                        tdStemmi.title = badges.join(', ');
                        
                        const tdPunti = document.createElement('td');
                        tdPunti.style = "padding:6px; border:1px solid #333; text-align:center;";
                        tdPunti.innerText = u.punteggioTotale || 0;
                        
                        const tdElo = document.createElement('td');
                        tdElo.style = "padding:6px; border:1px solid #333; text-align:center; color:#00ff00;";
                        tdElo.innerText = elo;
                        
                        const tdGiocate = document.createElement('td');
                        tdGiocate.style = "padding:6px; border:1px solid #333; text-align:center;";
                        tdGiocate.innerText = u.partiteGiocate || 0;
                        
                        const tdVinte = document.createElement('td');
                        tdVinte.style = "padding:6px; border:1px solid #333; text-align:center;";
                        tdVinte.innerText = u.partiteVinte || 0;
                        
                        const tdData = document.createElement('td');
                        tdData.style = "padding:6px; border:1px solid #333; text-align:center; font-size:0.8em;";
                        tdData.innerText = lastDate;

                        const tdAzioni = document.createElement('td');
                        tdAzioni.style = "padding:6px; border:1px solid #333; text-align:center;";
                        const btnEdit = document.createElement('button');
                        btnEdit.className = 'btn';
                        btnEdit.style = "margin:0; padding:4px 8px; font-size:0.8em; border-color:#f1c40f; color:#f1c40f;";
                        btnEdit.innerText = "✏️ Modifica";
                        btnEdit.onclick = () => apriDettaglioUtente(u);
                        tdAzioni.appendChild(btnEdit);
                        
                        tr.appendChild(tdNick);
                        tr.appendChild(tdStemmi);
                        tr.appendChild(tdPunti);
                        tr.appendChild(tdElo);
                        tr.appendChild(tdGiocate);
                        tr.appendChild(tdVinte);
                        tr.appendChild(tdData);
                        tr.appendChild(tdAzioni);
                        
                        tbody.appendChild(tr);
                    });
                }

                async function cercaReplaysAdmin() {
                    const search = document.getElementById('admin-replay-search').value.trim();
                    const container = document.getElementById('admin-replays-list');
                    container.innerHTML = '<p style="text-align:center; color:#00ff00;">🔍 Ricerca in corso...</p>';

                    try {
                        const res = await fetch(\`/api/admin/replays?search=\${encodeURIComponent(search)}\`);
                        if (res.status === 401) return location.reload();
                        const data = await res.json();

                        if (data.success && data.replays.length > 0) {
                            container.innerHTML = data.replays.map(r => {
                                const statusHtml = !r.isCompleted ? ' | <span style="color:#ff4d4d;">INTERROTTA</span>' : '';
                                return \`
                                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding:10px 0;">
                                    <div>
                                        <div style="color:#f1c40f; font-weight:bold;">\${r.hostNickname} • \${new Date(r.timestamp).toLocaleString()}</div>
                                        <div style="font-size:0.8em; color:#888;">
                                             👥 \${r.numPlayers} Players (\${r.humanPlayers.join(', ')})
                                            \${statusHtml}
                                        </div>
                                    </div>
                                    <button class="btn" onclick="window.open('/?replay=\${r._id}', '_blank')" style="padding:5px 10px; font-size:0.8em;">🎬 GUARDA</button>
                                </div>
                                \`;
                            }).join('');
                        } else {
                            container.innerHTML = '<p style="text-align:center; color:#888;">Nessun replay trovato.</p>';
                        }
                    } catch(e) { container.innerHTML = '<p style="text-align:center; color:#ff0000;">Errore nella ricerca.</p>'; }
                }

                async function caricaTuttiUtenti() {
                    try {
                        const res = await fetch('/api/admin/all-users');
                        if (res.status === 401) {
                            alert("Sessione scaduta! Ricarica la pagina.");
                            return location.reload();
                        }
                        const data = await res.json();
                        if (!data.success) return alert("Errore: " + data.error);

                        renderListaUtenti(data.users);
                    } catch (err) {
                        alert("Errore di connessione al server: " + err.message);
                    }
                }

                function setSearch(code) {
                    document.getElementById('user-query').value = code;
                    cercaUtente();
                }

                // Inizializza dropdown stemmi
                popolaSelectStemmi();
            </script>
        </body>
        </html>
        `;
        res.send(html);
    } catch (e) {
        res.status(500).send("Errore nel recupero delle statistiche.");
    }
});

// ROTTA PER ELIMINARE I REPORT
app.post('/elimina-report-777', authAdmin, express.json(), async (req, res) => {
    try {
        if (!dbConnected) return res.json({ ok: false, msg: "DB non connesso" });
        const { id } = req.body;
        await Report.findByIdAndDelete(id);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false });
    }
});



const SEMI = ["Coppe", "Denari", "Bastoni", "Spade"];
const VALORI = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];
const PESO_SEME = { "Denari": 400, "Ori": 400, "Spade": 300, "Coppe": 200, "Bastoni": 100 };
const PESO_VALORE = { "Asso": 12, "3": 11, "Re": 10, "Cavallo": 9, "Fante": 8, "7": 7, "6": 6, "5": 5, "4": 4, "2": 3 };

class Card {
    constructor(valore, seme) {
        this.valore = valore;
        this.seme = seme;
        this.forza = PESO_SEME[seme] + PESO_VALORE[valore];
        this.giocata = false;
    }
}

class Player {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.eloMomentaneo = 1000; // Valore predefinito, sovrascritto al login/join
        if (!isHuman) {
            const level = Math.floor(Math.random() * 4) + 1;
            const agg = Math.floor(Math.random() * 101);
            const cons = Math.floor(Math.random() * 101);
            const sca = Math.floor(Math.random() * 101);
            this.aiLevel = level;
            this.aiParams = { agg, cons, sca };
            this.aiVariant = `V${level}_A${agg}_C${cons}_S${sca}`;
        } else {
            this.aiVariant = "Human";
        }
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.punti = 0;
        this.dichiarazione = "-";
        this.preseFatte = 0;
        this.voidSuits = []; // Semi che il giocatore ha terminato (scoperti durante il gioco)
        this.dichiarazioniAzzeccate = 0;
    }
    resetGiro() {
        this.mano = [];
        this.dichiarazione = "-";
        this.preseFatte = 0;
        this.voidSuits = [];
    }
}

class LucasGame {
    constructor(numPlayers) {
        this.players = Array.from({ length: numPlayers }, (_, i) => new Player(i, `CPU ${i}`));
        this.numPlayers = numPlayers;
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.maxCarte = Math.floor(40 / numPlayers);
        this.indiceGiro = 0;
        this.tavolo = [];
        this.fase = "scommesse";
        this.sommaScommesse = 0;
        this.acceptInput = true;
        this.carteUscite = []; // MEMORIA: tiene traccia di tutte le carte giocate nel giro attuale
        this.botThinking = false; // FLAG di sicurezza per evitare IA multiple concorrenti

        let seq = [];
        for (let i = 2; i <= this.maxCarte; i++) seq.push(i);
        for (let i = this.maxCarte - 1; i >= 2; i--) seq.push(i);
        seq.push(1); // Mano finale a 1 (Fronte)
        this.sequenzaTurni = seq;
        this.turnoAttuale = (this.indiceMazziere + 1) % numPlayers;
    }

    distribuisci() {
        let mazzo = [];
        SEMI.forEach(s => VALORI.forEach(v => mazzo.push(new Card(v, s))));
        // Shuffle migliorato (Fisher-Yates)
        for (let i = mazzo.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mazzo[i], mazzo[j]] = [mazzo[j], mazzo[i]];
        }

        let qta = this.sequenzaTurni[this.indiceGiro];
        this.players.forEach(p => {
            p.resetGiro();
            for (let i = 0; i < qta; i++) {
                const c = mazzo.pop();
                if (c) p.mano.push(c);
            }
        });
        this.fase = "scommesse";
        this.turnoAttuale = (this.indiceMazziere + 1) % this.players.length;
        this.sommaScommesse = 0;
        this.tavolo = [];
        this.carteUscite = []; // Reset memoria a ogni nuova distribuzione
    }

    calcolaVincitorePresa() {
        return this.tavolo.reduce((migliore, attuale) => {
            // Poiché la "forza" include già il peso assoluto del seme (es. Denari > Spade > Coppe > Bastoni)
            // e del valore della carta, vince semplicemente la carta con la forza maggiore.
            return (attuale.card.forza > migliore.card.forza) ? attuale : migliore;
        });
    }
}

// =============================================
// CIAPANÒ (TRAVERSONE) - LOGICA DI GIOCO
// =============================================

const PESO_VALORE_CIAPANO = { "3": 10, "2": 9, "Asso": 8, "Re": 7, "Cavallo": 6, "Fante": 5, "7": 4, "6": 3, "5": 2, "4": 1 };

function puntiCartaCiapano(valore) {
    if (valore === 'Asso') return 3; // 1 punto = 3 terzi
    if (['3', '2', 'Re', 'Cavallo', 'Fante'].includes(valore)) return 1; // 1/3 punto = 1 terzo
    return 0; // 7, 6, 5, 4 = 0 punti
}

function formattaPuntiCiapano(punti) {
    return `${punti}`;
}

function puntiCiapanoNumerico(punti) {
    return punti;
}

function calcolaDistrCiapano(numPlayers) {
    switch (numPlayers) {
        case 2: return { cartePerGiocatore: 20, scartiRegola: 'nessuno' };
        case 3: return { cartePerGiocatore: 13, scartiRegola: 'un_4' };
        case 4: return { cartePerGiocatore: 10, scartiRegola: 'nessuno' };
        case 5: return { cartePerGiocatore: 8, scartiRegola: 'nessuno' };
        case 6: return { cartePerGiocatore: 6, scartiRegola: 'tutti_4' };
        case 7: return { cartePerGiocatore: 5, scartiRegola: 'tutti_4_un_5' };
        case 8: return { cartePerGiocatore: 5, scartiRegola: 'nessuno' };
        default: return { cartePerGiocatore: 10, scartiRegola: 'nessuno' };
    }
}

class CiapanoPlayer {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.preseFatte = []; // carte prese (array piatto di carte)
        this.puntiSmazzata = 0; // Punti interi arrotondati per difetto
        this.puntiTotali = 0;   // Punti interi totali cumulati
        this.eloMomentaneo = 1000;
        this.eliminato = false;
        this.aiLevel = 0;
        this.aiVariant = "Human";
    }
    resetSmazzata() {
        this.mano = [];
        this.preseFatte = [];
        this.puntiSmazzata = 0;
    }
    contaPuntiPrese() {
        let terzi = 0;
        this.preseFatte.forEach(carta => {
            terzi += puntiCartaCiapano(carta.valore);
        });
        return terzi;
    }
}

class CiapanoGame {
    constructor(numPlayers, limitePunti = 31) {
        this.numPlayers = numPlayers;
        this.players = Array.from({ length: numPlayers }, (_, i) => new CiapanoPlayer(i, `CPU ${i}`));
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.turnoAttuale = 0;
        this.tavolo = [];
        this.fase = "gioco"; // gioco | sola_choice | fine_smazzata
        this.carteScartate = [];
        this.limitePunti = limitePunti;
        this.smazzataNum = 1;
        this.ultimoPresista = -1; // indice giocatore che ha preso l'ultima mano
        this.acceptInput = true;
        this.botThinking = false;
        this.matchId = null;
        this.hostNickname = null;
        this.carteUscite = [];
    }

    getGiocatoriAttivi() {
        return this.players.filter(p => !p.eliminato);
    }

    prossimoGiocatoreAttivo(idx) {
        let count = 0;
        while (this.players[idx].eliminato && count < this.numPlayers) {
            idx = (idx + 1) % this.numPlayers;
            count++;
        }
        return idx;
    }

    numGiocatoriAttivi() {
        return this.players.filter(p => !p.eliminato).length;
    }

    numGiocatoriInPresa() {
        // Numero di giocatori attivi che partecipano alla presa corrente
        return this.getGiocatoriAttivi().length;
    }

    distribuisci() {
        let mazzo = [];
        SEMI.forEach(s => VALORI.forEach(v => mazzo.push({ valore: v, seme: s, giocata: false })));

        const numAttivi = this.numGiocatoriAttivi();
        const distr = calcolaDistrCiapano(numAttivi);

        this.carteScartate = [];

        if (distr.scartiRegola === 'un_4') {
            const idx = mazzo.findIndex(c => c.valore === '4');
            if (idx !== -1) this.carteScartate.push(mazzo.splice(idx, 1)[0]);
        } else if (distr.scartiRegola === 'tutti_4') {
            const nuovoMazzo = [];
            mazzo.forEach(c => {
                if (c.valore === '4') this.carteScartate.push(c);
                else nuovoMazzo.push(c);
            });
            mazzo = nuovoMazzo;
        } else if (distr.scartiRegola === 'tutti_4_un_5') {
            const nuovoMazzo = [];
            mazzo.forEach(c => {
                if (c.valore === '4') this.carteScartate.push(c);
                else nuovoMazzo.push(c);
            });
            mazzo = nuovoMazzo;
            const idx5 = mazzo.findIndex(c => c.valore === '5');
            if (idx5 !== -1) this.carteScartate.push(mazzo.splice(idx5, 1)[0]);
        }

        // Fisher-Yates Shuffle
        for (let i = mazzo.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mazzo[i], mazzo[j]] = [mazzo[j], mazzo[i]];
        }

        // Distribuzione equa solo ai giocatori attivi
        this.players.forEach(p => {
            p.resetSmazzata();
            if (!p.eliminato) {
                for (let i = 0; i < distr.cartePerGiocatore; i++) {
                    const c = mazzo.pop();
                    if (c) p.mano.push(c);
                }
            }
        });

        this.fase = "gioco";
        this.turnoAttuale = this.prossimoGiocatoreAttivo((this.indiceMazziere + 1) % this.numPlayers);
        this.tavolo = [];
        this.ultimoPresista = -1;
        this.carteUscite = [];
    }

    calcolaVincitorePresa() {
        if (this.tavolo.length === 0) return null;
        const semeUscita = this.tavolo[0].card.seme;
        // Vince la carta più alta del SEME DI USCITA (no briscola in Ciapanò)
        const carteDelSeme = this.tavolo.filter(g => g.card.seme === semeUscita);
        return carteDelSeme.reduce((migliore, attuale) => {
            return (PESO_VALORE_CIAPANO[attuale.card.valore] > PESO_VALORE_CIAPANO[migliore.card.valore]) ? attuale : migliore;
        });
    }

    puoGiocareCarta(playerId, carta) {
        if (this.tavolo.length === 0) return true;
        const semeUscita = this.tavolo[0].card.seme;
        const player = this.players[playerId];
        const haSeme = player.mano.some(c => !c.giocata && c.seme === semeUscita);
        if (haSeme) {
            return carta.seme === semeUscita;
        }
        return true;
    }

    carteGiocabili(playerId) {
        const player = this.players[playerId];
        const nonGiocate = player.mano.filter(c => !c.giocata);
        if (this.tavolo.length === 0) return nonGiocate;
        const semeUscita = this.tavolo[0].card.seme;
        const delSeme = nonGiocate.filter(c => c.seme === semeUscita);
        return delSeme.length > 0 ? delSeme : nonGiocate;
    }

    calcolaFineSmazzata() {
        const attivi = this.getGiocatoriAttivi();
        let sommaAltri = 0;
        attivi.forEach(p => {
            if (p.id !== this.ultimoPresista) {
                // Il punteggio delle prese va arrotondato per difetto (3 terzi = 1 punto)
                const terzi = p.contaPuntiPrese();
                p.puntiSmazzata = Math.floor(terzi / 3);
                sommaAltri += p.puntiSmazzata;
            }
        });

        const ultPresistaPlayer = this.players[this.ultimoPresista];
        if (ultPresistaPlayer) {
            // Chi ha preso l'ultima mano prende 11 - i punti degli altri
            ultPresistaPlayer.puntiSmazzata = Math.max(0, 11 - sommaAltri);
        }

        // Verifica Cappotto: un giocatore ha preso tutti gli 11 punti
        const cappottoPlayer = attivi.find(p => p.puntiSmazzata === 11);
        if (cappottoPlayer) {
            return { isCappotto: true, cappottoPlayerId: cappottoPlayer.id };
        }
        return { isCappotto: false, cappottoPlayerId: -1 };
    }

    applicaPunteggi(isCappotto = false, cappottoPlayerId = -1) {
        const attivi = this.getGiocatoriAttivi();
        if (isCappotto && cappottoPlayerId !== -1) {
            attivi.forEach(p => {
                if (p.id === cappottoPlayerId) {
                    p.puntiSmazzata = 0; // Chi ha preso tutti i punti ha +0
                } else {
                    p.puntiSmazzata = 11; // Tutti gli altri hanno +11
                    p.puntiTotali += 11;
                }
            });
        } else {
            attivi.forEach(p => {
                p.puntiTotali += p.puntiSmazzata;
            });
        }

        // Gestione eliminazioni (punti interi >= limitePunti)
        attivi.forEach(p => {
            if (p.puntiTotali >= this.limitePunti) {
                p.eliminato = true;
            }
        });

        const attiviRimasti = this.getGiocatoriAttivi();
        const gameOver = attiviRimasti.length <= 1;
        return { gameOver, attiviRimasti };
    }
}


// --- NUOVO: Funzioni per Persistenza ---
async function salvaStatoMatch(code) {
    if (!dbConnected) return;
    try {
        const lobby = lobbies[code];
        if (!lobby) {
            await MatchState.deleteOne({ roomCode: code });
            return;
        }

        const data = {
            roomCode: code,
            host: lobby.host,
            parametri: lobby.parametri,
            giocatori: lobby.giocatori,
            gameInstance: lobby.gameInstance,
            timestamp: new Date()
        };

        await MatchState.findOneAndUpdate({ roomCode: code }, data, { upsert: true });
    } catch (e) {
        console.error("Errore salvataggio stato match:", e);
    }
}

async function caricaStatiMatch() {
    if (!dbConnected) return;
    try {
        const states = await MatchState.find();
        if (states.length === 0) return;
        
        console.log(`📂 Ripristino ${states.length} match dal database...`);
        for (const state of states) {
            const lobby = {
                host: state.host,
                parametri: state.parametri,
                giocatori: state.giocatori
            };
            
            if (state.gameInstance) {
                const g = state.gameInstance;
                const game = new LucasGame(g.numPlayers);
                
                // Copia tutte le proprietà
                Object.assign(game, g);
                
                // Re-instanzia i Player
                game.players = g.players.map(pData => {
                    const p = new Player(pData.id, pData.nome, pData.isHuman, pData.token, pData.uniqueCode);
                    Object.assign(p, pData);
                    // Normalizzazione seme da Ori a Denari
                    if (p.mano) {
                        p.mano.forEach(c => {
                            if (c.seme === 'Ori') c.seme = 'Denari';
                        });
                    }
                    return p;
                });
                
                // Normalizzazione carte sul tavolo
                if (game.tavolo) {
                    game.tavolo.forEach(gt => {
                        if (gt.card && gt.card.seme === 'Ori') gt.card.seme = 'Denari';
                    });
                }
                
                // Normalizzazione carte uscite
                if (game.carteUscite) {
                    game.carteUscite.forEach(c => {
                        if (c.seme === 'Ori') c.seme = 'Denari';
                    });
                }
                
                lobby.gameInstance = game;
            }
            
            lobbies[state.roomCode] = lobby;
        }
    } catch (e) {
        console.error("Errore durante il ripristino dei match:", e);
    }
}

let top3Cached = [];
async function aggiornaTop3Cache() {
    if (!dbConnected) return;
    try {
        const top3 = await User.find().sort({ punteggioTotale: -1 }).limit(3);
        top3Cached = top3.map(u => ({ uniqueCode: u.uniqueCode, nickname: u.nickname }));
    } catch (e) {
        console.error("Errore aggiornamento top3 cache:", e);
    }
}
// Aggiorna ogni 30 secondi
setInterval(aggiornaTop3Cache, 30000);
// Esegui anche all'avvio dopo 5 secondi
setTimeout(aggiornaTop3Cache, 5000);

function ottieniStemma(uniqueCode, nome) {
    let stemmi = [];
    const upperName = nome ? nome.trim().toUpperCase() : "";

    // 1. Recupera stemmi salvati dal database/cache
    let customStemmi = null;
    if (uniqueCode && userStemmiMap.has(uniqueCode)) {
        customStemmi = userStemmiMap.get(uniqueCode);
    } else if (upperName && userStemmiByName.has(upperName)) {
        customStemmi = userStemmiByName.get(upperName);
    }

    if (customStemmi && Array.isArray(customStemmi)) {
        customStemmi.forEach(s => {
            if (s && !stemmi.includes(s)) stemmi.push(s);
        });
    }

    // Fallback storico solo se la cache è vuota (es. prima della connessione DB)
    if (userStemmiMap.size === 0) {
        if (upperName === "LUCA" && !stemmi.includes("admin")) stemmi.push("admin");
        if (upperName === "IDF" && !stemmi.includes("idf")) stemmi.push("idf");
        if (upperName === "CRAZY" && !stemmi.includes("aquila")) stemmi.push("aquila");
    }

    // 2. Classifica Top 3 (Oro, Argento, Bronzo) dinamica
    if (dbConnected && top3Cached && top3Cached.length > 0) {
        const idx = top3Cached.findIndex(u => (uniqueCode && u.uniqueCode === uniqueCode) || (upperName && u.nickname && u.nickname.trim().toUpperCase() === upperName));
        if (idx === 0 && !stemmi.includes("oro")) stemmi.push("oro");
        else if (idx === 1 && !stemmi.includes("argento")) stemmi.push("argento");
        else if (idx === 2 && !stemmi.includes("bronzo")) stemmi.push("bronzo");
    }

    return stemmi.length > 0 ? stemmi.join(",") : null;
}

function inviaAggiornamentoLobby(code) {
    const lobby = lobbies[code];
    if (!lobby) return;
    const giocatoriConStemma = lobby.giocatori.map(g => ({
        ...g,
        stemma: ottieniStemma(g.uniqueCode, g.nome)
    }));
    io.to(code).emit('aggiorna_lobby', {
        giocatori: giocatoriConStemma,
        code: code,
        host: lobby.host,
        pubblica: lobby.pubblica || false,
        gameType: lobby.parametri?.gameType || 'lucas',
        limitePunti: lobby.parametri?.limitePunti || 31
    });
}

function ottieniListaLobbyPubbliche() {
    const publicLobbies = [];
    for (const code in lobbies) {
        const l = lobbies[code];
        if (l.pubblica && !l.gameInstance && l.giocatori.length > 0) {
            const hostPlayer = l.giocatori.find(p => p.id === l.host);
            const hostName = hostPlayer ? hostPlayer.nome : "Sconosciuto";
            publicLobbies.push({
                code: code,
                hostName: hostName,
                stemma: hostPlayer ? ottieniStemma(hostPlayer.uniqueCode, hostPlayer.nome) : null,
                playersCount: l.giocatori.length,
                maxPlayers: parseInt(l.parametri?.numGiocatori || 4),
                gameType: l.parametri?.gameType || 'lucas',
                scopaVariante: l.parametri?.scopaVariante || null
            });
        }
    }
    return publicLobbies;
}

function inviaLobbyPubblicheTutti() {
    io.emit('lista_lobby_pubbliche', ottieniListaLobbyPubbliche());
}

let umaniConnessi = 0;
let osservatoriAdmin = 0;
let isSimulando = false;
let turboEnabled = false; // Interruttore Maestro AI
const lobbies = {};
const turnTimers = {};
const voiceRooms = {};


io.on('connection', (socket) => {
    umaniConnessi++;

    // Identificazione immediata tramite query handshake
    if (socket.handshake.query && socket.handshake.query.role === 'admin') {
        socket.isAdminObs = true;
        osservatoriAdmin++;
        console.log(`📡 Admin connesso. (Tot: ${umaniConnessi}, Admin: ${osservatoriAdmin})`);
    }

    socket.on('login', async (dati) => {
        // Controllo profanità universale e aggressivo
        if (dati.nickname) {
            // Rimuove spazi, punti e simboli per vedere se l'utente sta barando (es: "d.i.o c.a.n.e" diventa "diocane")
            const normalizedNickname = dati.nickname.toLowerCase().replace(/[^a-z0-9]/gi, '');

            if (filter.check(dati.nickname) || filter.check(normalizedNickname)) {
                return socket.emit('login_err', 'Per favore, usa un nickname rispettoso!');
            }

            // --- NUOVO CONTROLLO IA (GEMINI) ---
            const isToxic = await checkWithAI(dati.nickname);
            if (isToxic) {
                return socket.emit('login_err', 'L\'IA ha rilevato un nickname non appropriato.');
            }

            // --- NUOVO CONTROLLO BAN ---
            if (dbConnected) {
                const escapedNickname = dati.nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const isBanned = await BannedUser.findOne({ nickname: { $regex: new RegExp("^" + escapedNickname + "$", "i") } });
                if (isBanned) {
                    return socket.emit('login_err', 'Spiacenti, questo nickname è stato bannato dal sistema.');
                }
            }
        }

        if (!dbConnected) {
            // Modalità simulata in assenza di DB
            socket.userUniqueCode = dati.uniqueCode;
            return socket.emit('login_ok', { uniqueCode: dati.uniqueCode, nickname: dati.nickname || "Player", partiteVinte: 0, punteggioTotale: 0 });
        }

        // --- SKIPA IL DB PER GLI OSPITI ---
        if (dati.uniqueCode && dati.uniqueCode.startsWith("GUEST_")) {
            socket.userUniqueCode = dati.uniqueCode;
            socket.userNickname = dati.nickname;
            return socket.emit('login_ok', { uniqueCode: dati.uniqueCode, nickname: dati.nickname, partiteVinte: 0, punteggioTotale: 0 });
        }

        try {
            let user = await User.findOne({ uniqueCode: dati.uniqueCode });
            if (!user) {
                // Check per evitare nickname duplicati (case insensitive) e proteggere i nomi originali
                if (!dati.nickname) return socket.emit('login_err', 'Nickname mancante.');

                // Blocco specifico per impedire la registrazione di "Lucas" (riservato al creatore)
                if (dati.nickname.toLowerCase() === 'lucas') {
                    return socket.emit('login_err', "Non puoi usare questo username: è un nome di sistema riservato!");
                }

                // Ricerca case-insensitive per impedire varianti (es: Lùca, lUcA, luca son considerati uguali dal Regex base inglese,
                // e blocca chi tenta di rubare un nome esistente con un PIN sbagliato o una maiuscola diversa)
                // Usiamo l'escape per evitare crash se il nickname contiene caratteri speciali regex (es. "(", "[")
                const escapedNickname = dati.nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const existingName = await User.findOne({ nickname: { $regex: new RegExp("^" + escapedNickname + "$", "i") } });
                if (existingName) {
                    return socket.emit('login_err', 'Non puoi usare questo username / Hai sbagliato il PIN.');
                }

                user = new User({ uniqueCode: dati.uniqueCode, nickname: dati.nickname });
                await user.save();
            } else {
                // Aggiorna l'ultimo accesso se l'utente esiste già
                user.lastLogin = new Date();
                await user.save();
            }
            socket.userUniqueCode = user.uniqueCode;
            socket.userNickname = user.nickname;
            socket.userElo = user.elo || 1000;
            socket.userEloCiapano = user.eloCiapano || 1000;
            socket.userEloScopa = user.eloScopa || 1000;
            socket.userEloRubamazzetto = user.eloRubamazzetto || 1000;
            socket.userEloBriscola = user.eloBriscola || 1000;
            socket.userEloTressette = user.eloTressette || 1000;
            const userPayload = user.toObject ? user.toObject() : { ...user };
            userPayload.stemma = ottieniStemma(user.uniqueCode, user.nickname);
            socket.emit('login_ok', userPayload);
        } catch (e) {
            socket.emit('login_err', 'Errore DB: ' + e.message);
        }
    });

    // --- PULIZIA ACCOUNT INATTIVI (1 ANNO) ---
    async function cleanupInactiveAccounts() {
        if (!dbConnected) return;
        try {
            // Per gli account già esistenti senza il campo lastLogin, lo impostiamo a oggi (retroattività)
            // Così verranno cancellati tra 1 anno esatto da oggi se non rientrano.
            await User.updateMany(
                { lastLogin: { $exists: false } },
                { $set: { lastLogin: new Date() } }
            );

            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

            const result = await User.deleteMany({
                lastLogin: { $lt: oneYearAgo }
            });

            if (result.deletedCount > 0) {
                console.log(`🧹 Pulizia database: rimossi ${result.deletedCount} account inattivi da oltre 1 anno.`);
            }
        } catch (e) {
            console.error("❌ Errore durante la pulizia degli account:", e);
        }
    }

    // Esegui la pulizia all'avvio e poi ogni 24 ore
    setTimeout(cleanupInactiveAccounts, 5000); // 5 secondi dopo il boot
    setInterval(cleanupInactiveAccounts, 24 * 60 * 60 * 1000); // Ogni 24 ore

    socket.on('richiedi_classifica', async () => {
        if (!dbConnected) return socket.emit('classifica_dati', { top10: [], userRank: null });
        try {
            let top10 = await User.find().sort({ punteggioTotale: -1 }).limit(10);
            const top10ConStemma = top10.map(u => {
                const uObj = u.toObject ? u.toObject() : { ...u };
                uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
                return uObj;
            });

            let userRank = null;
            if (socket.userUniqueCode) {
                const user = await User.findOne({ uniqueCode: socket.userUniqueCode });
                if (user) {
                    // Verifichiamo se l'utente è già nei primi 10 per ID unico
                    const isInTop10 = top10.some(u => u.uniqueCode === socket.userUniqueCode);
                    if (!isInTop10) {
                        // Conta quanti utenti hanno un punteggio superiore
                        const count = await User.countDocuments({ punteggioTotale: { $gt: user.punteggioTotale } });
                        userRank = {
                            nickname: user.nickname,
                            punteggioTotale: user.punteggioTotale,
                            partiteVinte: user.partiteVinte,
                            posizione: count + 1,
                            stemma: ottieniStemma(user.uniqueCode, user.nickname)
                        };
                    }
                }
            }
            socket.emit('classifica_dati', { top10: top10ConStemma, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica:", e);
        }
    });

    socket.on('richiedi_classifica_ciapano', async () => {
        if (!dbConnected) return socket.emit('classifica_dati_ciapano', { top10: [], userRank: null });
        try {
            let top10 = await User.find().sort({ eloCiapano: -1 }).limit(10);
            const top10ConStemma = top10.map(u => {
                const uObj = u.toObject ? u.toObject() : { ...u };
                uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
                return uObj;
            });

            let userRank = null;
            if (socket.userUniqueCode) {
                const user = await User.findOne({ uniqueCode: socket.userUniqueCode });
                if (user) {
                    const isInTop10 = top10.some(u => u.uniqueCode === socket.userUniqueCode);
                    if (!isInTop10) {
                        const count = await User.countDocuments({ eloCiapano: { $gt: user.eloCiapano || 1000 } });
                        userRank = {
                            nickname: user.nickname,
                            eloCiapano: user.eloCiapano || 1000,
                            posizione: count + 1,
                            stemma: ottieniStemma(user.uniqueCode, user.nickname)
                        };
                    }
                }
            }
            socket.emit('classifica_dati_ciapano', { top10: top10ConStemma, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica_ciapano:", e);
        }
    });

    socket.on('richiedi_classifica_scopa', async () => {
        if (!dbConnected) return socket.emit('classifica_dati_scopa', { top10: [], userRank: null });
        try {
            let top10 = await User.find().sort({ eloScopa: -1 }).limit(10);
            const top10ConStemma = top10.map(u => {
                const uObj = u.toObject ? u.toObject() : { ...u };
                uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
                return uObj;
            });

            let userRank = null;
            if (socket.userUniqueCode) {
                const user = await User.findOne({ uniqueCode: socket.userUniqueCode });
                if (user) {
                    const isInTop10 = top10.some(u => u.uniqueCode === socket.userUniqueCode);
                    if (!isInTop10) {
                        const count = await User.countDocuments({ eloScopa: { $gt: user.eloScopa || 1000 } });
                        userRank = {
                            nickname: user.nickname,
                            eloScopa: user.eloScopa || 1000,
                            posizione: count + 1,
                            stemma: ottieniStemma(user.uniqueCode, user.nickname)
                        };
                    }
                }
            }
            socket.emit('classifica_dati_scopa', { top10: top10ConStemma, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica_scopa:", e);
        }
    });

    socket.on('richiedi_classifica_rubamazzetto', async () => {
        if (!dbConnected) return socket.emit('classifica_dati_rubamazzetto', { top10: [], userRank: null });
        try {
            let top10 = await User.find().sort({ eloRubamazzetto: -1 }).limit(10);
            const top10ConStemma = top10.map(u => {
                const uObj = u.toObject ? u.toObject() : { ...u };
                uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
                return uObj;
            });

            let userRank = null;
            if (socket.userUniqueCode) {
                const user = await User.findOne({ uniqueCode: socket.userUniqueCode });
                if (user) {
                    const isInTop10 = top10.some(u => u.uniqueCode === socket.userUniqueCode);
                    if (!isInTop10) {
                        const count = await User.countDocuments({ eloRubamazzetto: { $gt: user.eloRubamazzetto || 1000 } });
                        userRank = {
                            nickname: user.nickname,
                            eloRubamazzetto: user.eloRubamazzetto || 1000,
                            posizione: count + 1,
                            stemma: ottieniStemma(user.uniqueCode, user.nickname)
                        };
                    }
                }
            }
            socket.emit('classifica_dati_rubamazzetto', { top10: top10ConStemma, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica_rubamazzetto:", e);
        }
    });

    socket.on('richiedi_classifica_briscola', async () => {
        if (!dbConnected) return socket.emit('classifica_dati_briscola', { top10: [], userRank: null });
        try {
            let top10 = await User.find().sort({ eloBriscola: -1 }).limit(10);
            const top10ConStemma = top10.map(u => {
                const uObj = u.toObject ? u.toObject() : { ...u };
                uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
                return uObj;
            });

            let userRank = null;
            if (socket.userUniqueCode) {
                const user = await User.findOne({ uniqueCode: socket.userUniqueCode });
                if (user) {
                    const isInTop10 = top10.some(u => u.uniqueCode === socket.userUniqueCode);
                    if (!isInTop10) {
                        const count = await User.countDocuments({ eloBriscola: { $gt: user.eloBriscola || 1000 } });
                        userRank = {
                            nickname: user.nickname,
                            eloBriscola: user.eloBriscola || 1000,
                            posizione: count + 1,
                            stemma: ottieniStemma(user.uniqueCode, user.nickname)
                        };
                    }
                }
            }
            socket.emit('classifica_dati_briscola', { top10: top10ConStemma, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica_briscola:", e);
        }
    });

    socket.on('richiedi_classifica_tressette', async () => {
        if (!dbConnected) return socket.emit('classifica_dati_tressette', { top10: [], userRank: null });
        try {
            let top10 = await User.find().sort({ eloTressette: -1 }).limit(10);
            const top10ConStemma = top10.map(u => {
                const uObj = u.toObject ? u.toObject() : { ...u };
                uObj.stemma = ottieniStemma(u.uniqueCode, u.nickname);
                return uObj;
            });

            let userRank = null;
            if (socket.userUniqueCode) {
                const user = await User.findOne({ uniqueCode: socket.userUniqueCode });
                if (user) {
                    const isInTop10 = top10.some(u => u.uniqueCode === socket.userUniqueCode);
                    if (!isInTop10) {
                        const count = await User.countDocuments({ eloTressette: { $gt: user.eloTressette || 1000 } });
                        userRank = {
                            nickname: user.nickname,
                            eloTressette: user.eloTressette || 1000,
                            posizione: count + 1,
                            stemma: ottieniStemma(user.uniqueCode, user.nickname)
                        };
                    }
                }
            }
            socket.emit('classifica_dati_tressette', { top10: top10ConStemma, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica_tressette:", e);
        }
    });

    socket.on('crea_lobby', (dati) => {
        try {
            if (!dati || !dati.nome) return socket.emit('errore', "Dati lobby non validi.");
            let code;
            do {
                code = Math.random().toString(36).substring(2, 6).toUpperCase();
            } while (lobbies[code]);

            const gameType = dati.gameType || 'lucas';
            let eloValue = socket.userElo || 1000;
            if (gameType === 'ciapano') eloValue = socket.userEloCiapano || 1000;
            else if (gameType === 'scopa') eloValue = socket.userEloScopa || 1000;
            else if (gameType === 'rubamazzetto') eloValue = socket.userEloRubamazzetto || 1000;
            else if (gameType === 'briscola') eloValue = socket.userEloBriscola || 1000;
            else if (gameType === 'tressette') eloValue = socket.userEloTressette || 1000;

            lobbies[code] = {
                host: socket.id,
                parametri: dati,
                giocatori: [{
                    id: socket.id,
                    nome: dati.nome,
                    token: dati.token,
                    uniqueCode: dati.uniqueCode,
                    elo: eloValue,
                    eloCiapano: socket.userEloCiapano || 1000,
                    eloScopa: socket.userEloScopa || 1000,
                    eloRubamazzetto: socket.userEloRubamazzetto || 1000,
                    eloBriscola: socket.userEloBriscola || 1000,
                    eloTressette: socket.userEloTressette || 1000,
                    isHuman: true
                }]
            };
            socket.userNickname = dati.nome;
            socket.userUniqueCode = dati.uniqueCode;
            socket.join(code);
            socket.roomCode = code;
            const giocatoriConStemma = lobbies[code].giocatori.map(g => ({
                ...g,
                stemma: ottieniStemma(g.uniqueCode, g.nome)
            }));
            socket.emit('lobby_creata', {
                code: code,
                giocatori: giocatoriConStemma,
                host: lobbies[code].host,
                pubblica: false,
                gameType: gameType,
                limitePunti: dati.limitePunti || 31
            });
            salvaStatoMatch(code);
        } catch (e) {
            console.error("Errore crea_lobby:", e);
        }
    });

    socket.on('imposta_privacy', (dati) => {
        try {
            if (!dati || !dati.code) return;
            const lobby = lobbies[dati.code];
            if (lobby && lobby.host === socket.id) {
                lobby.pubblica = dati.pubblica;
                inviaAggiornamentoLobby(dati.code);
                inviaLobbyPubblicheTutti();
            }
        } catch (e) {
            console.error("Errore imposta_privacy:", e);
        }
    });

    socket.on('richiedi_lobby_pubbliche', () => {
        socket.emit('lista_lobby_pubbliche', ottieniListaLobbyPubbliche());
    });

    socket.on('torna_in_lobby', () => {
        try {
            const code = socket.roomCode;
            if (!code) return;
            const lobby = lobbies[code];
            if (lobby) {
                if (lobby.gameInstance) {
                    lobby.gameInstance = null;
                }
                inviaAggiornamentoLobby(code);
                inviaLobbyPubblicheTutti();
            }
        } catch (e) {
            console.error("Errore torna_in_lobby:", e);
        }
    });

    function gestisciRiconnessione(socket, code, token) {
        const lobby = lobbies[code];
        if (!lobby) return socket.emit('riconnessione_fallita');

        let foundLobbyPlayer = lobby.giocatori.find(p => p.token === token);
        if (!foundLobbyPlayer) return socket.emit('riconnessione_fallita');

        const wasHost = (foundLobbyPlayer.id === lobby.host);
        foundLobbyPlayer.id = socket.id;
        socket.userNickname = foundLobbyPlayer.nome;
        socket.userUniqueCode = foundLobbyPlayer.uniqueCode;
        if (foundLobbyPlayer.elo) {
            socket.userElo = foundLobbyPlayer.elo;
        }
        if (wasHost) {
            lobby.host = socket.id;
        }
        socket.join(code);
        socket.roomCode = code;

        if (lobby.gameInstance) {
            const game = lobby.gameInstance;
            const pIndex = game.players.findIndex(p => p.token === token);
            if (pIndex !== -1) {
                const p = game.players[pIndex];
                p.id = socket.id;
                p.isHuman = true;
                p.nome = p.nome.replace(" (Bot)", "");
            }
            inviaStato(code);
            gestisciIA(code); // FIX: Riprendi l'esecuzione del bot se è il suo turno
        } else {
            inviaAggiornamentoLobby(code);
        }
    }

    socket.on('riconnetti', (dati) => {
        gestisciRiconnessione(socket, dati.code, dati.token);
    });

    socket.on('unisciti_lobby', (dati) => {
        try {
            if (!dati || !dati.code) return socket.emit('errore', "Codice stanza mancante.");
            const roomCode = dati.code.trim().toUpperCase();
            const lobby = lobbies[roomCode] || lobbies[dati.code];
            const targetCode = lobbies[roomCode] ? roomCode : dati.code;
            if (lobby) {
                let existingPlayer = lobby.giocatori.find(p => p.token && p.token === dati.token);
                if (existingPlayer) {
                    return gestisciRiconnessione(socket, targetCode, dati.token);
                }

                if (lobby.giocatori.length >= parseInt(lobby.parametri.numGiocatori)) {
                    return socket.emit('errore', "La lobby è piena!");
                }
                if (lobby.giocatori.find(p => p.id === socket.id)) return;
                const gType = lobby.parametri?.gameType || 'lucas';
                let eloValue = socket.userElo || 1000;
                if (gType === 'ciapano') eloValue = socket.userEloCiapano || 1000;
                else if (gType === 'scopa') eloValue = socket.userEloScopa || 1000;
                else if (gType === 'rubamazzetto') eloValue = socket.userEloRubamazzetto || 1000;
                else if (gType === 'briscola') eloValue = socket.userEloBriscola || 1000;
                else if (gType === 'tressette') eloValue = socket.userEloTressette || 1000;

                lobby.giocatori.push({
                    id: socket.id,
                    nome: dati.nome,
                    token: dati.token,
                    uniqueCode: dati.uniqueCode,
                    elo: eloValue,
                    eloCiapano: socket.userEloCiapano || 1000,
                    eloScopa: socket.userEloScopa || 1000,
                    eloRubamazzetto: socket.userEloRubamazzetto || 1000,
                    eloBriscola: socket.userEloBriscola || 1000,
                    eloTressette: socket.userEloTressette || 1000,
                    isHuman: true
                });
                socket.userNickname = dati.nome;
                socket.userUniqueCode = dati.uniqueCode;
                socket.join(targetCode);
                socket.roomCode = targetCode;
                inviaAggiornamentoLobby(targetCode);
                salvaStatoMatch(targetCode);
                if (lobby.pubblica) {
                    inviaLobbyPubblicheTutti();
                }
            } else {
                socket.emit('errore', "Codice stanza non valido!");
            }
        } catch (e) {
            console.error("Errore unisciti_lobby:", e);
        }
    });

    socket.on('richiesta_inizio_partita', () => {
        try {
            const code = socket.roomCode;
            if (code) avviaPartita(code);
        } catch (e) {
            console.error("Errore richiesta_inizio_partita:", e);
        }
    });

    socket.on('esci_partita', () => {
        try {
            const code = socket.roomCode;
            if (!code) return;
            leaveVoice(socket, code);

            // --- FIX: Lasciamo la stanza subito per non ricevere l'aggiornamento di stato successivo ---
            socket.leave(code);
            socket.roomCode = null;

            const lobby = lobbies[code];
            if (lobby) {
                // Rimuovi dalla lobby (lista d'attesa) Test gits
                const idx = lobby.giocatori.findIndex(p => p.id === socket.id);
                const wasHost = (socket.id === lobby.host);
                if (idx !== -1) lobby.giocatori.splice(idx, 1);

                if (lobby.giocatori.length === 0) {
                    delete lobbies[code];
                    if (voiceRooms[code]) delete voiceRooms[code];
                    if (turnTimers[code]) {
                        clearTimeout(turnTimers[code]);
                        delete turnTimers[code];
                    }
                    if (dbConnected) {
                        MatchState.deleteOne({ roomCode: code }).catch(e => {});
                    }
                } else {
                    if (wasHost) {
                        lobby.host = lobby.giocatori[0].id;
                    }
                    inviaAggiornamentoLobby(code);
                    salvaStatoMatch(code);
                }
                inviaLobbyPubblicheTutti();

                // Gestione del subentro IA se il gioco è in corso
                if (lobby.gameInstance) {
                    const game = lobby.gameInstance;
                    const p = game.players.find(pl => pl.id === socket.id);
                    if (p) {
                        p.isHuman = false;
                        p.id = null; // Stacca il socketId
                        p.nome += " (Bot)";
                        if (game instanceof CiapanoGame) {
                            inviaStatoCiapano(code);
                            gestisciIA_Ciapano(code);
                            avviaTimerTurnoCiapano(code);
                        } else if (game instanceof ScopaGame) {
                            inviaStatoScopa(code);
                            gestisciIA_Scopa(code);
                            avviaTimerTurnoScopa(code);
                        } else if (game instanceof RubamazzettoGame) {
                            inviaStatoRubamazzetto(code);
                            gestisciIA_Rubamazzetto(code);
                            avviaTimerTurnoRubamazzetto(code);
                        } else if (game instanceof BriscolaGame) {
                            inviaStatoBriscola(code);
                            gestisciIA_Briscola(code);
                            avviaTimerTurnoBriscola(code);
                        } else if (game instanceof TressetteGame) {
                            inviaStatoTressette(code);
                            gestisciIA_Tressette(code);
                            avviaTimerTurnoTressette(code);
                        } else {
                            inviaStato(code);
                            gestisciIA(code);
                            avviaTimerTurno(code);
                        }
                    }
                } else {
                    // Se era ancora in lobby, aggiorna gli altri
                    inviaAggiornamentoLobby(code);
                }
                salvaStatoMatch(code);
            }
        } catch (e) {
            console.error("Errore esci_partita:", e);
        }
    });

    socket.on('disconnect', () => {
        try {
            console.log(`Giocatore disconnesso: ${socket.id}`);
            leaveVoice(socket);

            // Cerchiamo in quale lobby si trovava
            for (const code in lobbies) {
                const lobby = lobbies[code];
                const index = lobby.giocatori.findIndex(p => p.id === socket.id);

                // Se lo troviamo in questa lobby...
                if (index !== -1) {
                    if (lobby.gameInstance) {
                        // PARTITA IN CORSO: Aspettiamo un po' prima di trasformare in CPU (grace period per refresh)
                        const game = lobby.gameInstance;
                        const playerIndex = game.players.findIndex(p => p.id === socket.id);

                        if (playerIndex !== -1) {
                            const player = game.players[playerIndex];
                            const playerToken = player.token;
                            player.id = null; // Segnala disconnessione temporanea nel gioco

                            // Segnala disconnessione anche nella lista giocatori della lobby
                            if (lobby.giocatori[index]) {
                                lobby.giocatori[index].id = null;
                            }

                            // Notifichiamo gli altri che il giocatore è in attesa di riconnessione
                            if (game instanceof CiapanoGame) {
                                inviaStatoCiapano(code);
                            } else if (game instanceof ScopaGame) {
                                inviaStatoScopa(code);
                            } else if (game instanceof RubamazzettoGame) {
                                inviaStatoRubamazzetto(code);
                            } else if (game instanceof BriscolaGame) {
                                inviaStatoBriscola(code);
                            } else if (game instanceof TressetteGame) {
                                inviaStatoTressette(code);
                            } else {
                                inviaStato(code);
                            }
                            salvaStatoMatch(code);

                            setTimeout(() => {
                                const currentLobby = lobbies[code];
                                if (!currentLobby || !currentLobby.gameInstance) return;

                                const p = currentLobby.gameInstance.players.find(pl => pl.token === playerToken);
                                // Se dopo il timeout non si è riconnesso (id è ancora null) ed è ancora umano
                                if (p && p.id === null && p.isHuman) {
                                    p.isHuman = false;
                                    p.nome += " (Bot)";
                                    if (currentLobby.gameInstance instanceof CiapanoGame) {
                                        inviaStatoCiapano(code);
                                        salvaStatoMatch(code);
                                        if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p) &&
                                            currentLobby.gameInstance.tavolo.length < currentLobby.gameInstance.numGiocatoriInPresa()) {
                                            gestisciIA_Ciapano(code);
                                        }
                                        avviaTimerTurnoCiapano(code);
                                    } else if (currentLobby.gameInstance instanceof ScopaGame) {
                                        inviaStatoScopa(code);
                                        salvaStatoMatch(code);
                                        if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p)) {
                                            gestisciIA_Scopa(code);
                                        }
                                        avviaTimerTurnoScopa(code);
                                    } else if (currentLobby.gameInstance instanceof RubamazzettoGame) {
                                        inviaStatoRubamazzetto(code);
                                        salvaStatoMatch(code);
                                        if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p)) {
                                            gestisciIA_Rubamazzetto(code);
                                        }
                                        avviaTimerTurnoRubamazzetto(code);
                                    } else if (currentLobby.gameInstance instanceof BriscolaGame) {
                                        inviaStatoBriscola(code);
                                        salvaStatoMatch(code);
                                        if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p)) {
                                            gestisciIA_Briscola(code);
                                        }
                                        avviaTimerTurnoBriscola(code);
                                    } else if (currentLobby.gameInstance instanceof TressetteGame) {
                                        inviaStatoTressette(code);
                                        salvaStatoMatch(code);
                                        if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p)) {
                                            gestisciIA_Tressette(code);
                                        }
                                        avviaTimerTurnoTressette(code);
                                    } else {
                                        inviaStato(code);
                                        salvaStatoMatch(code);
                                        if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p) &&
                                            currentLobby.gameInstance.tavolo.length < currentLobby.gameInstance.numPlayers) {
                                            gestisciIA(code);
                                        }
                                        avviaTimerTurno(code);
                                    }
                                }
                            }, 8000); // 8 secondi di tolleranza per il refresh
                        }
                    } else {
                        // LOBBY D'ATTESA: Lo rimuoviamo semplicemente prima che inizi
                        const wasHost = (socket.id === lobby.host);
                        lobby.giocatori.splice(index, 1);
                        if (wasHost && lobby.giocatori.length > 0) {
                            lobby.host = lobby.giocatori[0].id;
                        }
                        inviaAggiornamentoLobby(code);
                        salvaStatoMatch(code);
                    }
                    break; // Trovato e gestito, fermiamo il ciclo
                }
            }
        } catch (e) {
            console.error("Errore disconnect:", e);
        } finally {
            umaniConnessi = Math.max(0, umaniConnessi - 1);
            if (socket.isAdminObs) {
                osservatoriAdmin = Math.max(0, osservatoriAdmin - 1);
            }

            const umaniReali = umaniConnessi - osservatoriAdmin;
            if (umaniReali <= 0) {
                setTimeout(avviaAutoTraining, 5000);
            }
        }
    });

    function avviaPartita(code) {
        const lobby = lobbies[code];
        if (!lobby || lobby.gameInstance) return;

        if (lobby.parametri?.gameType === 'ciapano') {
            const limite = parseInt(lobby.parametri.limitePunti || 31);
            const numG = parseInt(lobby.parametri.numGiocatori);
            lobby.gameInstance = new CiapanoGame(numG, limite);
            inviaLobbyPubblicheTutti();

            lobby.gameInstance.players.forEach((p, i) => {
                if (lobby.giocatori[i]) {
                    p.nome = lobby.giocatori[i].nome;
                    p.id = lobby.giocatori[i].id;
                    p.isHuman = true;
                    p.token = lobby.giocatori[i].token;
                    p.uniqueCode = lobby.giocatori[i].uniqueCode;
                    p.eloMomentaneo = lobby.giocatori[i].eloCiapano || lobby.giocatori[i].elo || 1000;
                } else {
                    p.nome = `Bot Ciapanò ${i + 1}`;
                    p.isHuman = false;
                }
            });

            lobby.gameInstance.distribuisci();
            lobby.gameInstance.matchId = "C-" + Math.random().toString(36).substring(2, 9).toUpperCase();
            const hostPlayer = lobby.giocatori.find(p => p.id === lobby.host);
            lobby.gameInstance.hostNickname = hostPlayer ? hostPlayer.nome : "Sconosciuto";

            salvaStatoMatch(code);
            inviaStatoCiapano(code);
            gestisciIA_Ciapano(code);
            avviaTimerTurnoCiapano(code);
            return;
        }

        if (lobby.parametri?.gameType === 'scopa') {
            const limite = parseInt(lobby.parametri.limitePunti || 11);
            const numG = parseInt(lobby.parametri.numGiocatori || 2);
            const variante = lobby.parametri.scopaVariante || 'classica';
            lobby.gameInstance = new ScopaGame(numG, limite, variante);
            inviaLobbyPubblicheTutti();

            lobby.gameInstance.players.forEach((p, i) => {
                if (lobby.giocatori[i]) {
                    p.nome = lobby.giocatori[i].nome;
                    p.id = lobby.giocatori[i].id;
                    p.isHuman = true;
                    p.token = lobby.giocatori[i].token;
                    p.uniqueCode = lobby.giocatori[i].uniqueCode;
                    p.eloMomentaneo = lobby.giocatori[i].eloScopa || 1000;
                } else {
                    p.nome = `Bot Scopa ${i + 1}`;
                    p.isHuman = false;
                }
            });

            lobby.gameInstance.distribuisciIniziale();
            lobby.gameInstance.matchId = "S-" + Math.random().toString(36).substring(2, 9).toUpperCase();
            const hostPlayer = lobby.giocatori.find(p => p.id === lobby.host);
            lobby.gameInstance.hostNickname = hostPlayer ? hostPlayer.nome : "Sconosciuto";

            salvaStatoMatch(code);
            inviaStatoScopa(code);
            gestisciIA_Scopa(code);
            avviaTimerTurnoScopa(code);
            return;
        }

        if (lobby.parametri?.gameType === 'rubamazzetto') {
            const numG = parseInt(lobby.parametri.numGiocatori || 2);
            lobby.gameInstance = new RubamazzettoGame(numG, 40);
            inviaLobbyPubblicheTutti();

            lobby.gameInstance.players.forEach((p, i) => {
                if (lobby.giocatori[i]) {
                    p.nome = lobby.giocatori[i].nome;
                    p.id = lobby.giocatori[i].id;
                    p.isHuman = true;
                    p.token = lobby.giocatori[i].token;
                    p.uniqueCode = lobby.giocatori[i].uniqueCode;
                    p.eloMomentaneo = lobby.giocatori[i].eloRubamazzetto || 1000;
                } else {
                    p.nome = `Bot Ruba ${i + 1}`;
                    p.isHuman = false;
                }
            });

            lobby.gameInstance.distribuisciIniziale();
            lobby.gameInstance.matchId = "R-" + Math.random().toString(36).substring(2, 9).toUpperCase();
            const hostPlayer = lobby.giocatori.find(p => p.id === lobby.host);
            lobby.gameInstance.hostNickname = hostPlayer ? hostPlayer.nome : "Sconosciuto";

            salvaStatoMatch(code);
            inviaStatoRubamazzetto(code);
            gestisciIA_Rubamazzetto(code);
            avviaTimerTurnoRubamazzetto(code);
            return;
        }

        if (lobby.parametri?.gameType === 'briscola') {
            const numG = parseInt(lobby.parametri.numGiocatori || 2);
            const variante = (numG === 5) ? 'chiamata' : 'classica';
            lobby.gameInstance = new BriscolaGame(numG, variante);
            inviaLobbyPubblicheTutti();

            lobby.gameInstance.players.forEach((p, i) => {
                if (lobby.giocatori[i]) {
                    p.nome = lobby.giocatori[i].nome;
                    p.id = lobby.giocatori[i].id;
                    p.isHuman = true;
                    p.token = lobby.giocatori[i].token;
                    p.uniqueCode = lobby.giocatori[i].uniqueCode;
                    p.eloMomentaneo = lobby.giocatori[i].eloBriscola || 1000;
                } else {
                    p.nome = `Bot Briscola ${i + 1}`;
                    p.isHuman = false;
                }
            });

            lobby.gameInstance.distribuisciIniziale();
            lobby.gameInstance.matchId = "B-" + Math.random().toString(36).substring(2, 9).toUpperCase();
            const hostPlayer = lobby.giocatori.find(p => p.id === lobby.host);
            lobby.gameInstance.hostNickname = hostPlayer ? hostPlayer.nome : "Sconosciuto";

            salvaStatoMatch(code);
            inviaStatoBriscola(code);
            gestisciIA_Briscola(code);
            avviaTimerTurnoBriscola(code);
            return;
        }

        if (lobby.parametri?.gameType === 'tressette') {
            const numG = parseInt(lobby.parametri.numGiocatori || 4);
            const limitePunti = parseInt(lobby.parametri.tressetteLimite || 21);

            const tressettePlayers = [];
            for (let i = 0; i < numG; i++) {
                if (lobby.giocatori[i]) {
                    const g = lobby.giocatori[i];
                    const p = new TressettePlayer(g.id, g.nome, true, g.uniqueCode);
                    p.token = g.token;
                    p.eloMomentaneo = g.eloTressette || 1000;
                    tressettePlayers.push(p);
                } else {
                    const bot = new TressettePlayer(`bot_tressette_${i + 1}`, `Bot Tressette ${i + 1}`, false, null);
                    tressettePlayers.push(bot);
                }
            }

            lobby.gameInstance = new TressetteGame(tressettePlayers, { limitePunti });
            inviaLobbyPubblicheTutti();

            lobby.gameInstance.matchId = "T-" + Math.random().toString(36).substring(2, 9).toUpperCase();
            const hostPlayer = lobby.giocatori.find(p => p.id === lobby.host);
            lobby.gameInstance.hostNickname = hostPlayer ? hostPlayer.nome : "Sconosciuto";

            salvaStatoMatch(code);
            inviaStatoTressette(code);
            gestisciIA_Tressette(code);
            avviaTimerTurnoTressette(code);
            return;
        }

        lobby.gameInstance = new LucasGame(parseInt(lobby.parametri.numGiocatori));
        inviaLobbyPubblicheTutti();

        // 1. Identifichiamo gli umani e calcoliamo il loro ELO medio
        const humanElos = [];
        lobby.gameInstance.players.forEach((p, i) => {
            if (lobby.giocatori[i]) {
                p.nome = lobby.giocatori[i].nome;
                p.id = lobby.giocatori[i].id;
                p.isHuman = true;
                p.token = lobby.giocatori[i].token;
                p.uniqueCode = lobby.giocatori[i].uniqueCode;
                p.eloMomentaneo = lobby.giocatori[i].elo || 1000;
                humanElos.push(p.eloMomentaneo);
            }
        });

        const avgHumanElo = humanElos.length > 0 ? humanElos.reduce((a, b) => a + b, 0) / humanElos.length : 1000;

        // 2. Creiamo i BOT usando le migliori statistiche ricavate dall'analisi del dataset
        lobby.gameInstance.players.forEach(p => {
            if (!p.isHuman) {
                // Il bot sceglie il suo stile "ottimizzato" in base all'ELO medio del tavolo
                if (avgHumanElo < 900) {
                    // LIVELLO 1: Novellino (Scarta a caso, molto aggressivo e sprecone, si difende poco)
                    p.aiLevel = 1;
                    p.aiParams = { agg: 85, cons: 20, sca: 90 };
                    p.aiVariant = "AI_Novellino";
                } else if (avgHumanElo < 1100) {
                    // LIVELLO 2: Principiante (Decente, ma rischia spesso inutilmente)
                    p.aiLevel = 2;
                    p.aiParams = { agg: 65, cons: 40, sca: 60 };
                    p.aiVariant = "AI_Principiante";
                } else if (avgHumanElo < 1300) {
                    // LIVELLO 3: Intermedio (Conserva meglio, sa scartare quasi bene)
                    p.aiLevel = 3;
                    p.aiParams = { agg: 45, cons: 65, sca: 35 };
                    p.aiVariant = "AI_Intermedio";
                } else {
                    // LIVELLO 4: Esperto (Calcolatore, conservativo, ottimizza lo scarto)
                    p.aiLevel = 4;
                    p.aiParams = { agg: 25, cons: 85, sca: 10 };
                    p.aiVariant = "AI_Esperto";
                }

                // Aggiungiamo un 10% di variazione casuale per rendere le partite imprevedibili (Umano-like)
                p.aiParams.agg = Math.max(0, Math.min(100, p.aiParams.agg + (Math.floor(Math.random() * 21) - 10)));
                p.aiParams.cons = Math.max(0, Math.min(100, p.aiParams.cons + (Math.floor(Math.random() * 21) - 10)));
                p.aiParams.sca = Math.max(0, Math.min(100, p.aiParams.sca + (Math.floor(Math.random() * 21) - 10)));

                p.nome = p.aiVariant.replace("AI_", "Bot "); // Es: "Bot Intermedio"
            }
        });

        lobby.gameInstance.distribuisci();
        // Genera un ID unico per la partita (usato per i log)
                lobby.gameInstance.matchId = "M-" + Math.random().toString(36).substring(2, 9).toUpperCase();

        // Identifichiamo il nickname dell'Host (chi ha creato la stanza)
        const hostPlayer = lobby.giocatori.find(p => p.id === lobby.host);
        lobby.gameInstance.hostNickname = hostPlayer ? hostPlayer.nome : "Sconosciuto";

        salvaStatoMatch(code);
        inviaStato(code);
        gestisciIA(code);
        avviaTimerTurno(code);
    }

    socket.on('bug_report', async (testo) => {
        try {
            if (!dbConnected) return;
            const lobby = Object.values(lobbies).find(l => l.giocatori.some(p => p.id === socket.id));
            const matchId = lobby?.gameInstance?.matchId || null;
            const roomCode = lobby ? Object.keys(lobbies).find(key => lobbies[key] === lobby) : null;

            const playerInLobby = lobby?.giocatori?.find(p => p.id === socket.id);
            const nickname = playerInLobby ? playerInLobby.nome : (socket.userNickname || "Anonimo");

            const newReport = new Report({
                nickname: nickname,
                testo: testo.substring(0, 500),
                roomCode: roomCode,
                matchId: matchId
            });
            await newReport.save();
            console.log(`🪲 Report salvato su DB da ${newReport.nickname} (Match: ${matchId || 'N/A'})`);
        } catch (e) {
            console.error("Errore bug_report:", e);
        }
    });

    socket.on('send_chat_message', (msg) => {
        try {
            const code = socket.roomCode;
            if (!code || !lobbies[code]) return;

            // Verifichiamo quanti umani sono presenti (id non null e isHuman true)
            // Possiamo usare lobbies[code].giocatori che tiene traccia dei connessi
            const lobby = lobbies[code];
            const humanPlayers = lobby.giocatori.filter(p => p.id !== null && p.isHuman !== false);
            
            if (humanPlayers.length < 2) {
                return; // Requisito: almeno 2 umani
            }

            if (!msg || typeof msg !== 'string' || msg.trim() === '') return;

            const playerInLobby = lobby.giocatori.find(p => p.id === socket.id);
            const senderNickname = playerInLobby ? playerInLobby.nome : (socket.userNickname || "Anonimo");

            const messageData = {
                sender: senderNickname,
                stemma: ottieniStemma(playerInLobby ? playerInLobby.uniqueCode : socket.userUniqueCode, senderNickname),
                text: filter.clean(msg).substring(0, 200),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            io.to(code).emit('receive_chat_message', messageData);
        } catch (e) {
            console.error("Errore chat:", e);
        }
    });

    // ==========================================
    // CHAT VOCALE WEBRTC (Signaling P2P)
    // ==========================================
    function leaveVoice(s, specificCode = null) {
        const code = specificCode || s.roomCode;
        if (code && voiceRooms[code]) {
            if (voiceRooms[code].has(s.id)) {
                voiceRooms[code].delete(s.id);
                s.to(code).emit('voice_peer_left', { peerId: s.id });
            }
            if (voiceRooms[code].size === 0) {
                delete voiceRooms[code];
            }
        }
    }

    socket.on('voice_join', () => {
        try {
            const code = socket.roomCode;
            if (!code || !lobbies[code]) return;

            // Consenti la chat vocale solo agli utenti registrati con account (non ospiti / anonimi)
            const lobby = lobbies[code];
            const playerInLobby = lobby.giocatori && lobby.giocatori.find(p => p.id === socket.id);
            const uCode = socket.userUniqueCode || (playerInLobby && playerInLobby.uniqueCode);
            const isRegistered = uCode && !uCode.startsWith("GUEST_");
            if (!isRegistered) {
                return socket.emit('errore', "La chat vocale è riservata agli utenti registrati. Accedi con il tuo account!");
            }

            if (!voiceRooms[code]) voiceRooms[code] = new Set();

            // Previeni doppio join
            if (voiceRooms[code].has(socket.id)) return;

            // Lista dei peer già presenti nella voice room
            const existingPeers = Array.from(voiceRooms[code]).filter(id => id !== socket.id);
            socket.emit('voice_peers_list', existingPeers);

            // Aggiungiamo questo socket alla voice room
            voiceRooms[code].add(socket.id);

            // Notifichiamo agli altri peer che qualcuno si è connesso alla voce
            socket.to(code).emit('voice_peer_joined', { peerId: socket.id });
        } catch (e) {
            console.error("Errore voice_join:", e);
        }
    });

    socket.on('voice_signal', (data) => {
        try {
            const code = socket.roomCode;
            if (!code || !lobbies[code] || !data || !data.to || !data.signal) return;
            // Verifica che il mittente sia nella voice room
            if (!voiceRooms[code] || !voiceRooms[code].has(socket.id)) return;
            // Verifica che il destinatario sia nella stessa voice room
            if (!voiceRooms[code].has(data.to)) return;
            // Inoltro diretto al peer destinatario
            io.to(data.to).emit('voice_signal', {
                from: socket.id,
                signal: data.signal
            });
        } catch (e) {
            console.error("Errore voice_signal:", e);
        }
    });

    socket.on('voice_state', (data) => {
        try {
            const code = socket.roomCode;
            if (!code) return;
            // Invia solo se il mittente è nella voice room
            if (!voiceRooms[code] || !voiceRooms[code].has(socket.id)) return;
            socket.to(code).emit('voice_peer_state', {
                peerId: socket.id,
                isMuted: !!(data && data.isMuted),
                isSpeaking: !!(data && data.isSpeaking)
            });
        } catch (e) {
            console.error("Errore voice_state:", e);
        }
    });

    socket.on('voice_leave', () => {
        try {
            leaveVoice(socket);
        } catch (e) {
            console.error("Errore voice_leave:", e);
        }
    });

    socket.on('invia_scommessa', (valRaw) => {
        try {
            const val = parseInt(valRaw);
            const code = socket.roomCode;
            const game = lobbies[code]?.gameInstance;
            if (!game || game.players[game.turnoAttuale].id !== socket.id) return socket.emit('errore', "Non è il tuo turno!");

            const qta = game.sequenzaTurni[game.indiceGiro];

            // --- NUOVO VINCOLO: LIMITE MASSIMO ---
            if (isNaN(val) || val < 0 || val > qta) {
                return socket.emit('errore', `Dichiarazione non valida! In questo turno puoi dichiarare da 0 a ${qta}.`);
            }

            // --- VINCOLO DEL MAZZIERE ---
            if (game.turnoAttuale === game.indiceMazziere) {
                if (game.sommaScommesse + val === qta) {
                    return socket.emit('errore', `Vincolo Mazziere: la somma non può fare ${qta}!`);
                }
            }

            // SICUREZZA: Non accettare la scommessa se è già stata fatta (previene doppi click o lag)
            if (game.players[game.turnoAttuale].dichiarazione !== "-") return;

            game.players[game.turnoAttuale].dichiarazione = val;
            game.sommaScommesse += val;

            // Avanza il turno solo se la dichiarazione è stata salvata con successo
            game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;

            // Passa alla fase di gioco SOLO se TUTTI hanno dichiarato
            if (game.players.every(p => p.dichiarazione !== "-")) {
                game.fase = "gioco";
            }

            salvaStatoMatch(code);
            inviaStato(code);
            gestisciIA(code);
            avviaTimerTurno(code);
        } catch (e) {
            console.error("Errore invia_scommessa:", e);
        }
    });

    socket.on('gioca_carta', (dati) => {
        try {
            const code = socket.roomCode;
            const game = lobbies[code]?.gameInstance;
            const pIdx = game?.turnoAttuale;
            if (!game || game.players[pIdx].id !== socket.id) return socket.emit('errore', "Non è il tuo turno!");

            // --- MICRO-RITARDO ANTI-GLITCH ---
            if (!game.acceptInput) return socket.emit('errore', "Attendi un istante...");

            // --- FIX 1: Evita che si giochino carte mentre la presa si sta già chiudendo (ritardo 1.2s) ---
            if (game.tavolo.length >= game.numPlayers) return socket.emit('errore', "La presa si sta già chiudendo...");

            const carta = game.players[pIdx].mano[dati.cartaIdx];

            // --- FIX 2: Evita i crash se il client invia una carta inesistente o già giocata ---
            if (!carta || carta.giocata) return;

            // --- RISPOSTA AL SEME ---
            if (game.tavolo.length > 0) {
                const semeU = game.tavolo[0].card.seme;
                const haSeme = game.players[pIdx].mano.some(c => !c.giocata && c.seme === semeU);
                if (haSeme && carta.seme !== semeU) return socket.emit('errore', `Devi rispondere a ${semeU}!`);
            }

            // ... (il resto della funzione gioca_carta rimane uguale) ...

            carta.giocata = true;
            game.tavolo.push({ playerId: pIdx, card: carta });
            if (game.tavolo.length === game.numPlayers) {
                inviaStato(code);
                setTimeout(() => risolviPresa(code), 1500);
            } else {
                game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;

                // --- MICRO-RITARDO SUL SERVER (Previene carte istantanee) ---
                game.acceptInput = false;
                setTimeout(() => { if (lobbies[code]?.gameInstance) lobbies[code].gameInstance.acceptInput = true; }, 400);

                inviaStato(code);
                gestisciIA(code);
            }
            salvaStatoMatch(code);
            avviaTimerTurno(code);
        } catch (e) {
            console.error("Errore gioca_carta:", e);
        }
    });

    async function risolviPresa(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game) return;

        const vincitore = game.calcolaVincitorePresa();
        const semeUscita = game.tavolo[0].card.seme;

        // --- LOGGING PER TRAINING AI ---
        if (dbConnected) {
            const historyStr = game.carteUscite.map(c => `${c.valore}-${c.seme}`).join('|');
            const voidStr = game.players.map((p, i) => p.voidSuits.length > 0 ? `P${i}:${p.voidSuits.join('&')}` : "").filter(s => s !== "").join('|');
            const tableStr = game.tavolo.map(t => `${t.card.valore}-${t.card.seme}`).join('|');

            // Determina in quale collezione salvare: se c'è un umano, salviamo in HumanMatchLog
            const isHumanGame = game.players.some(p => p.isHuman);
            const LogModel = isHumanGame ? HumanMatchLog : MatchLog;

            for (let indexTavolo = 0; indexTavolo < game.tavolo.length; indexTavolo++) {
                const giocata = game.tavolo[indexTavolo];
                const player = game.players[giocata.playerId];
                const card = giocata.card;

                // Se non ha risposto al seme, registriamo il "Void"
                if (card.seme !== semeUscita && !player.voidSuits.includes(semeUscita)) {
                    player.voidSuits.push(semeUscita);
                }

                // Costruiamo le mani di tutti i giocatori in questo momento
                const currentAllHands = game.players.map((p, pIdx) => {
                    const handCards = p.mano.filter(c => !c.giocata).map(c => `${c.valore}-${c.seme}`);
                    // Aggiungiamo le carte dei giocatori che devono ancora giocare in questo giro
                    for (let j = indexTavolo + 1; j < game.tavolo.length; j++) {
                        if (game.tavolo[j].playerId === pIdx) {
                            handCards.push(`${game.tavolo[j].card.valore}-${game.tavolo[j].card.seme}`);
                        }
                    }
                    return handCards.join('|');
                });

                const tablePreMossa = game.tavolo.slice(0, indexTavolo).map(t => `${t.card.valore}-${t.card.seme}`).join('|');
                const isLastCard = (indexTavolo === game.tavolo.length - 1);

                const logEntry = new LogModel({
                    timestamp: new Date(Date.now() + indexTavolo), // Ordine cronologico garantito
                    matchId: game.matchId,
                    hostNickname: game.hostNickname || "Sconosciuto",
                    numPlayers: game.numPlayers,
                    roundCards: game.sequenzaTurni[game.indiceGiro],
                    playerIndex: giocata.playerId,
                    uniqueCode: player.uniqueCode,
                    nickname: player.nome,
                    isHuman: player.isHuman,
                    elo: player.isHuman ? (player.eloMomentaneo || 1000) : 1000,
                    aiVariant: player.aiVariant || "N/A",
                    dichiarazione: player.dichiarazione,
                    preseFatte: player.preseFatte,
                    obiettivoRimanente: player.dichiarazione - player.preseFatte,
                    allHands: currentAllHands,
                    table: tablePreMossa,
                    history: historyStr,
                    voidSuits: voidStr,
                    move: `${card.valore}-${card.seme}`,
                    wonTrick: (giocata.playerId === vincitore.playerId),
                    trickWinnerId: isLastCard ? vincitore.playerId : undefined
                });
                logEntry.save().catch(e => console.error("Errore log AI:", e));
            }
        }

        game.players[vincitore.playerId].preseFatte++;

        // --- NOVITÀ: Notifica al client chi ha vinto la presa prima di pulire il tavolo ---
        io.to(code).emit('vincitore_presa', { playerId: vincitore.playerId });

        // MEMORIZZAZIONE: Salviamo le carte che sono passate sul tavolo
        game.tavolo.forEach(g => game.carteUscite.push(g.card));

        game.tavolo = [];
        game.turnoAttuale = vincitore.playerId;

        // --- MICRO-RITARDO SUL SERVER AL CAMBIO PRESA ---
        game.acceptInput = false;
        setTimeout(() => { if (lobbies[code]?.gameInstance) lobbies[code].gameInstance.acceptInput = true; }, 500);

        // --- FIX 3: Ora la mano finisce SOLO se TUTTI i giocatori hanno davvero giocato tutte le carte ---
        if (game.players.every(p => p.mano.every(c => c.giocata))) {
            game.players.forEach(p => {
                const successo = p.preseFatte === p.dichiarazione;
                p.punti += p.preseFatte + (successo ? 8 : 0);
                if (successo) p.dichiarazioniAzzeccate = (p.dichiarazioniAzzeccate || 0) + 1;
            });
            game.indiceGiro++;
            if (game.indiceGiro >= game.sequenzaTurni.length) {
                const classificaFinale = [...game.players].sort((a, b) => b.punti - a.punti);

                // --- CALCOLO E AGGIORNAMENTO ELO ---
                if (dbConnected) {
                    const humanPlayers = game.players.filter(p => p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_"));
                    if (humanPlayers.length > 0) {
                        try {
                            // Recuperiamo i profili attuali per avere l'ELO precedente
                            const userProfiles = await User.find({ uniqueCode: { $in: humanPlayers.map(p => p.uniqueCode) } });

                            // Mappa dei profili per accesso rapido
                            const profileMap = {};
                            userProfiles.forEach(u => profileMap[u.uniqueCode] = u);

                            // Calcolo ELO per ogni umano
                            for (let p of humanPlayers) {
                                 const currentElo = profileMap[p.uniqueCode]?.elo || 1000;
                                 const otherElos = game.players.filter(pl => pl.id !== p.id).map(pl => {
                                     if (pl.isHuman) {
                                         return (profileMap[pl.uniqueCode]?.elo) || 1000;
                                     } else {
                                         if (pl.aiLevel === 1) return 800;
                                         if (pl.aiLevel === 2) return 1000;
                                         if (pl.aiLevel === 3) return 1200;
                                         if (pl.aiLevel === 4) return 1400;
                                         return 1000;
                                     }
                                 });
                                 const avgOpponentElo = otherElos.reduce((a, b) => a + b, 0) / otherElos.length;

                                 // Punteggio basato sulla posizione (1.0 = Primo, 0.0 = Ultimo)
                                 const rank = classificaFinale.findIndex(cf => cf.id === p.id);
                                 const actualScore = (game.numPlayers - 1 - rank) / (game.numPlayers - 1);

                                 // Expected Score (Formula standard ELO)
                                 const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentElo - currentElo) / 400));

                                 // K-Factor (Più alto per chi ha giocato poche partite per scalare più in fretta)
                                 const matchesPlayed = profileMap[p.uniqueCode]?.partiteGiocate || 0;
                                 const K = matchesPlayed < 30 ? 50 : 25;

                                 // Calcolo variazione base
                                 let eloChange = Math.round(K * (actualScore - expectedScore));

                                 // BONUS PRECISIONE: calcolato sulle scommesse azzeccate in tutta la partita (non solo l'ultimo giro)
                                 const accuracyRatio = p.dichiarazioniAzzeccate / game.sequenzaTurni.length;
                                 if (accuracyRatio >= 0.6) eloChange += 3;
                                 else if (accuracyRatio >= 0.4) eloChange += 1;

                                let isWinner = (p.punti === classificaFinale[0].punti) ? 1 : 0;

                                await User.updateOne(
                                    { uniqueCode: p.uniqueCode },
                                    {
                                        $inc: {
                                            partiteGiocate: 1,
                                            partiteVinte: isWinner,
                                            punteggioTotale: p.punti,
                                            elo: eloChange
                                        },
                                        $set: { nickname: p.nome }
                                    }
                                );
                            }
                        } catch (e) { console.error("Errore aggiornamento ELO:", e); }
                    }
                }

                // Aggiorniamo i log del match con la classifica finale per i replay
                if (dbConnected) {
                    const simplifiedScores = classificaFinale.map(c => ({ nome: c.nome, punti: c.punti }));
                    HumanMatchLog.updateMany({ matchId: game.matchId }, { $set: { finalScores: simplifiedScores, isCompleted: true } }).catch(e => { });
                }

                await MatchState.deleteOne({ roomCode: code });
                const classificaFinaleConStemma = classificaFinale.map(p => ({
                    id: p.id,
                    nome: p.nome,
                    isHuman: p.isHuman,
                    uniqueCode: p.uniqueCode,
                    punti: p.punti,
                    stemma: ottieniStemma(p.uniqueCode, p.nome)
                }));
                io.to(code).emit('fine_partita', classificaFinaleConStemma);
                if (turnTimers[code]) {
                    clearTimeout(turnTimers[code]);
                    delete turnTimers[code];
                }
                return;
            } else {
                game.indiceMazziere = (game.indiceMazziere + 1) % game.numPlayers;
                game.distribuisci();
            }
            salvaStatoMatch(code);
        }
        inviaStato(code);
        gestisciIA(code);
        avviaTimerTurno(code);
    }

    function gestisciIA(code) {
        const game = lobbies[code]?.gameInstance;
        // Impedisce all'IA di agire se: non c'è il gioco, è il turno di un umano, l'IA sta già elaborando,
        // o se il tavolo è già pieno (fase di risoluzione presa)
        if (!game || game.players[game.turnoAttuale].isHuman || game.botThinking || game.tavolo.length >= game.numPlayers) return;

        game.botThinking = true;

        setTimeout(() => {
            const currentGame = lobbies[code]?.gameInstance;
            if (!currentGame) return;

            // Verifichiamo di nuovo che sia ancora il turno di un Bot prima di procedere
            const p = currentGame.players[currentGame.turnoAttuale];
            if (!p || p.isHuman) {
                currentGame.botThinking = false;
                return;
            }
            const qta = currentGame.sequenzaTurni[currentGame.indiceGiro];

            if (currentGame.fase === "scommesse") {
                let s = 0;
                if (p.aiLevel <= 2) {
                    // SCOMMESSA AVANZATA (Power Scoring) - Originale per Beginner/Apprentice
                    let powerScore = 0;

                    if (qta === 1) {
                        const visibleCards = [];
                        currentGame.players.forEach(otherP => {
                            if (otherP.id !== p.id) {
                                otherP.mano.forEach(c => { if (!c.giocata) visibleCards.push(c); });
                            }
                        });

                        const playedCards = currentGame.carteUscite;
                        const maxForzaAvversari = visibleCards.length > 0 ? Math.max(...visibleCards.map(vc => vc.forza)) : 0;

                        let carteSuperiori = 0;
                        let carteTotaliMistero = 0;

                        SEMI.forEach(s_ => {
                            VALORI.forEach(v_ => {
                                const forza = PESO_SEME[s_] + PESO_VALORE[v_];
                                const isVisible = visibleCards.some(vc => vc.seme === s_ && vc.valore === v_);
                                const isPlayed = playedCards.some(pc => pc.seme === s_ && pc.valore === v_);

                                if (!isVisible && !isPlayed) {
                                    carteTotaliMistero++;
                                    if (forza > maxForzaAvversari) carteSuperiori++;
                                }
                            });
                        });

                        const probVittoria = carteTotaliMistero > 0 ? (carteSuperiori / carteTotaliMistero) : 0;
                        powerScore = (Math.random() < probVittoria) ? 140 : 10;
                    } else {
                        p.mano.forEach(c => {
                            if (c.valore === 'Asso') powerScore += 140;
                            else if (c.valore === '3') powerScore += 120;
                            else if (c.valore === 'Re') powerScore += 90;
                            else if (c.valore === 'Cavallo') powerScore += 70;
                            else if (c.valore === 'Fante') powerScore += 55;
                            else powerScore += 15;

                            if (c.seme === 'Denari') powerScore += 50;
                            if (c.seme === 'Spade') powerScore += 30;
                            if (c.seme === 'Coppe') powerScore += 10;
                        });
                    }

                    const div = (currentGame.numPlayers <= 3) ? 120 : 150;
                    const ordineTurno = (currentGame.turnoAttuale - (currentGame.indiceMazziere + 1) + currentGame.numPlayers) % currentGame.numPlayers;
                    const posFactor = 0.85 + (ordineTurno / currentGame.numPlayers) * 0.3;

                    let scommesseFactor = 1.0;
                    const scommesseFatte = currentGame.players.filter(pl => pl.dichiarazione !== "-").length;
                    if (scommesseFatte > 0) {
                        const quotaTarget = (qta / currentGame.numPlayers) * scommesseFatte;
                        if (currentGame.sommaScommesse > quotaTarget) scommesseFactor = 0.85;
                        else if (currentGame.sommaScommesse < quotaTarget) scommesseFactor = 1.15;
                    }

                    s = Math.floor((powerScore / div) * posFactor * scommesseFactor);

                    if (qta === 1 && currentGame.sommaScommesse >= 1 && s >= 1) {
                        if (Math.random() > 0.4) s = 0;
                    }

                    if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);

                    if (currentGame.turnoAttuale === currentGame.indiceMazziere && (currentGame.sommaScommesse + s === qta)) {
                        if (s === 0) s = 1;
                        else if (s === qta) s = qta - 1;
                        else s = (powerScore / div > 0.5) ? s + 1 : s - 1;
                    }
                } else {
                    // Logica Ottimizzata per Intermediate/Expert
                    let expectedTricks = 0;

                    if (qta === 1) {
                        const visibleCards = [];
                        currentGame.players.forEach(otherP => {
                            if (otherP.id !== p.id) {
                                otherP.mano.forEach(c => { if (!c.giocata) visibleCards.push(c); });
                            }
                        });

                        const playedCards = currentGame.carteUscite;
                        const maxForzaAvversari = visibleCards.length > 0 ? Math.max(...visibleCards.map(vc => vc.forza)) : 0;

                        let carteSuperiori = 0;
                        let carteTotaliMistero = 0;

                        SEMI.forEach(s_ => {
                            VALORI.forEach(v_ => {
                                const forza = PESO_SEME[s_] + PESO_VALORE[v_];
                                const isVisible = visibleCards.some(vc => vc.seme === s_ && vc.valore === v_);
                                const isPlayed = playedCards.some(pc => pc.seme === s_ && pc.valore === v_);

                                if (!isVisible && !isPlayed) {
                                    carteTotaliMistero++;
                                    if (forza > maxForzaAvversari) carteSuperiori++;
                                }
                            });
                        });

                        const probVittoria = carteTotaliMistero > 0 ? (carteSuperiori / carteTotaliMistero) : 0;
                        expectedTricks = (probVittoria > 0.5) ? 1 : 0;
                    } else {
                        p.mano.forEach(c => {
                            if (c.seme === 'Denari') {
                                if (c.valore === 'Asso') expectedTricks += 1.0;
                                else if (c.valore === '3') expectedTricks += 0.95;
                                else if (c.valore === 'Re') expectedTricks += 0.85;
                                else if (c.valore === 'Cavallo') expectedTricks += 0.75;
                                else if (c.valore === 'Fante') expectedTricks += 0.65;
                                else expectedTricks += 0.35;
                            } else {
                                const sizeFactor = qta - 1;
                                if (c.valore === 'Asso') expectedTricks += Math.max(0.3, 0.7 - 0.04 * sizeFactor);
                                else if (c.valore === '3') expectedTricks += Math.max(0.15, 0.5 - 0.04 * sizeFactor);
                                else if (c.valore === 'Re') expectedTricks += Math.max(0.05, 0.3 - 0.03 * sizeFactor);
                                else if (c.valore === 'Cavallo') expectedTricks += Math.max(0.02, 0.15 - 0.02 * sizeFactor);
                                else if (c.valore === 'Fante') expectedTricks += Math.max(0.01, 0.10 - 0.01 * sizeFactor);
                                else expectedTricks += 0.02;
                            }
                        });
                    }

                    s = Math.round(expectedTricks);

                    if (qta === 1 && currentGame.sommaScommesse >= 1 && s >= 1) {
                        s = 0;
                    }

                    if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);

                    if (currentGame.turnoAttuale === currentGame.indiceMazziere && (currentGame.sommaScommesse + s === qta)) {
                        const decimalPart = expectedTricks - Math.floor(expectedTricks);
                        if (decimalPart > 0.5) {
                            s = Math.min(qta, s + 1);
                        } else {
                            s = Math.max(0, s - 1);
                        }
                        if (currentGame.sommaScommesse + s === qta) {
                            s = (s >= qta / 2) ? s - 1 : s + 1;
                        }
                    }
                }

                // Se la mano ha più di 1 carta e contiene l'Asso di Denari, la scommessa minima deve essere 1.
                // Se la scommessa da 1 viola il vincolo del mazziere, dichiara 2.
                if (qta > 1 && p.mano.some(c => c.seme === 'Denari' && c.valore === 'Asso')) {
                    if (s < 1) {
                        s = 1;
                    }
                    if (currentGame.turnoAttuale === currentGame.indiceMazziere && (currentGame.sommaScommesse + s === qta)) {
                        s = 2;
                    }
                }

                s = Math.max(0, Math.min(s, qta));

                p.dichiarazione = s;
                currentGame.sommaScommesse += s;
                currentGame.turnoAttuale = (currentGame.turnoAttuale + 1) % currentGame.numPlayers;
                if (currentGame.players.every(pl => pl.dichiarazione !== "-")) currentGame.fase = "gioco";

                currentGame.botThinking = false;
                inviaStato(code);
                gestisciIA(code);
                avviaTimerTurno(code);
            } else {
                const manoV = p.mano.filter(c => !c.giocata);
                let cartaDaGiocare;
                const wantsToWin = p.preseFatte < p.dichiarazione;
                const { agg, cons, sca } = p.aiParams || { agg: 50, cons: 50, sca: 50 };
                const crowdFactor = currentGame.numPlayers / 4;
                const numMancanti = currentGame.numPlayers - 1 - currentGame.tavolo.length;

                if (p.aiLevel === 1) {
                    cartaDaGiocare = manoV[Math.floor(Math.random() * manoV.length)];
                } else if (p.aiLevel === 2) {
                    // Logica originale per livello 2 (Principiante)
                    if (currentGame.tavolo.length === 0) {
                        if (wantsToWin) {
                            let cartaRegnante = manoV.find(c => {
                                const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                                return superiori.every(sr => currentGame.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                            });

                            if (cartaRegnante && agg > 20) {
                                cartaDaGiocare = cartaRegnante;
                            } else {
                                if (crowdFactor > 1.5 && agg < 80) {
                                    cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[Math.floor(manoV.length / 3)];
                                } else {
                                    cartaDaGiocare = (agg > 70) ? manoV.sort((a, b) => b.forza - a.forza)[0] : manoV.sort((a, b) => b.forza - a.forza)[Math.floor(manoV.length / 2)];
                                }
                            }
                        } else {
                            cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                        }
                    } else {
                        const semeUscita = currentGame.tavolo[0].card.seme;
                        const carteValide = manoV.filter(c => c.seme === semeUscita);
                        const vincenteAttuale = currentGame.calcolaVincitorePresa();

                        if (carteValide.length > 0) {
                            const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);
                            if (wantsToWin) {
                                const siamoUltimi = numMancanti === 0;
                                if (carteVincenti.length > 0) {
                                    if (siamoUltimi) {
                                        cartaDaGiocare = carteVincenti.sort((a, b) => a.forza - b.forza)[0];
                                    } else {
                                        const rischioTaglio = numMancanti * 0.15 * crowdFactor;
                                        if (cons > (80 - rischioTaglio * 100)) {
                                            cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                        } else {
                                            cartaDaGiocare = carteVincenti.sort((a, b) => b.forza - a.forza)[0];
                                        }
                                    }
                                } else {
                                    cartaDaGiocare = carteValide.sort((a, b) => b.forza - a.forza)[0];
                                }
                            } else {
                                const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                                if (cartePerdenti.length > 0) {
                                    cartaDaGiocare = (sca > 50) ? cartePerdenti.sort((a, b) => b.forza - a.forza)[0] : cartePerdenti.sort((a, b) => a.forza - b.forza)[0];
                                } else {
                                    cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                }
                            }
                        } else {
                            if (wantsToWin) {
                                const briscole = manoV.filter(c => c.seme === 'Denari');
                                if (briscole.length > 0) {
                                    const forzaBriscolaVincente = (vincenteAttuale.card.seme === 'Denari') ? vincenteAttuale.card.forza : 0;
                                    const briscoleUtili = briscole.filter(c => c.forza > forzaBriscolaVincente);

                                    if (briscoleUtili.length > 0) {
                                        const siamoUltimi = numMancanti === 0;
                                        const valoreTavolo = currentGame.tavolo.reduce((acc, curr) => acc + (PESO_VALORE[curr.card.valore] >= 10 ? 2 : 1), 0);
                                        const rischioControtaglio = numMancanti * 0.2 * crowdFactor;

                                        if (!siamoUltimi && (cons > (70 - rischioControtaglio * 100)) && valoreTavolo < 2) {
                                            cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                        } else {
                                            cartaDaGiocare = briscoleUtili.sort((a, b) => a.forza - b.forza)[0];
                                        }
                                    } else {
                                        cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                    }
                                } else {
                                    cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                }
                            } else {
                                cartaDaGiocare = (sca > 30) ? manoV.sort((a, b) => b.forza - a.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                            }
                        }
                    }
                } else {
                    // Logica Ottimizzata per livelli 3 e 4 (Intermedio ed Esperto)
                    if (currentGame.tavolo.length === 0) {
                        if (wantsToWin) {
                            let cartaRegnante = manoV.find(c => {
                                const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                                return superiori.every(sr => currentGame.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                            });

                            if (cartaRegnante) {
                                cartaDaGiocare = cartaRegnante;
                            } else {
                                const nonBriscoleForti = manoV.filter(c => c.seme !== 'Denari' && (c.valore === 'Asso' || c.valore === '3'));
                                if (nonBriscoleForti.length > 0) {
                                    cartaDaGiocare = nonBriscoleForti.sort((a, b) => b.forza - a.forza)[0];
                                } else {
                                    cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[Math.floor(manoV.length / 2)];
                                }
                            }
                        } else {
                            const nonBriscole = manoV.filter(c => c.seme !== 'Denari');
                            cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                        }
                    } else {
                        const semeUscita = currentGame.tavolo[0].card.seme;
                        const carteValide = manoV.filter(c => c.seme === semeUscita);
                        const vincenteAttuale = currentGame.calcolaVincitorePresa();

                        if (carteValide.length > 0) {
                            const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);
                            if (wantsToWin) {
                                if (carteVincenti.length > 0) {
                                    const siamoUltimi = numMancanti === 0;
                                    if (siamoUltimi) {
                                        cartaDaGiocare = carteVincenti.sort((a, b) => a.forza - b.forza)[0];
                                    } else {
                                        const miglioreVincente = carteVincenti.sort((a, b) => b.forza - a.forza)[0];
                                        if (miglioreVincente.valore === 'Asso' || miglioreVincente.valore === '3' || cons < 60) {
                                            cartaDaGiocare = miglioreVincente;
                                        } else {
                                            cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                        }
                                    }
                                } else {
                                    cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                }
                            } else {
                                const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                                if (cartePerdenti.length > 0) {
                                    cartaDaGiocare = cartePerdenti.sort((a, b) => b.forza - a.forza)[0];
                                } else {
                                    cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                }
                            }
                        } else {
                            if (wantsToWin) {
                                const briscole = manoV.filter(c => c.seme === 'Denari');
                                if (briscole.length > 0) {
                                    const forzaBriscolaVincente = (vincenteAttuale.card.seme === 'Denari') ? vincenteAttuale.card.forza : 0;
                                    const briscoleUtili = briscole.filter(c => c.forza > forzaBriscolaVincente);

                                    if (briscoleUtili.length > 0) {
                                        const siamoUltimi = numMancanti === 0;
                                        const valoreTavolo = currentGame.tavolo.reduce((acc, curr) => acc + (PESO_VALORE[curr.card.valore] >= 10 ? 2 : 1), 0);

                                        if (siamoUltimi || valoreTavolo >= 1 || cons < 50) {
                                            cartaDaGiocare = briscoleUtili.sort((a, b) => a.forza - b.forza)[0];
                                        } else {
                                            cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                        }
                                    } else {
                                        const nonBriscole = manoV.filter(c => c.seme !== 'Denari');
                                        cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                                    }
                                } else {
                                    cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                }
                            } else {
                                const nonBriscole = manoV.filter(c => c.seme !== 'Denari');
                                cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => b.forza - a.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                            }
                        }
                    }
                }

                currentGame.botThinking = false;

                if (!cartaDaGiocare) {
                    console.error("❌ CRITICAL: Il Bot non ha trovato carte da giocare!");
                    return;
                }

                cartaDaGiocare.giocata = true;
                currentGame.tavolo.push({ playerId: currentGame.turnoAttuale, card: cartaDaGiocare });

                if (currentGame.tavolo.length === currentGame.numPlayers) {
                    inviaStato(code);
                    setTimeout(() => risolviPresa(code), 1500);
                } else {
                    currentGame.turnoAttuale = (currentGame.turnoAttuale + 1) % currentGame.numPlayers;
                    inviaStato(code);
                    gestisciIA(code);
                    avviaTimerTurno(code);
                }
            }
        }, 1200);
    }

    function inviaStato(code) {
        const lobby = lobbies[code];
        if (!lobby || !lobby.gameInstance) return;
        const game = lobby.gameInstance;
        const qta = game.sequenzaTurni[game.indiceGiro];

        // Invio uno stato personalizzato solo ai giocatori umani presenti
        lobby.giocatori.forEach(giocatoreUmano => {
            const payload = {
                fase: game.fase,
                turnoAttuale: game.turnoAttuale,
                tavolo: game.tavolo,
                sommaScommesse: game.sommaScommesse,
                qtaCarte: qta,
                tuttiGiocatori: game.players.map((p, i) => {
                    let manoDaInviare = p.mano;

                    const isMe = (p.id === giocatoreUmano.id);

                    if (qta === 1 && isMe) {
                        manoDaInviare = p.mano.map(c => ({ ...c, valore: "?", seme: "?" }));
                    } else if (qta > 1 && !isMe) {
                        manoDaInviare = p.mano.map(c => ({ ...c, valore: "?", seme: "?" }));
                    }

                    return {
                        nome: p.nome,
                        punti: p.punti,
                        dichiarazione: p.dichiarazione,
                        prese: p.preseFatte,
                        isMazziere: (i === game.indiceMazziere),
                        socketId: p.id,
                        isMe: isMe,
                        stemma: ottieniStemma(p.uniqueCode, p.nome),
                        cartaFronte: (qta === 1) ? p.mano.find(c => !c.giocata) : null,
                        mano: manoDaInviare,
                        isHuman: p.isHuman
                    };
                })
            };
            if (giocatoreUmano.id) {
                io.to(giocatoreUmano.id).emit('conferma_inizio_partita', payload);
            }
        });
    }

    function avviaTimerTurno(code) {
        if (turnTimers[code]) {
            clearTimeout(turnTimers[code]);
            delete turnTimers[code];
        }

        const lobby = lobbies[code];
        if (!lobby || !lobby.gameInstance) return;
        const game = lobby.gameInstance;

        // Se la presa si sta risolvendo (tavolo pieno), non facciamo partire il timer
        if (game.tavolo.length >= game.numPlayers) return;

        const activePlayer = game.players[game.turnoAttuale];
        if (activePlayer && activePlayer.isHuman) {
            turnTimers[code] = setTimeout(() => {
                autogiocaTurno(code, game.turnoAttuale);
            }, 30000);
        }
    }

    function autogiocaTurno(code, playerIndex) {
        const lobby = lobbies[code];
        if (!lobby || !lobby.gameInstance) return;
        const game = lobby.gameInstance;
        if (game.turnoAttuale !== playerIndex) return;

        const p = game.players[playerIndex];
        if (!p.isHuman) return;

        console.log(`⏱️ Player ${p.nome} (Human) timed out in room ${code}. Autoplay active.`);

        const qta = game.sequenzaTurni[game.indiceGiro];

        if (game.fase === "scommesse") {
            // Calcolo scommessa automatica basata sulla logica bot intermedia (livello 3)
            let expectedTricks = 0;
            if (qta === 1) {
                const visibleCards = [];
                game.players.forEach(otherP => {
                    if (otherP.id !== p.id) {
                        otherP.mano.forEach(c => { if (!c.giocata) visibleCards.push(c); });
                    }
                });
                const playedCards = game.carteUscite;
                const maxForzaAvversari = visibleCards.length > 0 ? Math.max(...visibleCards.map(vc => vc.forza)) : 0;
                let carteSuperiori = 0;
                let carteTotaliMistero = 0;

                SEMI.forEach(s_ => {
                    VALORI.forEach(v_ => {
                        const forza = PESO_SEME[s_] + PESO_VALORE[v_];
                        const isVisible = visibleCards.some(vc => vc.seme === s_ && vc.valore === v_);
                        const isPlayed = playedCards.some(pc => pc.seme === s_ && pc.valore === v_);
                        if (!isVisible && !isPlayed) {
                            carteTotaliMistero++;
                            if (forza > maxForzaAvversari) carteSuperiori++;
                        }
                    });
                });
                const probVittoria = carteTotaliMistero > 0 ? (carteSuperiori / carteTotaliMistero) : 0;
                expectedTricks = (probVittoria > 0.5) ? 1 : 0;
            } else {
                p.mano.forEach(c => {
                    if (c.seme === 'Denari') {
                        if (c.valore === 'Asso') expectedTricks += 1.0;
                        else if (c.valore === '3') expectedTricks += 0.95;
                        else if (c.valore === 'Re') expectedTricks += 0.85;
                        else if (c.valore === 'Cavallo') expectedTricks += 0.75;
                        else if (c.valore === 'Fante') expectedTricks += 0.65;
                        else expectedTricks += 0.35;
                    } else {
                        const sizeFactor = qta - 1;
                        if (c.valore === 'Asso') expectedTricks += Math.max(0.3, 0.7 - 0.04 * sizeFactor);
                        else if (c.valore === '3') expectedTricks += Math.max(0.15, 0.5 - 0.04 * sizeFactor);
                        else if (c.valore === 'Re') expectedTricks += Math.max(0.05, 0.3 - 0.03 * sizeFactor);
                        else if (c.valore === 'Cavallo') expectedTricks += Math.max(0.02, 0.15 - 0.02 * sizeFactor);
                        else if (c.valore === 'Fante') expectedTricks += Math.max(0.01, 0.10 - 0.01 * sizeFactor);
                        else expectedTricks += 0.02;
                    }
                });
            }

            let s = Math.round(expectedTricks);

            if (qta === 1 && game.sommaScommesse >= 1 && s >= 1) {
                s = 0;
            }
            if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);

            if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                const decimalPart = expectedTricks - Math.floor(expectedTricks);
                if (decimalPart > 0.5) {
                    s = Math.min(qta, s + 1);
                } else {
                    s = Math.max(0, s - 1);
                }
                if (game.sommaScommesse + s === qta) {
                    s = (s >= qta / 2) ? s - 1 : s + 1;
                }
            }

            // Se la mano ha più di 1 carta e contiene l'Asso di Ori, la scommessa minima deve essere 1.
            // Se la scommessa da 1 viola il vincolo del mazziere, dichiara 2.
            if (qta > 1 && p.mano.some(c => c.seme === 'Denari' && c.valore === 'Asso')) {
                if (s < 1) {
                    s = 1;
                }
                if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                    s = 2;
                }
            }

            s = Math.max(0, Math.min(s, qta));

            p.dichiarazione = s;
            game.sommaScommesse += s;

            // Invia notifica di timeout ai client
            io.to(code).emit('mossa_automatica', { nickname: p.nome, mossa: `scommessa ${s}` });

            game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
            if (game.players.every(pl => pl.dichiarazione !== "-")) {
                game.fase = "gioco";
            }

            salvaStatoMatch(code);
            inviaStato(code);
            gestisciIA(code);
            avviaTimerTurno(code);

        } else if (game.fase === "gioco") {
            const manoV = p.mano.filter(c => !c.giocata);
            if (manoV.length === 0) return;

            let cartaDaGiocare;
            const wantsToWin = p.preseFatte < p.dichiarazione;
            const cons = 65; // Coefficiente conservazione fisso a livello 3 (Intermedio)
            const numMancanti = game.numPlayers - 1 - game.tavolo.length;

            let carteValide = [];
            if (game.tavolo.length > 0) {
                const semeUscita = game.tavolo[0].card.seme;
                carteValide = manoV.filter(c => c.seme === semeUscita);
            }
            if (carteValide.length === 0) {
                carteValide = manoV;
            }

            if (game.tavolo.length === 0) {
                if (wantsToWin) {
                    let cartaRegnante = carteValide.find(c => {
                        const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                        return superiori.every(sr => game.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                    });

                    if (cartaRegnante) {
                        cartaDaGiocare = cartaRegnante;
                    } else {
                        const nonBriscoleForti = carteValide.filter(c => c.seme !== 'Denari' && (c.valore === 'Asso' || c.valore === '3'));
                        if (nonBriscoleForti.length > 0) {
                            cartaDaGiocare = nonBriscoleForti.sort((a, b) => b.forza - a.forza)[0];
                        } else {
                            cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[Math.floor(carteValide.length / 2)];
                        }
                    }
                } else {
                    const nonBriscole = carteValide.filter(c => c.seme !== 'Denari');
                    cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => a.forza - b.forza)[0] : carteValide.sort((a, b) => a.forza - b.forza)[0];
                }
            } else {
                const vincenteAttuale = game.calcolaVincitorePresa();
                const semeUscita = game.tavolo[0].card.seme;
                const haSeme = manoV.some(c => c.seme === semeUscita);

                if (haSeme) {
                    const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);
                    if (wantsToWin) {
                        if (carteVincenti.length > 0) {
                            const siamoUltimi = numMancanti === 0;
                            if (siamoUltimi) {
                                cartaDaGiocare = carteVincenti.sort((a, b) => a.forza - b.forza)[0];
                            } else {
                                const miglioreVincente = carteVincenti.sort((a, b) => b.forza - a.forza)[0];
                                if (miglioreVincente.valore === 'Asso' || miglioreVincente.valore === '3' || cons < 60) {
                                    cartaDaGiocare = miglioreVincente;
                                } else {
                                    cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                }
                            }
                        } else {
                            cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                        }
                    } else {
                        const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                        if (cartePerdenti.length > 0) {
                            cartaDaGiocare = cartePerdenti.sort((a, b) => b.forza - a.forza)[0];
                        } else {
                            cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                        }
                    }
                } else {
                    if (wantsToWin) {
                        const briscole = carteValide.filter(c => c.seme === 'Denari');
                        if (briscole.length > 0) {
                            const forzaBriscolaVincente = (vincenteAttuale.card.seme === 'Denari') ? vincenteAttuale.card.forza : 0;
                            const briscoleUtili = briscole.filter(c => c.forza > forzaBriscolaVincente);

                            if (briscoleUtili.length > 0) {
                                const siamoUltimi = numMancanti === 0;
                                const valoreTavolo = game.tavolo.reduce((acc, curr) => acc + (PESO_VALORE[curr.card.valore] >= 10 ? 2 : 1), 0);

                                if (siamoUltimi || valoreTavolo >= 1 || cons < 50) {
                                    cartaDaGiocare = briscoleUtili.sort((a, b) => a.forza - b.forza)[0];
                                } else {
                                    cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                }
                            } else {
                                const nonBriscole = carteValide.filter(c => c.seme !== 'Denari');
                                cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => a.forza - b.forza)[0] : carteValide.sort((a, b) => a.forza - b.forza)[0];
                            }
                        } else {
                            cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                        }
                    } else {
                        const nonBriscole = carteValide.filter(c => c.seme !== 'Denari');
                        cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => b.forza - a.forza)[0] : carteValide.sort((a, b) => a.forza - b.forza)[0];
                    }
                }
            }

            if (!cartaDaGiocare) {
                cartaDaGiocare = carteValide[0];
            }

            cartaDaGiocare.giocata = true;
            game.tavolo.push({ playerId: playerIndex, card: cartaDaGiocare });

            // Invia notifica di timeout ai client
            io.to(code).emit('mossa_automatica', { nickname: p.nome, mossa: `${cartaDaGiocare.valore} di ${cartaDaGiocare.seme}` });

            if (game.tavolo.length === game.numPlayers) {
                inviaStato(code);
                setTimeout(() => risolviPresa(code), 1500);
            } else {
                game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
                inviaStato(code);
                gestisciIA(code);
                avviaTimerTurno(code);
            }
            salvaStatoMatch(code);
        }
    }

    // =============================================
    // CIAPANÒ - SOCKET EVENTS & ENGINE INTEGRATION
    // =============================================

    function inviaStatoCiapano(code) {
        const lobby = lobbies[code];
        if (!lobby || !lobby.gameInstance) return;
        const game = lobby.gameInstance;

        lobby.giocatori.forEach(giocatoreUmano => {
            const payload = {
                gameType: 'ciapano',
                fase: game.fase,
                turnoAttuale: game.turnoAttuale,
                tavolo: game.tavolo,
                smazzataNum: game.smazzataNum,
                limitePunti: game.limitePunti,
                carteScartate: game.carteScartate,
                tuttiGiocatori: game.players.map((p, i) => {
                    const isMe = (p.id === giocatoreUmano.id);
                    let manoDaInviare = p.mano;
                    if (!isMe) {
                        manoDaInviare = p.mano.map(c => ({ ...c, valore: "?", seme: "?" }));
                    }
                    return {
                        id: p.id,
                        nome: p.nome,
                        puntiTotali: p.puntiTotali,
                        puntiSmazzata: p.puntiSmazzata,
                        preseCount: p.preseFatte.length,
                        eliminato: p.eliminato,
                        isMazziere: (i === game.indiceMazziere),
                        isMe: isMe,
                        socketId: p.id,
                        stemma: ottieniStemma(p.uniqueCode, p.nome),
                        mano: manoDaInviare,
                        isHuman: p.isHuman
                    };
                })
            };
            if (giocatoreUmano.id) {
                io.to(giocatoreUmano.id).emit('conferma_inizio_ciapano', payload);
            }
        });
    }

    socket.on('gioca_carta_ciapano', (dati) => {
        try {
            const code = socket.roomCode;
            const lobby = lobbies[code];
            const game = lobby?.gameInstance;
            if (!game || !(game instanceof CiapanoGame)) return;
            const pIdx = game.turnoAttuale;
            if (game.players[pIdx].id !== socket.id) return socket.emit('errore', "Non è il tuo turno!");
            if (!game.acceptInput) return socket.emit('errore', "Attendi un istante...");
            if (game.tavolo.length >= game.numGiocatoriInPresa()) return socket.emit('errore', "La presa si sta chiudendo...");

            const player = game.players[pIdx];
            const carta = player.mano[dati.cartaIdx];
            if (!carta || carta.giocata) return;

            if (!game.puoGiocareCarta(pIdx, carta)) {
                return socket.emit('errore', `Devi rispondere al seme di uscita (${game.tavolo[0].card.seme})!`);
            }

            carta.giocata = true;
            game.tavolo.push({ playerId: pIdx, card: carta });

            if (game.tavolo.length >= game.numGiocatoriInPresa()) {
                inviaStatoCiapano(code);
                setTimeout(() => risolviPresaCiapano(code), 1200);
            } else {
                game.turnoAttuale = game.prossimoGiocatoreAttivo((game.turnoAttuale + 1) % game.numPlayers);
                game.acceptInput = false;
                setTimeout(() => { if (lobbies[code]?.gameInstance) lobbies[code].gameInstance.acceptInput = true; }, 300);
                inviaStatoCiapano(code);
                gestisciIA_Ciapano(code);
                avviaTimerTurnoCiapano(code);
            }
            salvaStatoMatch(code);
        } catch (e) {
            console.error("Errore gioca_carta_ciapano:", e);
        }
    });

    async function risolviPresaCiapano(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof CiapanoGame)) return;

        const vincitore = game.calcolaVincitorePresa();
        if (!vincitore) return;

        io.to(code).emit('vincitore_presa_ciapano', { playerId: vincitore.playerId, card: vincitore.card });

        game.players[vincitore.playerId].preseFatte.push(...game.tavolo.map(t => t.card));
        game.tavolo.forEach(t => game.carteUscite.push(t.card));
        game.ultimoPresista = vincitore.playerId;
        game.tavolo = [];
        game.turnoAttuale = vincitore.playerId;

        game.acceptInput = false;
        setTimeout(() => { if (lobbies[code]?.gameInstance) lobbies[code].gameInstance.acceptInput = true; }, 500);

        const attivi = game.getGiocatoriAttivi();
        const smazzataFinita = attivi.every(p => p.mano.every(c => c.giocata));

        if (smazzataFinita) {
            const { isCappotto, cappottoPlayerId } = game.calcolaFineSmazzata();
            return concludiSmazzataCiapano(code, isCappotto, cappottoPlayerId);
        } else {
            inviaStatoCiapano(code);
            gestisciIA_Ciapano(code);
            avviaTimerTurnoCiapano(code);
        }
    }

    async function concludiSmazzataCiapano(code, isCappotto = false, cappottoPlayerId = -1) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof CiapanoGame)) return;

        const { gameOver } = game.applicaPunteggi(isCappotto, cappottoPlayerId);

        const punteggiSmazzata = game.players.map(p => ({
            id: p.id,
            nome: p.nome,
            puntiSmazzata: p.puntiSmazzata,
            puntiTotali: p.puntiTotali,
            eliminato: p.eliminato
        }));

        io.to(code).emit('fine_smazzata_ciapano', {
            punteggi: punteggiSmazzata,
            gameOver: gameOver,
            cappotto: isCappotto,
            cappottoPlayerId: cappottoPlayerId
        });

        if (gameOver) {
            game.fase = "fine_partita";
            const classificaFinale = [...game.players].sort((a, b) => {
                if (a.eliminato !== b.eliminato) return a.eliminato ? 1 : -1;
                return a.puntiTotali - b.puntiTotali;
            });

            if (dbConnected) {
                const humanPlayers = game.players.filter(p => p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_"));
                if (humanPlayers.length > 0) {
                    try {
                        const userProfiles = await User.find({ uniqueCode: { $in: humanPlayers.map(p => p.uniqueCode) } });
                        const profileMap = {};
                        userProfiles.forEach(u => profileMap[u.uniqueCode] = u);

                        for (let p of humanPlayers) {
                            const currentElo = profileMap[p.uniqueCode]?.eloCiapano || 1000;
                            const otherElos = game.players.filter(pl => pl.id !== p.id).map(pl => {
                                if (pl.isHuman) return profileMap[pl.uniqueCode]?.eloCiapano || 1000;
                                return 1000;
                            });
                            const avgOpponentElo = otherElos.length > 0 ? (otherElos.reduce((a, b) => a + b, 0) / otherElos.length) : 1000;

                            const rank = classificaFinale.findIndex(cf => cf.id === p.id);
                            const actualScore = (game.numPlayers - 1 - rank) / (game.numPlayers - 1);
                            const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentElo - currentElo) / 400));
                            const matchesPlayed = profileMap[p.uniqueCode]?.partiteGiocate || 0;
                            const K = matchesPlayed < 30 ? 50 : 25;
                            let eloChange = Math.round(K * (actualScore - expectedScore));

                            const isWinner = (p.id === classificaFinale[0].id) ? 1 : 0;

                            await User.updateOne(
                                { uniqueCode: p.uniqueCode },
                                {
                                    $inc: {
                                        partiteGiocate: 1,
                                        partiteVinte: isWinner,
                                        eloCiapano: eloChange
                                    }
                                }
                            );
                            p.eloChange = eloChange;
                        }
                    } catch (errElo) {
                        console.error("Errore salvataggio ELO Ciapanò:", errElo);
                    }
                }
            }

            io.to(code).emit('fine_partita_ciapano', {
                classifica: classificaFinale.map((p, idx) => ({
                    posizione: idx + 1,
                    nome: p.nome,
                    puntiTotali: p.puntiTotali,
                    eliminato: p.eliminato,
                    eloChange: p.eloChange || 0,
                    stemma: ottieniStemma(p.uniqueCode, p.nome)
                }))
            });
            salvaStatoMatch(code);
        } else {
            setTimeout(() => {
                const curLobby = lobbies[code];
                if (!curLobby || !curLobby.gameInstance) return;
                const curGame = curLobby.gameInstance;
                curGame.smazzataNum++;
                curGame.indiceMazziere = curGame.prossimoGiocatoreAttivo((curGame.indiceMazziere + 1) % curGame.numPlayers);
                curGame.distribuisci();
                inviaStatoCiapano(code);
                gestisciIA_Ciapano(code);
                avviaTimerTurnoCiapano(code);
                salvaStatoMatch(code);
            }, 3500);
        }
    }

    function gestisciIA_Ciapano(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game || !(game instanceof CiapanoGame)) return;
        const attivo = game.players[game.turnoAttuale];
        if (!attivo || attivo.isHuman || game.botThinking || game.tavolo.length >= game.numGiocatoriInPresa()) return;

        game.botThinking = true;

        setTimeout(() => {
            const currentGame = lobbies[code]?.gameInstance;
            if (!currentGame || !(currentGame instanceof CiapanoGame)) return;
            const p = currentGame.players[currentGame.turnoAttuale];
            if (!p || p.isHuman) {
                currentGame.botThinking = false;
                return;
            }

            const giocabili = currentGame.carteGiocabili(currentGame.turnoAttuale);
            if (giocabili.length === 0) {
                currentGame.botThinking = false;
                return;
            }

            let cartaScelta = null;

            if (currentGame.tavolo.length === 0) {
                // Gioca preferibilmente carte basse non di presa, evitando di aprire con un Asso
                const ordinate = [...giocabili].sort((a, b) => PESO_VALORE_CIAPANO[a.valore] - PESO_VALORE_CIAPANO[b.valore]);
                cartaScelta = ordinate.find(c => c.valore !== 'Asso') || ordinate[0];
            } else {
                const semeUscita = currentGame.tavolo[0].card.seme;
                const haSeme = giocabili.some(c => c.seme === semeUscita);

                if (haSeme) {
                    const vincenteAttuale = currentGame.calcolaVincitorePresa();
                    const pesoVincente = PESO_VALORE_CIAPANO[vincenteAttuale.card.valore];

                    const carteSotto = giocabili.filter(c => PESO_VALORE_CIAPANO[c.valore] < pesoVincente);
                    if (carteSotto.length > 0) {
                        // Liscia con la carta più alta che rimane sotto alla vincente
                        carteSotto.sort((a, b) => PESO_VALORE_CIAPANO[b.valore] - PESO_VALORE_CIAPANO[a.valore]);
                        cartaScelta = carteSotto[0];
                    } else {
                        // Deve superare: gioca la carta che assegna meno punti
                        giocabili.sort((a, b) => {
                            const ptA = puntiCartaCiapano(a.valore);
                            const ptB = puntiCartaCiapano(b.valore);
                            if (ptA !== ptB) return ptA - ptB;
                            return PESO_VALORE_CIAPANO[a.valore] - PESO_VALORE_CIAPANO[b.valore];
                        });
                        cartaScelta = giocabili[0];
                    }
                } else {
                    // Spalato: scarta le carte che danno più punti (Assi poi Figure/2/3) con gerarchia più alta
                    const perPunti = [...giocabili].sort((a, b) => {
                        const ptA = puntiCartaCiapano(a.valore);
                        const ptB = puntiCartaCiapano(b.valore);
                        if (ptB !== ptA) return ptB - ptA;
                        return PESO_VALORE_CIAPANO[b.valore] - PESO_VALORE_CIAPANO[a.valore];
                    });
                    cartaScelta = perPunti[0];
                }
            }

            const cartaIdx = p.mano.findIndex(c => !c.giocata && c.valore === cartaScelta.valore && c.seme === cartaScelta.seme);
            currentGame.botThinking = false;

            if (cartaIdx !== -1) {
                const c = p.mano[cartaIdx];
                c.giocata = true;
                currentGame.tavolo.push({ playerId: currentGame.turnoAttuale, card: c });

                if (currentGame.tavolo.length >= currentGame.numGiocatoriInPresa()) {
                    inviaStatoCiapano(code);
                    setTimeout(() => risolviPresaCiapano(code), 1200);
                } else {
                    currentGame.turnoAttuale = currentGame.prossimoGiocatoreAttivo((currentGame.turnoAttuale + 1) % currentGame.numPlayers);
                    inviaStatoCiapano(code);
                    gestisciIA_Ciapano(code);
                    avviaTimerTurnoCiapano(code);
                }
                salvaStatoMatch(code);
            }
        }, 800 + Math.floor(Math.random() * 400));
    }

    function avviaTimerTurnoCiapano(code) {
        if (turnTimers[code]) {
            clearTimeout(turnTimers[code]);
            delete turnTimers[code];
        }
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof CiapanoGame)) return;
        if (game.tavolo.length >= game.numGiocatoriInPresa()) return;

        const activePlayer = game.players[game.turnoAttuale];
        if (activePlayer && activePlayer.isHuman) {
            turnTimers[code] = setTimeout(() => {
                autogiocaTurnoCiapano(code, game.turnoAttuale);
            }, 30000);
        }
    }

    function autogiocaTurnoCiapano(code, playerIdx) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof CiapanoGame) || game.turnoAttuale !== playerIdx) return;
        const p = game.players[playerIdx];
        if (!p) return;
        const giocabili = game.carteGiocabili(playerIdx);
        if (giocabili.length === 0) return;
        const cartaScelta = giocabili[0];
        const cIdx = p.mano.findIndex(c => !c.giocata && c.valore === cartaScelta.valore && c.seme === cartaScelta.seme);
        if (cIdx !== -1) {
            const carta = p.mano[cIdx];
            carta.giocata = true;
            game.tavolo.push({ playerId: playerIdx, card: carta });
            if (game.tavolo.length >= game.numGiocatoriInPresa()) {
                inviaStatoCiapano(code);
                setTimeout(() => risolviPresaCiapano(code), 1200);
            } else {
                game.turnoAttuale = game.prossimoGiocatoreAttivo((game.turnoAttuale + 1) % game.numPlayers);
                inviaStatoCiapano(code);
                gestisciIA_Ciapano(code);
                avviaTimerTurnoCiapano(code);
            }
            salvaStatoMatch(code);
        }
    }

    // =============================================
    // HANDLERS SERVER: SCOPA
    // =============================================

    socket.on('gioca_carta_scopa', (dati) => {
        try {
            const code = socket.roomCode;
            const lobby = lobbies[code];
            const game = lobby?.gameInstance;
            if (!game || !(game instanceof ScopaGame)) return;

            const playerIdx = game.turnoAttuale;
            const player = game.players[playerIdx];
            if (!player || player.id !== socket.id) return socket.emit('errore', "Non è il tuo turno!");

            const cartaIdx = dati?.cartaIdx;
            if (cartaIdx === undefined || cartaIdx < 0 || cartaIdx >= player.mano.length) {
                return socket.emit('errore', "Mossa non valida.");
            }

            if (turnTimers[code]) {
                clearTimeout(turnTimers[code]);
                delete turnTimers[code];
            }

            const res = game.giocaCarta(playerIdx, cartaIdx);
            io.to(code).emit('mossa_scopa', {
                playerIdx,
                nome: player.nome,
                ...res
            });

            const avanz = game.verificaAvanzamentoMano();
            if (avanz.smazzataFinita) {
                inviaStatoScopa(code);
                concludiSmazzataScopa(code);
            } else {
                inviaStatoScopa(code);
                gestisciIA_Scopa(code);
                avviaTimerTurnoScopa(code);
            }
            salvaStatoMatch(code);
        } catch (e) {
            console.error("Errore gioca_carta_scopa:", e);
        }
    });

    function inviaStatoScopa(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof ScopaGame)) return;

        const umani = game.players.filter(p => p.isHuman);
        umani.forEach(giocatoreUmano => {
            const payload = {
                roomCode: code,
                turnoAttuale: game.turnoAttuale,
                fase: game.fase,
                variante: game.variante || 'classica',
                tavolo: game.tavolo,
                smazzataNum: game.smazzataNum,
                distribuzioneNum: game.distribuzioneNum,
                limitePunti: game.limitePunti,
                mazzoRimanente: game.mazzo.length,
                mano: giocatoreUmano.mano,
                tuttiGiocatori: game.players.map((p, i) => {
                    const isMe = (p.id === giocatoreUmano.id);
                    return {
                        id: p.id,
                        nome: p.nome,
                        isHuman: p.isHuman,
                        numCarte: p.mano.length,
                        preseCount: p.prese.length,
                        cimaMazzetto: game.getCimaMazzetto(i),
                        scopeCount: p.scope,
                        puntiTotali: p.puntiTotali,
                        isMazziere: (i === game.indiceMazziere),
                        isMe: isMe,
                        socketId: p.id,
                        stemma: ottieniStemma(p.uniqueCode, p.nome)
                    };
                })
            };
            if (giocatoreUmano.id) {
                io.to(giocatoreUmano.id).emit('conferma_inizio_scopa', payload);
            }
        });
    }

    async function concludiSmazzataScopa(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof ScopaGame)) return;

        const ris = game.calcolaPunteggiSmazzata();

        io.to(code).emit('fine_smazzata_scopa', {
            punteggi: game.players.map(p => ({
                id: p.id,
                nome: p.nome,
                scope: p.scope,
                preseCount: p.prese.length,
                puntiSmazzata: p.puntiSmazzata,
                puntiTotali: p.puntiTotali,
                dettaglio: p.dettaglioPuntiSmazzata
            })),
            gameOver: ris.gameOver,
            vincitoreId: ris.vincitoreId
        });

        if (ris.gameOver) {
            game.fase = "fine_partita";
            const classificaFinale = [...game.players].sort((a, b) => b.puntiTotali - a.puntiTotali);

            if (dbConnected) {
                const humanPlayers = game.players.filter(p => p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_"));
                for (let p of humanPlayers) {
                    const isWinner = (p.id === ris.vincitoreId) ? 1 : 0;
                    const eloChange = isWinner ? 25 : -25;
                    try {
                        await User.updateOne(
                            { uniqueCode: p.uniqueCode },
                            {
                                $inc: {
                                    partiteGiocate: 1,
                                    partiteVinte: isWinner,
                                    eloScopa: eloChange
                                }
                            }
                        );
                        p.eloChange = eloChange;
                    } catch (errElo) {
                        console.error("Errore aggiornamento ELO Scopa:", errElo);
                    }
                }
            }

            io.to(code).emit('fine_partita_scopa', {
                classifica: classificaFinale.map((p, idx) => ({
                    posizione: idx + 1,
                    nome: p.nome,
                    puntiTotali: p.puntiTotali,
                    eloChange: p.eloChange || 0,
                    stemma: ottieniStemma(p.uniqueCode, p.nome)
                }))
            });
            salvaStatoMatch(code);
        } else {
            setTimeout(() => {
                const curLobby = lobbies[code];
                if (!curLobby || !curLobby.gameInstance) return;
                const curGame = curLobby.gameInstance;
                curGame.smazzataNum++;
                curGame.indiceMazziere = (curGame.indiceMazziere + 1) % curGame.numPlayers;
                curGame.distribuisciIniziale();
                inviaStatoScopa(code);
                gestisciIA_Scopa(code);
                avviaTimerTurnoScopa(code);
                salvaStatoMatch(code);
            }, 3500);
        }
    }

    function gestisciIA_Scopa(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game || !(game instanceof ScopaGame)) return;
        const attivo = game.players[game.turnoAttuale];
        if (!attivo || attivo.isHuman || game.botThinking) return;

        game.botThinking = true;

        setTimeout(() => {
            const currentGame = lobbies[code]?.gameInstance;
            if (!currentGame || !(currentGame instanceof ScopaGame)) return;
            const p = currentGame.players[currentGame.turnoAttuale];
            if (!p || p.isHuman || p.mano.length === 0) {
                currentGame.botThinking = false;
                return;
            }

            const cartaIdx = currentGame.scegliMossaIA(currentGame.turnoAttuale);
            currentGame.botThinking = false;

            const res = currentGame.giocaCarta(currentGame.turnoAttuale, cartaIdx);
            io.to(code).emit('mossa_scopa', {
                playerIdx: currentGame.turnoAttuale,
                nome: p.nome,
                ...res
            });

            const avanz = currentGame.verificaAvanzamentoMano();
            if (avanz.smazzataFinita) {
                inviaStatoScopa(code);
                concludiSmazzataScopa(code);
            } else {
                inviaStatoScopa(code);
                gestisciIA_Scopa(code);
                avviaTimerTurnoScopa(code);
            }
            salvaStatoMatch(code);
        }, 800 + Math.floor(Math.random() * 400));
    }

    function avviaTimerTurnoScopa(code) {
        if (turnTimers[code]) {
            clearTimeout(turnTimers[code]);
            delete turnTimers[code];
        }
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof ScopaGame)) return;

        const activePlayer = game.players[game.turnoAttuale];
        if (activePlayer && activePlayer.isHuman) {
            turnTimers[code] = setTimeout(() => {
                autogiocaTurnoScopa(code, game.turnoAttuale);
            }, 30000);
        }
    }

    function autogiocaTurnoScopa(code, playerIdx) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof ScopaGame) || game.turnoAttuale !== playerIdx) return;
        const p = game.players[playerIdx];
        if (!p || p.mano.length === 0) return;

        const cartaIdx = game.scegliMossaIA(playerIdx);
        const res = game.giocaCarta(playerIdx, cartaIdx);
        io.to(code).emit('mossa_scopa', {
            playerIdx,
            nome: p.nome,
            ...res
        });

        const avanz = game.verificaAvanzamentoMano();
        if (avanz.smazzataFinita) {
            inviaStatoScopa(code);
            concludiSmazzataScopa(code);
        } else {
            inviaStatoScopa(code);
            gestisciIA_Scopa(code);
            avviaTimerTurnoScopa(code);
        }
        salvaStatoMatch(code);
    }

    // =============================================
    // HANDLERS SERVER: RUBAMAZZETTO
    // =============================================

    socket.on('gioca_carta_rubamazzetto', (dati) => {
        try {
            const code = socket.roomCode;
            const lobby = lobbies[code];
            const game = lobby?.gameInstance;
            if (!game || !(game instanceof RubamazzettoGame)) return;

            const playerIdx = game.turnoAttuale;
            const player = game.players[playerIdx];
            if (!player || player.id !== socket.id) return socket.emit('errore', "Non è il tuo turno!");

            const cartaIdx = dati?.cartaIdx;
            if (cartaIdx === undefined || cartaIdx < 0 || cartaIdx >= player.mano.length) {
                return socket.emit('errore', "Mossa non valida.");
            }

            if (turnTimers[code]) {
                clearTimeout(turnTimers[code]);
                delete turnTimers[code];
            }

            const res = game.giocaCarta(playerIdx, cartaIdx);
            io.to(code).emit('mossa_rubamazzetto', {
                playerIdx,
                nome: player.nome,
                ...res
            });

            const avanz = game.verificaAvanzamentoMano();
            if (avanz.smazzataFinita) {
                inviaStatoRubamazzetto(code);
                concludiPartitaRubamazzetto(code);
            } else {
                inviaStatoRubamazzetto(code);
                gestisciIA_Rubamazzetto(code);
                avviaTimerTurnoRubamazzetto(code);
            }
            salvaStatoMatch(code);
        } catch (e) {
            console.error("Errore gioca_carta_rubamazzetto:", e);
        }
    });

    function inviaStatoRubamazzetto(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof RubamazzettoGame)) return;

        const umani = game.players.filter(p => p.isHuman);
        umani.forEach(giocatoreUmano => {
            const payload = {
                roomCode: code,
                turnoAttuale: game.turnoAttuale,
                fase: game.fase,
                tavolo: game.tavolo,
                smazzataNum: game.smazzataNum,
                distribuzioneNum: game.distribuzioneNum,
                mazzoRimanente: game.mazzo.length,
                mano: giocatoreUmano.mano,
                tuttiGiocatori: game.players.map((p, i) => {
                    const isMe = (p.id === giocatoreUmano.id);
                    return {
                        id: p.id,
                        nome: p.nome,
                        isHuman: p.isHuman,
                        numCarte: p.mano.length,
                        mazzettoCount: p.mazzetto.length,
                        cimaMazzetto: p.cimaMazzetto,
                        puntiTotali: p.puntiTotali,
                        isMazziere: (i === game.indiceMazziere),
                        isMe: isMe,
                        socketId: p.id,
                        stemma: ottieniStemma(p.uniqueCode, p.nome)
                    };
                })
            };
            if (giocatoreUmano.id) {
                io.to(giocatoreUmano.id).emit('conferma_inizio_rubamazzetto', payload);
            }
        });
    }

    async function concludiPartitaRubamazzetto(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof RubamazzettoGame)) return;

        game.fase = "fine_partita";
        const { classifica, vincitoreId } = game.calcolaClassificaFinale();

        if (dbConnected) {
            const humanPlayers = game.players.filter(p => p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_"));
            for (let p of humanPlayers) {
                const isWinner = (p.id === vincitoreId) ? 1 : 0;
                const eloChange = isWinner ? 30 : -15;
                try {
                    await User.updateOne(
                        { uniqueCode: p.uniqueCode },
                        {
                            $inc: {
                                partiteGiocate: 1,
                                partiteVinte: isWinner,
                                eloRubamazzetto: eloChange
                            }
                        }
                    );
                    p.eloChange = eloChange;
                } catch (errElo) {
                    console.error("Errore aggiornamento ELO Rubamazzetto:", errElo);
                }
            }
        }

        io.to(code).emit('fine_partita_rubamazzetto', {
            classifica: classifica.map((p, idx) => ({
                posizione: idx + 1,
                nome: p.nome,
                carteMazzetto: p.mazzetto.length,
                puntiTotali: p.puntiTotali,
                eloChange: p.eloChange || 0,
                stemma: ottieniStemma(p.uniqueCode, p.nome)
            }))
        });
        salvaStatoMatch(code);
    }

    function gestisciIA_Rubamazzetto(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game || !(game instanceof RubamazzettoGame)) return;
        const attivo = game.players[game.turnoAttuale];
        if (!attivo || attivo.isHuman || game.botThinking) return;

        game.botThinking = true;

        setTimeout(() => {
            const currentGame = lobbies[code]?.gameInstance;
            if (!currentGame || !(currentGame instanceof RubamazzettoGame)) return;
            const p = currentGame.players[currentGame.turnoAttuale];
            if (!p || p.isHuman || p.mano.length === 0) {
                currentGame.botThinking = false;
                return;
            }

            const cartaIdx = currentGame.scegliMossaIA(currentGame.turnoAttuale);
            currentGame.botThinking = false;

            const res = currentGame.giocaCarta(currentGame.turnoAttuale, cartaIdx);
            io.to(code).emit('mossa_rubamazzetto', {
                playerIdx: currentGame.turnoAttuale,
                nome: p.nome,
                ...res
            });

            const avanz = currentGame.verificaAvanzamentoMano();
            if (avanz.smazzataFinita) {
                inviaStatoRubamazzetto(code);
                concludiPartitaRubamazzetto(code);
            } else {
                inviaStatoRubamazzetto(code);
                gestisciIA_Rubamazzetto(code);
                avviaTimerTurnoRubamazzetto(code);
            }
            salvaStatoMatch(code);
        }, 800 + Math.floor(Math.random() * 400));
    }

    function avviaTimerTurnoRubamazzetto(code) {
        if (turnTimers[code]) {
            clearTimeout(turnTimers[code]);
            delete turnTimers[code];
        }
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof RubamazzettoGame)) return;

        const activePlayer = game.players[game.turnoAttuale];
        if (activePlayer && activePlayer.isHuman) {
            turnTimers[code] = setTimeout(() => {
                autogiocaTurnoRubamazzetto(code, game.turnoAttuale);
            }, 30000);
        }
    }

    function autogiocaTurnoRubamazzetto(code, playerIdx) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof RubamazzettoGame) || game.turnoAttuale !== playerIdx) return;
        const p = game.players[playerIdx];
        if (!p || p.mano.length === 0) return;

        const cartaIdx = game.scegliMossaIA(playerIdx);
        const res = game.giocaCarta(playerIdx, cartaIdx);
        io.to(code).emit('mossa_rubamazzetto', {
            playerIdx,
            nome: p.nome,
            ...res
        });

        const avanz = game.verificaAvanzamentoMano();
        if (avanz.smazzataFinita) {
            inviaStatoRubamazzetto(code);
            concludiPartitaRubamazzetto(code);
        } else {
            inviaStatoRubamazzetto(code);
            gestisciIA_Rubamazzetto(code);
            avviaTimerTurnoRubamazzetto(code);
        }
        salvaStatoMatch(code);
    }

    // =============================================
    // GESTIONE BRISCOLA (CLASSICA & CHIAMATA)
    // =============================================
    socket.on('gioca_carta_briscola', (dati) => {
        try {
            const code = socket.roomCode;
            const lobby = lobbies[code];
            const game = lobby?.gameInstance;
            if (!game || !(game instanceof BriscolaGame)) return;

            const playerIdx = game.turnoAttuale;
            const player = game.players[playerIdx];
            if (!player || player.id !== socket.id) return socket.emit('errore', "Non è il tuo turno!");

            const cartaIdx = dati?.cartaIdx;
            if (cartaIdx === undefined || cartaIdx < 0 || cartaIdx >= player.mano.length) {
                return socket.emit('errore', "Mossa non valida.");
            }

            if (turnTimers[code]) {
                clearTimeout(turnTimers[code]);
                delete turnTimers[code];
            }

            const res = game.giocaCarta(playerIdx, cartaIdx);
            io.to(code).emit('mossa_briscola', {
                playerIdx,
                nome: player.nome,
                ...res
            });

            if (res.manoCompleta) {
                inviaStatoBriscola(code);
                setTimeout(() => risolviPresaBriscola(code), 1200);
            } else {
                inviaStatoBriscola(code);
                gestisciIA_Briscola(code);
                avviaTimerTurnoBriscola(code);
            }
            salvaStatoMatch(code);
        } catch (e) {
            console.error("Errore gioca_carta_briscola:", e);
        }
    });

    function risolviPresaBriscola(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof BriscolaGame)) return;

        const esito = game.risolviPresa();
        if (!esito) return;

        io.to(code).emit('vincitore_presa_briscola', {
            vincitoreId: esito.vincitoreId,
            nomeVincitore: esito.nomeVincitore,
            cartaVincente: esito.cartaVincente
        });

        if (esito.partitaFinita) {
            inviaStatoBriscola(code);
            concludiPartitaBriscola(code);
        } else {
            inviaStatoBriscola(code);
            gestisciIA_Briscola(code);
            avviaTimerTurnoBriscola(code);
        }
        salvaStatoMatch(code);
    }

    function inviaStatoBriscola(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof BriscolaGame)) return;

        const umani = game.players.filter(p => p.isHuman);
        umani.forEach(giocatoreUmano => {
            const payload = {
                roomCode: code,
                turnoAttuale: game.turnoAttuale,
                fase: game.fase,
                tavolo: game.tavolo,
                smazzataNum: game.smazzataNum,
                semeBriscola: game.semeBriscola,
                cartaBriscola: game.cartaBriscola,
                mazzoRimanente: game.mazzo.length,
                variante: game.variante,
                cartaChiamata: game.cartaChiamata,
                socioRivelato: game.socioRivelato,
                mano: giocatoreUmano.mano,
                tuttiGiocatori: game.players.map((p, i) => {
                    const isMe = (p.id === giocatoreUmano.id);
                    let ruoloVisibile = null;
                    if (game.variante === 'chiamata') {
                        if (i === game.chiamanteIdx) {
                            ruoloVisibile = 'chiamante';
                        } else if (game.socioRivelato) {
                            ruoloVisibile = (i === game.socioIdx) ? 'socio' : 'buono';
                        } else if (isMe && i === game.socioIdx) {
                            ruoloVisibile = 'socio';
                        }
                    }
                    return {
                        id: p.id,
                        nome: p.nome,
                        isHuman: p.isHuman,
                        numCarte: p.mano.length,
                        cartePreseCount: p.prese.length,
                        puntiTotali: p.puntiTotali,
                        ruolo: ruoloVisibile,
                        isMazziere: (i === game.indiceMazziere),
                        isMe: isMe,
                        socketId: p.id,
                        stemma: ottieniStemma(p.uniqueCode, p.nome)
                    };
                })
            };
            if (giocatoreUmano.id) {
                io.to(giocatoreUmano.id).emit('conferma_inizio_briscola', payload);
            }
        });
    }

    async function concludiPartitaBriscola(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof BriscolaGame)) return;

        game.fase = "fine_partita";
        const esito = game.calcolaClassificaFinale();

        if (dbConnected) {
            const humanPlayers = game.players.filter(p => p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_"));
            for (let p of humanPlayers) {
                const pIdx = game.players.indexOf(p);
                let isWinner = 0;
                if (game.variante === 'chiamata') {
                    const isInChiamanteTeam = (pIdx === game.chiamanteIdx || pIdx === game.socioIdx);
                    isWinner = (esito.vittoriaChiamante && isInChiamanteTeam) || (!esito.vittoriaChiamante && !isInChiamanteTeam) ? 1 : 0;
                } else {
                    isWinner = (p.id === esito.vincitoreId) ? 1 : 0;
                }
                const eloChange = isWinner ? 30 : -15;
                try {
                    await User.updateOne(
                        { uniqueCode: p.uniqueCode },
                        {
                            $inc: {
                                partiteGiocate: 1,
                                partiteVinte: isWinner,
                                eloBriscola: eloChange
                            }
                        }
                    );
                    p.eloChange = eloChange;
                } catch (errElo) {
                    console.error("Errore aggiornamento ELO Briscola:", errElo);
                }
            }
        }

        io.to(code).emit('fine_partita_briscola', {
            variante: game.variante,
            vittoriaChiamante: esito.vittoriaChiamante,
            puntiSquadraChiamante: esito.puntiSquadraChiamante,
            puntiDifesa: esito.puntiDifesa,
            chiamanteNome: esito.chiamanteNome,
            socioNome: esito.socioNome,
            isPareggio: esito.isPareggio,
            vincitoreId: esito.vincitoreId,
            classifica: esito.classifica.map((p, idx) => ({
                posizione: idx + 1,
                nome: p.nome,
                puntiTotali: p.puntiTotali,
                eloChange: p.eloChange || 0,
                ruolo: p.ruolo,
                stemma: ottieniStemma(p.uniqueCode, p.nome)
            }))
        });
        salvaStatoMatch(code);
    }

    function gestisciIA_Briscola(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game || !(game instanceof BriscolaGame)) return;
        const attivo = game.players[game.turnoAttuale];
        if (!attivo || attivo.isHuman || game.botThinking) return;

        game.botThinking = true;

        setTimeout(() => {
            const currentGame = lobbies[code]?.gameInstance;
            if (!currentGame || !(currentGame instanceof BriscolaGame)) return;
            const p = currentGame.players[currentGame.turnoAttuale];
            if (!p || p.isHuman || p.mano.length === 0) {
                currentGame.botThinking = false;
                return;
            }

            const cartaIdx = currentGame.scegliMossaIA(currentGame.turnoAttuale);
            currentGame.botThinking = false;

            const res = currentGame.giocaCarta(currentGame.turnoAttuale, cartaIdx);
            io.to(code).emit('mossa_briscola', {
                playerIdx: currentGame.turnoAttuale,
                nome: p.nome,
                ...res
            });

            if (res.manoCompleta) {
                inviaStatoBriscola(code);
                setTimeout(() => risolviPresaBriscola(code), 1200);
            } else {
                inviaStatoBriscola(code);
                gestisciIA_Briscola(code);
                avviaTimerTurnoBriscola(code);
            }
            salvaStatoMatch(code);
        }, 800 + Math.floor(Math.random() * 400));
    }

    function avviaTimerTurnoBriscola(code) {
        if (turnTimers[code]) {
            clearTimeout(turnTimers[code]);
            delete turnTimers[code];
        }
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof BriscolaGame)) return;

        const activePlayer = game.players[game.turnoAttuale];
        if (activePlayer && activePlayer.isHuman) {
            turnTimers[code] = setTimeout(() => {
                autogiocaTurnoBriscola(code, game.turnoAttuale);
            }, 30000);
        }
    }

    function autogiocaTurnoBriscola(code, playerIdx) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof BriscolaGame) || game.turnoAttuale !== playerIdx) return;
        const p = game.players[playerIdx];
        if (!p || p.mano.length === 0) return;

        const cartaIdx = game.scegliMossaIA(playerIdx);
        const res = game.giocaCarta(playerIdx, cartaIdx);
        io.to(code).emit('mossa_briscola', {
            playerIdx,
            nome: p.nome,
            ...res
        });

        if (res.manoCompleta) {
            inviaStatoBriscola(code);
            setTimeout(() => risolviPresaBriscola(code), 1200);
        } else {
            inviaStatoBriscola(code);
            gestisciIA_Briscola(code);
            avviaTimerTurnoBriscola(code);
        }
        salvaStatoMatch(code);
    }

    // ==========================================
    //   GESTIONE TRESSETTE (A 2 O A 4 GIOCATORI)
    // ==========================================

    socket.on('gioca_carta_tressette', (dati) => {
        try {
            const code = socket.roomCode;
            if (!code || !lobbies[code]) return;
            const game = lobbies[code].gameInstance;
            if (!game || !(game instanceof TressetteGame)) return;

            const playerIdx = game.players.findIndex(p => p.id === socket.id);
            if (playerIdx === -1 || playerIdx !== game.turnoAttuale) return;

            const res = game.giocaCarta(playerIdx, dati.cartaIdx);
            if (!res.ok) {
                return socket.emit('errore', res.motivo);
            }

            if (turnTimers[code]) {
                clearTimeout(turnTimers[code]);
                delete turnTimers[code];
            }

            io.to(code).emit('mossa_tressette', {
                playerIdx,
                nome: game.players[playerIdx].nome,
                ...res
            });

            if (res.manoCompleta) {
                inviaStatoTressette(code);
                setTimeout(() => risolviPresaTressette(code), 1200);
            } else {
                inviaStatoTressette(code);
                gestisciIA_Tressette(code);
                avviaTimerTurnoTressette(code);
            }
            salvaStatoMatch(code);
        } catch (e) {
            console.error("Errore gioca_carta_tressette:", e);
        }
    });

    function risolviPresaTressette(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof TressetteGame)) return;

        const resPresa = game.risolviPresa();
        if (!resPresa) return;

        io.to(code).emit('vincitore_presa_tressette', {
            vincitoreId: resPresa.vincitoreId,
            vincitoreIdx: resPresa.vincitoreIdx,
            vincitoreNome: resPresa.vincitoreNome,
            cartaVincente: resPresa.cartaVincente
        });

        if (resPresa.smazzataFinita) {
            io.to(code).emit('fine_smazzata_tressette', {
                smazzataNum: resPresa.esitoSmazzata.smazzataNum,
                punteggi: resPresa.esitoSmazzata.punteggi
            });

            if (resPresa.esitoSmazzata.partitaFinita) {
                inviaStatoTressette(code);
                concludiPartitaTressette(code);
            } else {
                setTimeout(() => {
                    const curGame = lobbies[code]?.gameInstance;
                    if (curGame && curGame instanceof TressetteGame) {
                        curGame.nuovaSmazzata();
                        inviaStatoTressette(code);
                        gestisciIA_Tressette(code);
                        avviaTimerTurnoTressette(code);
                        salvaStatoMatch(code);
                    }
                }, 2500);
            }
        } else {
            inviaStatoTressette(code);
            gestisciIA_Tressette(code);
            avviaTimerTurnoTressette(code);
        }
        salvaStatoMatch(code);
    }

    function inviaStatoTressette(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof TressetteGame)) return;

        const umani = game.players.filter(p => p.isHuman);
        umani.forEach(giocatoreUmano => {
            const payload = {
                roomCode: code,
                turnoAttuale: game.turnoAttuale,
                fase: game.fase,
                tavolo: game.tavolo,
                smazzataNum: game.smazzataNum,
                limitePunti: game.limitePunti,
                mazzoRimanente: game.mazzo.length,
                numPlayers: game.numPlayers,
                mano: giocatoreUmano.mano,
                tuttiGiocatori: game.players.map((p, i) => {
                    const isMe = (p.id === giocatoreUmano.id);
                    return {
                        id: p.id,
                        nome: p.nome,
                        isHuman: p.isHuman,
                        numCarte: p.mano.length,
                        cartePreseCount: p.prese.length,
                        puntiTotali: p.puntiTotali,
                        puntiSmazzata: p.puntiSmazzata,
                        isMazziere: (i === game.indiceMazziere),
                        isMe: isMe,
                        socketId: p.id,
                        stemma: ottieniStemma(p.uniqueCode, p.nome)
                    };
                })
            };
            if (giocatoreUmano.id) {
                io.to(giocatoreUmano.id).emit('conferma_inizio_tressette', payload);
            }
        });
    }

    async function concludiPartitaTressette(code) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof TressetteGame)) return;

        game.fase = "fine_partita";
        const esito = game.calcolaClassificaFinale();

        if (dbConnected) {
            const humanPlayers = game.players.filter(p => p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_"));
            for (let p of humanPlayers) {
                const pIdx = game.players.indexOf(p);
                let isWinner = 0;
                if (game.numPlayers === 4) {
                    const winnerIdx = game.players.indexOf(esito.vincitore);
                    const isWinnerTeam = (winnerIdx % 2 === pIdx % 2);
                    isWinner = isWinnerTeam ? 1 : 0;
                } else {
                    isWinner = (p.id === esito.vincitore.id) ? 1 : 0;
                }
                const eloChange = isWinner ? 30 : -15;
                try {
                    await User.updateOne(
                        { uniqueCode: p.uniqueCode },
                        {
                            $inc: {
                                partiteGiocate: 1,
                                partiteVinte: isWinner,
                                eloTressette: eloChange
                            }
                        }
                    );
                    p.eloChange = eloChange;
                } catch (errElo) {
                    console.error("Errore aggiornamento ELO Tressette:", errElo);
                }
            }
        }

        io.to(code).emit('fine_partita_tressette', {
            isPareggio: esito.isPareggio,
            vincitoreNome: esito.vincitore.nome,
            classifica: esito.classifica.map((p, idx) => ({
                posizione: idx + 1,
                nome: p.nome,
                puntiTotali: p.puntiTotali,
                eloChange: p.eloChange || 0,
                stemma: ottieniStemma(p.uniqueCode, p.nome)
            }))
        });
        salvaStatoMatch(code);
    }

    function gestisciIA_Tressette(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game || !(game instanceof TressetteGame)) return;
        const attivo = game.players[game.turnoAttuale];
        if (!attivo || attivo.isHuman || game.botThinking) return;

        game.botThinking = true;

        setTimeout(() => {
            const currentGame = lobbies[code]?.gameInstance;
            if (!currentGame || !(currentGame instanceof TressetteGame)) return;
            const p = currentGame.players[currentGame.turnoAttuale];
            if (!p || p.isHuman || p.mano.length === 0) {
                currentGame.botThinking = false;
                return;
            }

            const cartaIdx = currentGame.scegliMossaIA(currentGame.turnoAttuale);
            currentGame.botThinking = false;

            const res = currentGame.giocaCarta(currentGame.turnoAttuale, cartaIdx);
            io.to(code).emit('mossa_tressette', {
                playerIdx: currentGame.turnoAttuale,
                nome: p.nome,
                ...res
            });

            if (res.manoCompleta) {
                inviaStatoTressette(code);
                setTimeout(() => risolviPresaTressette(code), 1200);
            } else {
                inviaStatoTressette(code);
                gestisciIA_Tressette(code);
                avviaTimerTurnoTressette(code);
            }
            salvaStatoMatch(code);
        }, 800 + Math.floor(Math.random() * 400));
    }

    function avviaTimerTurnoTressette(code) {
        if (turnTimers[code]) {
            clearTimeout(turnTimers[code]);
            delete turnTimers[code];
        }
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof TressetteGame)) return;

        const activePlayer = game.players[game.turnoAttuale];
        if (activePlayer && activePlayer.isHuman) {
            turnTimers[code] = setTimeout(() => {
                autogiocaTurnoTressette(code, game.turnoAttuale);
            }, 30000);
        }
    }

    function autogiocaTurnoTressette(code, playerIdx) {
        const lobby = lobbies[code];
        const game = lobby?.gameInstance;
        if (!game || !(game instanceof TressetteGame) || game.turnoAttuale !== playerIdx) return;
        const p = game.players[playerIdx];
        if (!p || p.mano.length === 0) return;

        const cartaIdx = game.scegliMossaIA(playerIdx);
        const res = game.giocaCarta(playerIdx, cartaIdx);
        io.to(code).emit('mossa_tressette', {
            playerIdx,
            nome: p.nome,
            ...res
        });

        if (res.manoCompleta) {
            inviaStatoTressette(code);
            setTimeout(() => risolviPresaTressette(code), 1200);
        } else {
            inviaStatoTressette(code);
            gestisciIA_Tressette(code);
            avviaTimerTurnoTressette(code);
        }
        salvaStatoMatch(code);
    }
});

// ==========================================
//   MOTORE DI AUTO-TRAINING (TURBO AI)
// ==========================================

async function avviaAutoTraining() {
    if (!turboEnabled) {
        isSimulando = false;
        return;
    }

    const umaniReali = umaniConnessi - osservatoriAdmin;
    if (umaniReali > 0) {
        isSimulando = false;
        setTimeout(avviaAutoTraining, 10000); // Check meno frequente
        return;
    }
    if (!dbConnected) return;

    isSimulando = true;

    // Eseguiamo solo 2 partite contemporaneamente per non appesantire troppo il server
    try {
        await Promise.all([
            simulazionePartitaSingola(),
            simulazionePartitaSingola()
        ]);
    } catch (e) {
        console.error("Errore durante simulazione turbo:", e);
    }

    if (!turboEnabled) {
        isSimulando = false;
        return;
    }

    // Ricontrolla se siamo ancora soli
    const umaniRealiCheck = umaniConnessi - osservatoriAdmin;
    if (umaniRealiCheck <= 0) {
        try {
            const count = await MatchLog.estimatedDocumentCount();
            // Se siamo vicini al limite (400k), rallenta moltissimo
            const delay = (count >= 395000) ? 1000 * 60 * 30 : 2000; // 2 secondi tra batch invece di 1
            setTimeout(avviaAutoTraining, delay);
        } catch (e) {
            setTimeout(avviaAutoTraining, 5000);
        }
    } else {
        isSimulando = false;
        setTimeout(avviaAutoTraining, 10000);
    }
}


async function simulazionePartitaSingola() {
    // Crea una partita da 4 Bot (media ideale)
    const numPlayers = 4;
    const game = new LucasGame(numPlayers);
    game.matchId = "TURBO-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Inizializza i bot
    game.players.forEach((p, i) => {
        p.nome = `Bot-${i}`;
        p.isHuman = false;
    });

    const batchLogs = [];

    // Loop dei Giri
    while (game.indiceGiro < game.sequenzaTurni.length) {
        game.distribuisci();

        // 1. Fase Scommesse
        while (game.fase === "scommesse") {
            const p = game.players[game.turnoAttuale];
            const qta = game.sequenzaTurni[game.indiceGiro];

            let s = 0;
            if (p.aiLevel <= 2) {
                // Logica originale per Beginner/Apprentice (livello 1 e 2)
                let powerScore = 0;
                if (qta === 1) {
                    const visibleCards = [];
                    game.players.forEach(otherP => {
                        if (otherP.id !== p.id) {
                            otherP.mano.forEach(c => { if (!c.giocata) visibleCards.push(c); });
                        }
                    });
                    const playedCards = game.carteUscite;
                    const maxForzaAvversari = visibleCards.length > 0 ? Math.max(...visibleCards.map(vc => vc.forza)) : 0;
                    let carteSuperiori = 0;
                    let carteTotaliMistero = 0;
                    SEMI.forEach(s_ => {
                        VALORI.forEach(v_ => {
                            const forza = PESO_SEME[s_] + PESO_VALORE[v_];
                            const isVisible = visibleCards.some(vc => vc.seme === s_ && vc.valore === v_);
                            const isPlayed = playedCards.some(pc => pc.seme === s_ && pc.valore === v_);
                            if (!isVisible && !isPlayed) {
                                carteTotaliMistero++;
                                if (forza > maxForzaAvversari) carteSuperiori++;
                            }
                        });
                    });
                    const probVittoria = carteTotaliMistero > 0 ? (carteSuperiori / carteTotaliMistero) : 0;
                    powerScore = (Math.random() < probVittoria) ? 140 : 10;
                } else {
                    p.mano.forEach(c => {
                        if (c.valore === 'Asso') powerScore += 140;
                        else if (c.valore === '3') powerScore += 120;
                        else if (c.valore === 'Re') powerScore += 90;
                        else if (c.valore === 'Cavallo') powerScore += 70;
                        else if (c.valore === 'Fante') powerScore += 55;
                        else powerScore += 15;

                        if (c.seme === 'Denari') powerScore += 50;
                        if (c.seme === 'Spade') powerScore += 30;
                        if (c.seme === 'Coppe') powerScore += 10;
                    });
                }
                const div = (game.numPlayers <= 3) ? 120 : 150;
                const ordineTurno = (game.turnoAttuale - (game.indiceMazziere + 1) + game.numPlayers) % game.numPlayers;
                const posFactor = 0.85 + (ordineTurno / game.numPlayers) * 0.3;
                let scommesseFactor = 1.0;
                const scommesseFatte = game.players.filter(pl => pl.dichiarazione !== "-").length;
                if (scommesseFatte > 0) {
                    const quotaTarget = (qta / game.numPlayers) * scommesseFatte;
                    if (game.sommaScommesse > quotaTarget) scommesseFactor = 0.85;
                    else if (game.sommaScommesse < quotaTarget) scommesseFactor = 1.15;
                }
                s = Math.floor((powerScore / div) * posFactor * scommesseFactor);
                if (qta === 1 && game.sommaScommesse >= 1 && s >= 1) {
                    if (Math.random() > 0.4) s = 0;
                }
                if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);
                if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                    if (s === 0) s = 1;
                    else if (s === qta) s = qta - 1;
                    else s = (powerScore / div > 0.5) ? s + 1 : s - 1;
                }
            } else {
                // Logica Ottimizzata per Intermediate/Expert (livello 3 e 4)
                let expectedTricks = 0;
                if (qta === 1) {
                    const visibleCards = [];
                    game.players.forEach(otherP => {
                        if (otherP.id !== p.id) {
                            otherP.mano.forEach(c => { if (!c.giocata) visibleCards.push(c); });
                        }
                    });
                    const playedCards = game.carteUscite;
                    const maxForzaAvversari = visibleCards.length > 0 ? Math.max(...visibleCards.map(vc => vc.forza)) : 0;
                    let carteSuperiori = 0;
                    let carteTotaliMistero = 0;
                    SEMI.forEach(s_ => {
                        VALORI.forEach(v_ => {
                            const forza = PESO_SEME[s_] + PESO_VALORE[v_];
                            const isVisible = visibleCards.some(vc => vc.seme === s_ && vc.valore === v_);
                            const isPlayed = playedCards.some(pc => pc.seme === s_ && pc.valore === v_);
                            if (!isVisible && !isPlayed) {
                                carteTotaliMistero++;
                                if (forza > maxForzaAvversari) carteSuperiori++;
                            }
                        });
                    });
                    const probVittoria = carteTotaliMistero > 0 ? (carteSuperiori / carteTotaliMistero) : 0;
                    expectedTricks = (probVittoria > 0.5) ? 1 : 0;
                } else {
                    p.mano.forEach(c => {
                        if (c.seme === 'Denari') {
                            if (c.valore === 'Asso') expectedTricks += 1.0;
                            else if (c.valore === '3') expectedTricks += 0.95;
                            else if (c.valore === 'Re') expectedTricks += 0.85;
                            else if (c.valore === 'Cavallo') expectedTricks += 0.75;
                            else if (c.valore === 'Fante') expectedTricks += 0.65;
                            else expectedTricks += 0.35;
                        } else {
                            const sizeFactor = qta - 1;
                            if (c.valore === 'Asso') expectedTricks += Math.max(0.3, 0.7 - 0.04 * sizeFactor);
                            else if (c.valore === '3') expectedTricks += Math.max(0.15, 0.5 - 0.04 * sizeFactor);
                            else if (c.valore === 'Re') expectedTricks += Math.max(0.05, 0.3 - 0.03 * sizeFactor);
                            else if (c.valore === 'Cavallo') expectedTricks += Math.max(0.02, 0.15 - 0.02 * sizeFactor);
                            else if (c.valore === 'Fante') expectedTricks += Math.max(0.01, 0.10 - 0.01 * sizeFactor);
                            else expectedTricks += 0.02;
                        }
                    });
                }
                s = Math.round(expectedTricks);
                if (qta === 1 && game.sommaScommesse >= 1 && s >= 1) {
                    s = 0;
                }
                if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);
                if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                    const decimalPart = expectedTricks - Math.floor(expectedTricks);
                    if (decimalPart > 0.5) s = Math.min(qta, s + 1);
                    else s = Math.max(0, s - 1);
                    if (game.sommaScommesse + s === qta) {
                        s = (s >= qta / 2) ? s - 1 : s + 1;
                    }
                }
            }
            // Se la mano ha più di 1 carta e contiene l'Asso di Ori, la scommessa minima deve essere 1.
            // Se la scommessa da 1 viola il vincolo del mazziere, dichiara 2.
            if (qta > 1 && p.mano.some(c => c.seme === 'Denari' && c.valore === 'Asso')) {
                if (s < 1) {
                    s = 1;
                }
                if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                    s = 2;
                }
            }

            s = Math.max(0, Math.min(s, qta));

            p.dichiarazione = s;
            game.sommaScommesse += s;
            game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
            if (game.players.every(pl => pl.dichiarazione !== "-")) game.fase = "gioco";
        }

        // 2. Fase Gioco
        while (game.fase === "gioco") {
            const p = game.players[game.turnoAttuale];
            const manoV = p.mano.filter(c => !c.giocata);
            let cartaDaGiocare;
            const wantsToWin = p.preseFatte < p.dichiarazione;
            const { agg, cons, sca } = p.aiParams || { agg: 50, cons: 50, sca: 50 };
            const crowdFactor = game.numPlayers / 4;
            const numMancanti = game.numPlayers - 1 - game.tavolo.length;

            if (p.aiLevel === 1) {
                cartaDaGiocare = manoV[Math.floor(Math.random() * manoV.length)];
            } else if (p.aiLevel === 2) {
                // Logica originale per livello 2 (Principiante)
                if (game.tavolo.length === 0) {
                    if (wantsToWin) {
                        let cartaRegnante = manoV.find(c => {
                            const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                            return superiori.every(sr => game.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                        });
                        if (cartaRegnante && agg > 20) {
                            cartaDaGiocare = cartaRegnante;
                        } else {
                            if (crowdFactor > 1.5 && agg < 80) {
                                cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[Math.floor(manoV.length / 3)];
                            } else {
                                cartaDaGiocare = (agg > 70) ? manoV.sort((a, b) => b.forza - a.forza)[0] : manoV.sort((a, b) => b.forza - a.forza)[Math.floor(manoV.length / 2)];
                            }
                        }
                    } else {
                        cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                    }
                } else {
                    const semeUscita = game.tavolo[0].card.seme;
                    const carteValide = manoV.filter(c => c.seme === semeUscita);
                    const vincenteAttuale = game.calcolaVincitorePresa();
                    if (carteValide.length > 0) {
                        const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);
                        if (wantsToWin) {
                            const siamoUltimi = numMancanti === 0;
                            if (carteVincenti.length > 0) {
                                if (siamoUltimi) {
                                    cartaDaGiocare = carteVincenti.sort((a, b) => a.forza - b.forza)[0];
                                } else {
                                    const rischioTaglio = numMancanti * 0.15 * crowdFactor;
                                    if (cons > (80 - rischioTaglio * 100)) {
                                        cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                    } else {
                                        cartaDaGiocare = carteVincenti.sort((a, b) => b.forza - a.forza)[0];
                                    }
                                }
                            } else {
                                cartaDaGiocare = carteValide.sort((a, b) => b.forza - a.forza)[0];
                            }
                        } else {
                            const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                            if (cartePerdenti.length > 0) {
                                cartaDaGiocare = (sca > 50) ? cartePerdenti.sort((a, b) => b.forza - a.forza)[0] : cartePerdenti.sort((a, b) => a.forza - b.forza)[0];
                            } else {
                                cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                            }
                        }
                    } else {
                        if (wantsToWin) {
                            const briscole = manoV.filter(c => c.seme === 'Denari');
                            if (briscole.length > 0) {
                                const forzaBriscolaVincente = (vincenteAttuale.card.seme === 'Denari') ? vincenteAttuale.card.forza : 0;
                                const briscoleUtili = briscole.filter(c => c.forza > forzaBriscolaVincente);
                                if (briscoleUtili.length > 0) {
                                    const siamoUltimi = numMancanti === 0;
                                    const valoreTavolo = game.tavolo.reduce((acc, curr) => acc + (PESO_VALORE[curr.card.valore] >= 10 ? 2 : 1), 0);
                                    const rischioControtaglio = numMancanti * 0.2 * crowdFactor;
                                    if (!siamoUltimi && (cons > (70 - rischioControtaglio * 100)) && valoreTavolo < 2) {
                                        cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                    } else {
                                        cartaDaGiocare = briscoleUtili.sort((a, b) => a.forza - b.forza)[0];
                                    }
                                } else {
                                    cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                }
                            } else {
                                cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                            }
                        } else {
                            cartaDaGiocare = (sca > 30) ? manoV.sort((a, b) => b.forza - a.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                        }
                    }
                }
            } else {
                // Logica Ottimizzata per livelli 3 e 4 (Intermedio ed Esperto)
                if (game.tavolo.length === 0) {
                    if (wantsToWin) {
                        let cartaRegnante = manoV.find(c => {
                            const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                            return superiori.every(sr => game.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                        });
                        if (cartaRegnante) {
                            cartaDaGiocare = cartaRegnante;
                        } else {
                            const nonBriscoleForti = manoV.filter(c => c.seme !== 'Denari' && (c.valore === 'Asso' || c.valore === '3'));
                            if (nonBriscoleForti.length > 0) {
                                cartaDaGiocare = nonBriscoleForti.sort((a, b) => b.forza - a.forza)[0];
                            } else {
                                cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[Math.floor(manoV.length / 2)];
                            }
                        }
                    } else {
                        const nonBriscole = manoV.filter(c => c.seme !== 'Denari');
                        cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                    }
                } else {
                    const semeUscita = game.tavolo[0].card.seme;
                    const carteValide = manoV.filter(c => c.seme === semeUscita);
                    const vincenteAttuale = game.calcolaVincitorePresa();
                    if (carteValide.length > 0) {
                        const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);
                        if (wantsToWin) {
                            if (carteVincenti.length > 0) {
                                const siamoUltimi = numMancanti === 0;
                                if (siamoUltimi) {
                                    cartaDaGiocare = carteVincenti.sort((a, b) => a.forza - b.forza)[0];
                                } else {
                                    const miglioreVincente = carteVincenti.sort((a, b) => b.forza - a.forza)[0];
                                    if (miglioreVincente.valore === 'Asso' || miglioreVincente.valore === '3' || cons < 60) {
                                        cartaDaGiocare = miglioreVincente;
                                    } else {
                                        cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                                    }
                                }
                            } else {
                                cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                            }
                        } else {
                            const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                            if (cartePerdenti.length > 0) {
                                cartaDaGiocare = cartePerdenti.sort((a, b) => b.forza - a.forza)[0];
                            } else {
                                cartaDaGiocare = carteValide.sort((a, b) => a.forza - b.forza)[0];
                            }
                        }
                    } else {
                        if (wantsToWin) {
                            const briscole = manoV.filter(c => c.seme === 'Denari');
                            if (briscole.length > 0) {
                                const forzaBriscolaVincente = (vincenteAttuale.card.seme === 'Denari') ? vincenteAttuale.card.forza : 0;
                                const briscoleUtili = briscole.filter(c => c.forza > forzaBriscolaVincente);
                                if (briscoleUtili.length > 0) {
                                    const siamoUltimi = numMancanti === 0;
                                    const valoreTavolo = game.tavolo.reduce((acc, curr) => acc + (PESO_VALORE[curr.card.valore] >= 10 ? 2 : 1), 0);
                                    if (siamoUltimi || valoreTavolo >= 1 || cons < 50) {
                                        cartaDaGiocare = briscoleUtili.sort((a, b) => a.forza - b.forza)[0];
                                    } else {
                                        cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                                    }
                                } else {
                                    const nonBriscole = game.players[game.turnoAttuale].mano.filter(c => !c.giocata && c.seme !== 'Denari'); // Fix reference: manoV
                                    cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                                }
                            } else {
                                cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                            }
                        } else {
                            const nonBriscole = manoV.filter(c => c.seme !== 'Denari');
                            cartaDaGiocare = nonBriscole.length > 0 ? nonBriscole.sort((a, b) => b.forza - a.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                        }
                    }
                }
            }

            if (!cartaDaGiocare) cartaDaGiocare = manoV[0];

            cartaDaGiocare.giocata = true;
            game.tavolo.push({ playerId: game.turnoAttuale, card: cartaDaGiocare });

            // Risoluzione Presa
            if (game.tavolo.length === game.numPlayers) {
                const vincitore = game.calcolaVincitorePresa();
                const semeUscitaPresa = game.tavolo[0].card.seme;

                // --- LOGGING AI (Bufferizzato) ---
                const historyStr = game.carteUscite.map(c => `${c.valore}-${c.seme}`).join('|');
                const voidStr = game.players.map((pl, i) => pl.voidSuits.length > 0 ? `P${i}:${pl.voidSuits.join('&')}` : "").filter(s => s !== "").join('|');

                game.tavolo.forEach((giocata, indexTavolo) => {
                    const pLog = game.players[giocata.playerId];
                    if (giocata.card.seme !== semeUscitaPresa && !pLog.voidSuits.includes(semeUscitaPresa)) {
                        pLog.voidSuits.push(semeUscitaPresa);
                    }
                    const handPre = pLog.mano.filter(c => !c.giocata).map(c => `${c.valore}-${c.seme}`);
                    handPre.push(`${giocata.card.valore}-${giocata.card.seme}`);
                    const tablePre = game.tavolo.slice(0, indexTavolo).map(t => `${t.card.valore}-${t.card.seme}`).join('|');

                    batchLogs.push({
                        matchId: game.matchId,
                        numPlayers: game.numPlayers,
                        roundCards: game.sequenzaTurni[game.indiceGiro],
                        playerIndex: giocata.playerId,
                        isHuman: false,
                        aiVariant: pLog.aiVariant || "N/A",
                        dichiarazione: pLog.dichiarazione,
                        preseFatte: pLog.preseFatte,
                        obiettivoRimanente: pLog.dichiarazione - pLog.preseFatte,
                        hand: handPre.join('|'),
                        table: tablePre,
                        history: historyStr,
                        voidSuits: voidStr,
                        move: `${giocata.card.valore}-${giocata.card.seme}`,
                        wonTrick: (giocata.playerId === vincitore.playerId)
                    });
                });

                game.players[vincitore.playerId].preseFatte++;
                game.tavolo.forEach(g => game.carteUscite.push(g.card));
                game.tavolo = [];
                game.turnoAttuale = vincitore.playerId;

                // Fine mano?
                if (game.players.every(pl => pl.mano.every(c => c.giocata))) {
                    game.indiceGiro++;
                    game.fase = "fine_giro"; // Questo fa uscire dal ciclo 'while (game.fase === "gioco")'
                }
            } else {
                game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
            }

            // SICUREZZA: Se entra un umano vero mentre simula, interrompi
            const umaniRealiCheck = umaniConnessi - osservatoriAdmin;
            if (umaniRealiCheck > 0) return;
        }
    }

    // SALVATAGGIO IN BLOCCO FINALE
    if (dbConnected && batchLogs.length > 0) {
        MatchLog.insertMany(batchLogs).catch(err => console.error("Errore bulk turbo:", err));
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
    // Avvia il check iniziale dopo 10 secondi
    setTimeout(avviaAutoTraining, 10000);
});
