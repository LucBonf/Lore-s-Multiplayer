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
    lastLogin: { type: Date, default: Date.now }
});

// INDICI PER PERFORMANCE (Classifiche e Ricerche istantanee)
userSchema.index({ punteggioTotale: -1 });
userSchema.index({ elo: -1 });
userSchema.index({ lastLogin: -1 });
userSchema.index({ nickname: 'text' }); // Per ricerca veloce per nome

const User = mongoose.model('User', userSchema);

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
    numPlayers: Number,
    roundCards: Number,
    playerIndex: Number,
    nickname: String,           // Nickname del giocatore al momento della mossa
    isHuman: Boolean,
    elo: { type: Number, default: 1000 },
    aiVariant: { type: String, default: "Human" }, // Es: V4_A80_C20_S50
    dichiarazione: Number,
    preseFatte: Number,
    obiettivoRimanente: Number, // Prese mancanti per fare la dichiarazione
    hand: String,               // Carte in mano separate da |
    table: String,              // Carte già sul tavolo
    history: String,            // Carte già uscite nel giro
    voidSuits: String,          // Info sui semi finiti (es: "P1:Spade,P2:Coppe")
    move: String,               // Carta giocata
    wonTrick: Boolean           // Ha vinto la presa?
});

// INDICI PER PERFORMANCE (Log e Statistiche)
matchLogSchema.index({ timestamp: -1 });
matchLogSchema.index({ matchId: 1 });

const MatchLog = mongoose.model('MatchLog', matchLogSchema);

// --- NUOVO: Schema per Human Logs (Dati reali preziosi) ---
const HumanMatchLog = mongoose.model('HumanMatchLog', matchLogSchema, 'humanlogs');


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
                // LOG AI (100MB - Ripristinato limite per evitare superamento piano gratuito)
                const collectionsMatch = await mongoose.connection.db.listCollections({ name: 'matchlogs' }).toArray();
                if (collectionsMatch.length === 0) {
                    await mongoose.connection.db.createCollection('matchlogs', {
                        capped: true,
                        size: 100 * 1024 * 1024,
                        max: 400000
                    });
                    console.log("📦 Collezione 'matchlogs' (Capped 100MB) creata.");
                } else {
                    // Ridimensioniamo forzatamente al ribasso nel caso in cui fosse stata allargata a 500MB
                    try {
                        await mongoose.connection.db.command({ collMod: 'matchlogs', cappedSize: 100 * 1024 * 1024 });
                        console.log("📦 Collezione 'matchlogs' ridimensionata a 100MB.");
                    } catch(e) {}
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
                    } catch(e) {}
                }

                // HUMAN LOGS (10MB - Dati umani separati)
                const collectionsHuman = await mongoose.connection.db.listCollections({ name: 'humanlogs' }).toArray();
                if (collectionsHuman.length === 0) {
                    await mongoose.connection.db.createCollection('humanlogs', {
                        capped: true,
                        size: 10 * 1024 * 1024,
                        max: 50000
                    });
                    console.log("📦 Collezione 'humanlogs' (Capped) creata.");
                } else {
                    try {
                        await mongoose.connection.db.command({ convertToCapped: 'humanlogs', size: 10 * 1024 * 1024 });
                        console.log("📦 Collezione 'humanlogs' convertita in Capped.");
                    } catch(e) {}
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
        res.json({ success: true, users });
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
        res.json({ success: true, users });
    } catch (e) {
        console.error("Errore rotta all-users:", e);
        res.json({ success: false, error: e.message });
    }
});

// --- NUOVE ROTTE PER REPLAY ---
app.get('/api/replays', async (req, res) => {
    if (!dbConnected) return res.json({ success: false, error: "DB non connesso" });
    try {
        // Recuperiamo le ultime 20 partite distinte dai log umani
        const replays = await HumanMatchLog.aggregate([
            { $sort: { timestamp: -1 } },
            { $group: {
                _id: "$matchId",
                timestamp: { $first: "$timestamp" },
                numPlayers: { $first: "$numPlayers" },
                players: { $addToSet: "$nickname" }
            }},
            { $sort: { timestamp: -1 } },
            { $limit: 20 }
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
            size: 100 * 1024 * 1024,
            max: 400000
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
                    <h2>👤 Gestione Utente</h2>
                    <div style="display:flex; gap:10px; margin-bottom:10px;">
                        <input type="text" id="user-query" placeholder="Nickname o UniqueID..." style="flex-grow:1; padding:8px; border-radius:5px; border:1px solid #444; background:#222; color:white;">
                        <button class="btn" onclick="cercaUtente()">🔍 Cerca</button>
                        <button class="btn" onclick="caricaTuttiUtenti()">📋 Lista Completa</button>
                    </div>
                    <div id="user-info-box" style="display:none; background:rgba(0,0,0,0.3); padding:10px; border-radius:5px; font-size:0.9em; border:1px solid #555; margin-bottom: 10px;">
                        <p><strong>Nome:</strong> <span id="info-nick">-</span></p>
                        <p><strong>ID:</strong> <span id="info-code">-</span></p>
                        <p><strong>Partite:</strong> <span id="info-matches">-</span></p>
                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-danger" id="btn-delete-user" style="flex:1; margin-top:10px;">❌ ELIMINA</button>
                            <button class="btn" id="btn-ban-user" style="flex:1; margin-top:10px; border-color:#e67e22; color:#e67e22;">🚫 BAN & ELIMINA</button>
                        </div>
                    </div>

                    <div id="all-users-container" style="display:none; max-height:400px; overflow-y:auto; border:1px solid #333; margin-top:10px;">
                        <table style="width:100%; border-collapse:collapse; font-size:0.8em;">
                            <thead style="background:#111; position:sticky; top:0;">
                                <tr>
                                    <th style="padding:5px; border:1px solid #333;">Nick</th>
                                    <th style="padding:5px; border:1px solid #333;">Punti</th>
                                    <th style="padding:5px; border:1px solid #333;">ELO</th>
                                    <th style="padding:5px; border:1px solid #333;">Giocate</th>
                                    <th style="padding:5px; border:1px solid #333;">Vinte</th>
                                    <th style="padding:5px; border:1px solid #333;">Last Login</th>
                                </tr>
                            </thead>
                            <tbody id="users-tbody"></tbody>
                        </table>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                    <div>
                        <h3>💾 DATASET TURBO (AI)</h3>
                        <div class="metric">Mosse registrate: ${totaleTurbo.toLocaleString()}</div>
                        <div class="metric">Partite: ${partiteTurbo}</div>
                        <a href="/scarica-dataset-lucas-777?type=turbo" class="btn">SCARICA TURBO CSV</a>
                    </div>
                    <div style="border-left: 1px solid #00ff00; padding-left: 20px;">
                        <h3>💎 DATASET UMANO</h3>
                        <div class="metric">Mosse registrate: ${totaleHuman.toLocaleString()}</div>
                        <div class="metric">Partite: ${partiteHuman}</div>
                        <a href="/scarica-dataset-lucas-777?type=human" class="btn">SCARICA HUMAN CSV</a>
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

                async function cercaUtente() {
                    try {
                        const q = document.getElementById('user-query').value;
                        if (!q) return;
                        const res = await fetch('/api/admin/find-user/' + encodeURIComponent(q));
                        
                        if (res.status === 401) {
                            alert("Sessione scaduta! Ricarica la pagina.");
                            return location.reload();
                        }
                        
                        const data = await res.json();
                        const box = document.getElementById('user-info-box');
                        const resultsContainer = document.getElementById('users-tbody');
                        const resultsWrapper = document.getElementById('all-users-container');
                        
                        if (data.success) {
                            // Se ne trova uno solo, mostriamo il box dettagliato
                            if (data.users.length === 1) {
                                const user = data.users[0];
                                box.style.display = 'block';
                                document.getElementById('info-nick').innerText = user.nickname;
                                document.getElementById('info-code').innerText = user.uniqueCode;
                                document.getElementById('info-matches').innerText = user.partiteGiocate;
                                
                                document.getElementById('btn-delete-user').onclick = () => eseguiAzioneUtente('delete', user);
                                document.getElementById('btn-ban-user').onclick = () => eseguiAzioneUtente('ban', user);
                            } else {
                                // Se ne trova molti, mostriamo la tabella
                                box.style.display = 'none';
                                renderListaUtenti(data.users);
                            }
                        } else {
                            alert("Utente non trovato!");
                            box.style.display = 'none';
                        }
                    } catch(e) { alert("Errore durante la ricerca"); }
                }

                async function eseguiAzioneUtente(tipo, user) {
                    const msg = tipo === 'ban' 
                        ? "ATTENZIONE: Vuoi BANNARTE e ELIMINARE l'utente " + user.nickname + "? Non potrà più registrarsi con questo nome."
                        : "Sei sicuro di voler eliminare l'utente " + user.nickname + "?";
                    
                    if (!confirm(msg)) return;

                    try {
                        const url = tipo === 'ban' ? '/api/admin/ban-user/' : '/api/admin/delete-user/';
                        const res = await fetch(url + user.uniqueCode);
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
                        const lastDate = u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'N/A';
                        const elo = u.elo || 1000;
                        
                        const tdNick = document.createElement('td');
                        tdNick.style = "padding:5px; border:1px solid #333; color:#f1c40f; cursor:pointer;";
                        tdNick.innerText = u.nickname;
                        tdNick.onclick = () => setSearch(u.uniqueCode);
                        
                        const tdPunti = document.createElement('td');
                        tdPunti.style = "padding:5px; border:1px solid #333; text-align:center;";
                        tdPunti.innerText = u.punteggioTotale;
                        
                        const tdElo = document.createElement('td');
                        tdElo.style = "padding:5px; border:1px solid #333; text-align:center; color:#00ff00;";
                        tdElo.innerText = elo;
                        
                        const tdGiocate = document.createElement('td');
                        tdGiocate.style = "padding:5px; border:1px solid #333; text-align:center;";
                        tdGiocate.innerText = u.partiteGiocate;
                        
                        const tdVinte = document.createElement('td');
                        tdVinte.style = "padding:5px; border:1px solid #333; text-align:center;";
                        tdVinte.innerText = u.partiteVinte;
                        
                        const tdData = document.createElement('td');
                        tdData.style = "padding:5px; border:1px solid #333; text-align:center; font-size:0.8em;";
                        tdData.innerText = lastDate;
                        
                        tr.appendChild(tdNick);
                        tr.appendChild(tdPunti);
                        tr.appendChild(tdElo);
                        tr.appendChild(tdGiocate);
                        tr.appendChild(tdVinte);
                        tr.appendChild(tdData);
                        
                        tbody.appendChild(tr);
                    });
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



const SEMI = ["Coppe", "Ori", "Bastoni", "Spade"];
const VALORI = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];
const PESO_SEME = { "Ori": 400, "Spade": 300, "Coppe": 200, "Bastoni": 100 };
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
            // Poiché la "forza" include già il peso assoluto del seme (es. Ori > Spade > Coppe > Bastoni)
            // e del valore della carta, vince semplicemente la carta con la forza maggiore.
            return (attuale.card.forza > migliore.card.forza) ? attuale : migliore;
        });
    }
}

let umaniConnessi = 0;
let osservatoriAdmin = 0;
let isSimulando = false;
let turboEnabled = false; // Interruttore Maestro AI
const lobbies = {};


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
            socket.emit('login_ok', user);
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
                            posizione: count + 1
                        };
                    }
                }
            }
            socket.emit('classifica_dati', { top10, userRank });
        } catch (e) {
            console.error("Errore richiedi_classifica:", e);
        }
    });

    socket.on('crea_lobby', (dati) => {
        try {
            if (!dati || !dati.nome) return socket.emit('errore', "Dati lobby non validi.");
            const code = Math.random().toString(36).substring(2, 6).toUpperCase();
            lobbies[code] = { 
                host: socket.id, 
                parametri: dati, 
                giocatori: [{ 
                    id: socket.id, 
                    nome: dati.nome, 
                    token: dati.token, 
                    uniqueCode: dati.uniqueCode,
                    elo: socket.userElo || 1000 
                }] 
            };
            socket.join(code);
            socket.roomCode = code;
            socket.emit('lobby_creata', { code: code, giocatori: lobbies[code].giocatori });
        } catch (e) {
            console.error("Errore crea_lobby:", e);
        }
    });

    function gestisciRiconnessione(socket, code, token) {
        const lobby = lobbies[code];
        if (!lobby) return socket.emit('riconnessione_fallita');

        let foundLobbyPlayer = lobby.giocatori.find(p => p.token === token);
        if (!foundLobbyPlayer) return socket.emit('riconnessione_fallita');

        foundLobbyPlayer.id = socket.id;
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
        } else {
            io.to(code).emit('aggiorna_lobby', { giocatori: lobby.giocatori, code: code });
        }
    }

    socket.on('riconnetti', (dati) => {
        gestisciRiconnessione(socket, dati.code, dati.token);
    });

    socket.on('unisciti_lobby', (dati) => {
        try {
            if (!dati || !dati.code) return socket.emit('errore', "Codice stanza mancante.");
            const lobby = lobbies[dati.code];
            if (lobby) {
                let existingPlayer = lobby.giocatori.find(p => p.token && p.token === dati.token);
                if (existingPlayer) {
                    return gestisciRiconnessione(socket, dati.code, dati.token);
                }

                if (lobby.giocatori.length >= parseInt(lobby.parametri.numGiocatori)) {
                    return socket.emit('errore', "La lobby è piena!");
                }
                if (lobby.giocatori.find(p => p.id === socket.id)) return;
                lobby.giocatori.push({ 
                    id: socket.id, 
                    nome: dati.nome, 
                    token: dati.token, 
                    uniqueCode: dati.uniqueCode,
                    elo: socket.userElo || 1000 
                });
                socket.join(dati.code);
                socket.roomCode = dati.code;
                io.to(dati.code).emit('aggiorna_lobby', { giocatori: lobby.giocatori, code: dati.code });
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

            // --- FIX: Lasciamo la stanza subito per non ricevere l'aggiornamento di stato successivo ---
            socket.leave(code);
            socket.roomCode = null;

            const lobby = lobbies[code];
            if (lobby) {
                // Rimuovi dalla lobby (lista d'attesa) Test gits
                const idx = lobby.giocatori.findIndex(p => p.id === socket.id);
                if (idx !== -1) lobby.giocatori.splice(idx, 1);

                // Gestione del subentro IA se il gioco è in corso
                if (lobby.gameInstance) {
                    const game = lobby.gameInstance;
                    const p = game.players.find(pl => pl.id === socket.id);
                    if (p) {
                        p.isHuman = false;
                        p.id = null; // Stacca il socketId
                        p.nome += " (Bot)";
                        inviaStato(code);
                        gestisciIA(code);
                    }
                } else {
                    // Se era ancora in lobby, aggiorna gli altri
                    io.to(code).emit('aggiorna_lobby', { giocatori: lobby.giocatori, code: code });
                }
            }
        } catch (e) {
            console.error("Errore esci_partita:", e);
        }
    });

    socket.on('disconnect', () => {
        try {
            console.log(`Giocatore disconnesso: ${socket.id}`);

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
                            
                            // Opzionale: notifichiamo gli altri che il giocatore è in attesa di riconnessione
                            inviaStato(code);

                            setTimeout(() => {
                                const currentLobby = lobbies[code];
                                if (!currentLobby || !currentLobby.gameInstance) return;
                                
                                const p = currentLobby.gameInstance.players.find(pl => pl.token === playerToken);
                                // Se dopo il timeout non si è riconnesso (id è ancora null) ed è ancora umano
                                if (p && p.id === null && p.isHuman) {
                                    p.isHuman = false;
                                    p.nome += " (Bot)";
                                    inviaStato(code);

                                    // Il Bot muove solo se è il suo turno
                                    if (currentLobby.gameInstance.turnoAttuale === currentLobby.gameInstance.players.indexOf(p) && 
                                        currentLobby.gameInstance.tavolo.length < currentLobby.gameInstance.numPlayers) {
                                        gestisciIA(code);
                                    }
                                }
                            }, 8000); // 8 secondi di tolleranza per il refresh
                        }
                    } else {
                        // LOBBY D'ATTESA: Lo rimuoviamo semplicemente prima che inizi
                        lobby.giocatori.splice(index, 1);
                        io.to(code).emit('aggiorna_lobby', { giocatori: lobby.giocatori, code: code });
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
        lobby.gameInstance = new LucasGame(parseInt(lobby.parametri.numGiocatori));
        
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
        
        inviaStato(code);
        gestisciIA(code);
    }

    socket.on('bug_report', async (testo) => {
        try {
            let nick = socket.userNickname || "Sconosciuto";

            // RECUPERO CONTESTO PARTITA (Se presente)
            const roomCode = socket.roomCode;
            const lobby = roomCode ? lobbies[roomCode] : null;
            const matchId = lobby?.gameInstance?.matchId || null;

            // SALVATAGGIO SU DATABASE (Persistente)
            if (dbConnected) {
                const nuovoReport = new Report({
                    nickname: nick,
                    testo: testo.substring(0, 500), // Limite di sicurezza
                    roomCode: roomCode,
                    matchId: matchId
                });
                await nuovoReport.save();
                console.log(`🪲 Report salvato su DB da ${nick} (Match: ${matchId || 'N/A'})`);
            }

            // Backup su file (opzionale, sparirà al commit su Render)
            const fs = require('fs');
            const logEntry = `\n--- BUG REPORT ---\nData: ${new Date().toISOString()}\nUtente: ${nick}\nTesto: ${testo}\n`;
            fs.appendFile('bug_reports.txt', logEntry, (err) => {
                if (err) console.error("Errore backup file:", err);
            });

        } catch (e) {
            console.error("Errore gestione bug_report:", e);
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
            
            inviaStato(code);
            gestisciIA(code);
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

            game.tavolo.forEach((giocata, indexTavolo) => {
                const player = game.players[giocata.playerId];
                const card = giocata.card;
                
                // Se non ha risposto al seme, registriamo il "Void"
                if (card.seme !== semeUscita && !player.voidSuits.includes(semeUscita)) {
                    player.voidSuits.push(semeUscita);
                }

                // Costruiamo la mano che aveva *prima* di giocare questa carta
                const handPreMossa = player.mano.filter(c => !c.giocata).map(c => `${c.valore}-${c.seme}`);
                handPreMossa.push(`${card.valore}-${card.seme}`);

                const tablePreMossa = game.tavolo.slice(0, indexTavolo).map(t => `${t.card.valore}-${t.card.seme}`).join('|');

                const logEntry = new LogModel({
                    matchId: game.matchId,
                    numPlayers: game.numPlayers,
                    roundCards: game.sequenzaTurni[game.indiceGiro],
                    playerIndex: giocata.playerId,
                    nickname: player.nome,
                    isHuman: player.isHuman,
                    elo: player.isHuman ? (player.eloMomentaneo || 1000) : 1000,
                    aiVariant: player.aiVariant || "N/A",
                    dichiarazione: player.dichiarazione,
                    preseFatte: player.preseFatte,
                    obiettivoRimanente: player.dichiarazione - player.preseFatte,
                    hand: handPreMossa.join('|'),
                    table: tablePreMossa,
                    history: historyStr,
                    voidSuits: voidStr,
                    move: `${card.valore}-${card.seme}`,
                    wonTrick: (giocata.playerId === vincitore.playerId)
                });
                logEntry.save().catch(e => console.error("Errore log AI:", e));
            });
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
                p.punti += p.preseFatte + (p.preseFatte === p.dichiarazione ? 8 : 0);
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
                                    if (pl.isHuman && profileMap[pl.uniqueCode]) return profileMap[pl.uniqueCode].elo;
                                    return 1000; // Valore base per bot o guest
                                });
                                const avgOpponentElo = otherElos.reduce((a, b) => a + b, 0) / otherElos.length;

                                // Punteggio basato sulla posizione (1.0 = Primo, 0.0 = Ultimo)
                                const rank = classificaFinale.findIndex(cf => cf.id === p.id);
                                const actualScore = (game.numPlayers - 1 - rank) / (game.numPlayers - 1);

                                // Expected Score (Formula standard ELO)
                                const expectedScore = 1 / (1 + Math.pow(10, (avgOpponentElo - currentElo) / 400));

                                // K-Factor (Più alto per chi ha giocato poche partite)
                                const matchesPlayed = profileMap[p.uniqueCode]?.partiteGiocate || 0;
                                const K = matchesPlayed < 20 ? 40 : 20;

                                // Calcolo variazione base
                                let eloChange = Math.round(K * (actualScore - expectedScore));

                                // BONUS PRECISIONE: +2 punti se hai azzeccato molte scommesse
                                // (Diciamo se hai fatto almeno l'80% dei punti tramite bonus scommessa)
                                // Questo premia la "bravura" oltre alla fortuna delle carte
                                const accuracyRatio = p.punti > 0 ? (p.preseFatte === p.dichiarazione ? 1 : 0) : 0; 
                                // Nota: qui potremmo affinare tenendo traccia dei giri vinti, ma per ora usiamo il finale
                                if (p.preseFatte === p.dichiarazione) eloChange += 2;

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

                io.to(code).emit('fine_partita', classificaFinale);
                return;
            } else {
                game.indiceMazziere = (game.indiceMazziere + 1) % game.numPlayers;
                game.distribuisci();
            }
        }
        inviaStato(code);
        gestisciIA(code);
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
                // SCOMMESSA AVANZATA (Power Scoring)
                let powerScore = 0;
                p.mano.forEach(c => {
                    if (c.valore === 'Asso') powerScore += 135;
                    else if (c.valore === '3') powerScore += 115;
                    else if (['Re', 'Cavallo', 'Fante'].includes(c.valore)) powerScore += 10;
                    else powerScore += 2;

                    if (c.seme === 'Ori') powerScore += 40;
                    if (c.seme === 'Spade') powerScore += 15;
                });

                // --- LOGICA CONTESTUALE (Matrix Training) ---
                // 1. Adattamento al numero di giocatori
                const div = (currentGame.numPlayers <= 3) ? 120 : 150;

                // 2. Adattamento alla posizione (chi parla dopo ha più info)
                const ordineTurno = (currentGame.turnoAttuale - (currentGame.indiceMazziere + 1) + currentGame.numPlayers) % currentGame.numPlayers;
                const posFactor = 0.85 + (ordineTurno / currentGame.numPlayers) * 0.3; // 0.85x per il primo, 1.15x per l'ultimo

                let s = Math.floor((powerScore / div) * posFactor);
                if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);

                if (currentGame.turnoAttuale === currentGame.indiceMazziere && (currentGame.sommaScommesse + s === qta)) {
                    s = (s >= qta / 2) ? s - 1 : s + 1;
                }
                s = Math.max(0, Math.min(s, qta));

                p.dichiarazione = s;
                currentGame.sommaScommesse += s;
                currentGame.turnoAttuale = (currentGame.turnoAttuale + 1) % currentGame.numPlayers;
                if (currentGame.players.every(pl => pl.dichiarazione !== "-")) currentGame.fase = "gioco";

                // Sblocca il flag prima di triggerare il prossimo bot
                currentGame.botThinking = false;
                inviaStato(code);
                gestisciIA(code);
            } else {
                // FASE DI GIOCO: Intelligenza Migliorata Goal-Oriented
                const manoV = p.mano.filter(c => !c.giocata);
                let cartaDaGiocare;
                const vuoleVincere = p.preseFatte < p.dichiarazione;

                if (currentGame.tavolo.length === 0) {
                    // LEAD: Il Bot lancia per primo
                    if (vuoleVincere) {
                        let cartaRegnante = manoV.find(c => {
                            const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                            return superiori.every(sr => currentGame.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                        });
                        cartaDaGiocare = cartaRegnante || manoV.sort((a, b) => b.forza - a.forza)[Math.floor(manoV.length / 2)];
                    } else {
                        cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                    }
                } else {
                    // RISPOSTA: Deve seguire il seme
                    const semeUscita = currentGame.tavolo[0].card.seme;
                    const carteValide = manoV.filter(c => c.seme === semeUscita);

                    if (carteValide.length > 0) {
                        const vincenteAttuale = currentGame.calcolaVincitorePresa();
                        const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);

                        if (vuoleVincere) {
                            cartaDaGiocare = (carteVincenti.length > 0) ? carteVincenti.sort((a, b) => a.forza - b.forza)[0] : carteValide.sort((a, b) => b.forza - a.forza)[0];
                        } else {
                            const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                            cartaDaGiocare = (cartePerdenti.length > 0) ? cartePerdenti.sort((a, b) => b.forza - a.forza)[0] : carteValide.sort((a, b) => a.forza - b.forza)[0];
                        }

                        // ULTIMA SICUREZZA: Se per qualche motivo l'IA ha scelto una carta di seme diverso ma aveva il seme, forziamo il seme.
                        if (cartaDaGiocare.seme !== semeUscita) {
                            console.error(`⚠️ IA Error: Il bot ha provato a giocare ${cartaDaGiocare.seme} invece di ${semeUscita}. Correzione forzata.`);
                            cartaDaGiocare = carteValide[0];
                        }
                    } else {
                        // SCARTO: Non ha il seme. Se vuole perdere, scarta la carta più alta di un altro seme per "scaricarsi".
                        // Se vuole vincere, scarta la più bassa.
                        cartaDaGiocare = vuoleVincere ? manoV.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => b.forza - a.forza)[0];
                    }
                }

                // Sblocca il flag prima di eseguire la mossa (che potrebbe triggerare un altro gestisciIA)
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

                    // Se è il turno "Fronte" e questo giocatore è quello a cui sto inviando i dati...
                    if (qta === 1 && p.id === giocatoreUmano.id) {
                        // ...sostituisco i valori della sua mano con valori fittizi per nasconderli dal Network del browser
                        manoDaInviare = p.mano.map(c => ({ ...c, valore: "?", seme: "?" }));
                    }

                    return {
                        nome: p.nome,
                        punti: p.punti,
                        dichiarazione: p.dichiarazione,
                        prese: p.preseFatte,
                        isMazziere: (i === game.indiceMazziere),
                        socketId: p.id,
                        cartaFronte: (qta === 1) ? p.mano.find(c => !c.giocata) : null,
                        mano: manoDaInviare
                    };
                })
            };
            // Uso io.to(socketId) per mandare il messaggio SOLO a lui
            io.to(giocatoreUmano.id).emit('conferma_inizio_partita', payload);
        });
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
            
            // Logica Bot Scommessa (semplificata per velocità)
            let powerScore = 0;
            p.mano.forEach(c => {
                if (c.valore === 'Asso') powerScore += 135;
                else if (c.valore === '3') powerScore += 115;
                else if (['Re', 'Cavallo', 'Fante'].includes(c.valore)) powerScore += 10;
                else powerScore += 2;
                if (c.seme === 'Ori') powerScore += 40;
                if (c.seme === 'Spade') powerScore += 15;
            });
            const div = (game.numPlayers <= 3) ? 120 : 150;
            const ordineTurno = (game.turnoAttuale - (game.indiceMazziere + 1) + game.numPlayers) % game.numPlayers;
            const posFactor = 0.85 + (ordineTurno / game.numPlayers) * 0.3;
            let s = Math.floor((powerScore / div) * posFactor);
            if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);
            if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                s = (s >= qta / 2) ? s - 1 : s + 1;
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
            
            // --- NUOVO: CROWD FACTOR (Pressione del numero giocatori) ---
            // Più giocatori ci sono, più è probabile che un carico venga "tagliato" da una briscola.
            const crowdFactor = game.numPlayers / 4; // 3 players = 0.75, 8 players = 2.0

            // --- LOGICA GENETICA ---
            if (p.aiLevel === 1) {
                cartaDaGiocare = manoV[Math.floor(Math.random() * manoV.length)];
            } else {
                if (game.tavolo.length === 0) {
                    if (wantsToWin) {
                        // In tavoli affollati, aprire con un carico è rischioso (rischio taglio alto)
                        const riskThreshold = 30 * crowdFactor; 
                        
                        let cartaRegnante = manoV.find(c => {
                            const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                            return superiori.every(sr => game.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                        });

                        if (cartaRegnante && agg > 20) {
                            cartaDaGiocare = cartaRegnante;
                        } else {
                            // Se il tavolo è affollato e non siamo sicuri, giochiamo coperti (carta media/bassa)
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
                    const numMancanti = game.numPlayers - 1 - game.tavolo.length;

                    if (carteValide.length > 0) {
                        const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);
                        if (wantsToWin) {
                            const siamoUltimi = numMancanti === 0;
                            if (carteVincenti.length > 0) {
                                if (siamoUltimi) {
                                    // Se siamo ultimi, usiamo la carta più bassa per vincere (efficienza)
                                    cartaDaGiocare = carteVincenti.sort((a, b) => a.forza - b.forza)[0];
                                } else {
                                    // Se NON siamo ultimi, il rischio che qualcuno dopo di noi tagli è proporzionale a numMancanti
                                    const rischioTaglio = numMancanti * 0.15 * crowdFactor;
                                    if (cons > (80 - rischioTaglio * 100)) {
                                        // Troppo rischioso, giochiamo una carta bassa per ora
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
                        // Non ha il seme: valutiamo il taglio con Ori
                        if (wantsToWin) {
                            const briscole = manoV.filter(c => c.seme === 'Ori');
                            if (briscole.length > 0) {
                                const forzaBriscolaVincente = (vincenteAttuale.card.seme === 'Ori') ? vincenteAttuale.card.forza : 0;
                                const briscoleUtili = briscole.filter(c => c.forza > forzaBriscolaVincente);
                                
                                if (briscoleUtili.length > 0) {
                                    const siamoUltimi = numMancanti === 0;
                                    const valoreTavolo = game.tavolo.reduce((acc, curr) => acc + (PESO_VALORE[curr.card.valore] >= 10 ? 2 : 1), 0);
                                    
                                    // Valutiamo se il gioco vale la candela (il taglio)
                                    // Se mancano molte persone, il rischio che qualcuno controtagli con un Oro più alto è alto
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
