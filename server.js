import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import filter from 'leo-profanity';

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
    lastLogin: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

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
            
            // --- PULIZIA SPECIFICA RICHIESTA: Elimina utenti offensivi e bestemmie ---
            try {
                // Rimuove account che contengono parole inaccettabili (cazzo, hezbollah, o radici di bestemmie)
                const deletedOffensive = await User.deleteMany({ 
                    nickname: { $regex: new RegExp("(cazzo|hezbollah|diocane|porcodio|madonn|dioporco|diop|mailona26|polcodio)", "i") }
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
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.punti = 0;
        this.dichiarazione = "-";
        this.preseFatte = 0;
    }
    resetGiro() {
        this.mano = [];
        this.dichiarazione = "-";
        this.preseFatte = 0;
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

const lobbies = {};

io.on('connection', (socket) => {

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
        }

        if (!dbConnected) {
            // Modalità simulata in assenza di DB
            socket.userUniqueCode = dati.uniqueCode;
            return socket.emit('login_ok', { uniqueCode: dati.uniqueCode, nickname: dati.nickname || "Player", partiteVinte: 0, punteggioTotale: 0 });
        }

        // --- SKIPA IL DB PER GLI OSPITI ---
        if (dati.uniqueCode && dati.uniqueCode.startsWith("GUEST_")) {
            socket.userUniqueCode = dati.uniqueCode;
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
            lobbies[code] = { host: socket.id, parametri: dati, giocatori: [{ id: socket.id, nome: dati.nome, token: dati.token, uniqueCode: dati.uniqueCode }] };
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
                lobby.giocatori.push({ id: socket.id, nome: dati.nome, token: dati.token, uniqueCode: dati.uniqueCode });
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
        }
    });

    function avviaPartita(code) {
        const lobby = lobbies[code];
        if (!lobby || lobby.gameInstance) return;
        lobby.gameInstance = new LucasGame(parseInt(lobby.parametri.numGiocatori));
        lobby.gameInstance.players.forEach((p, i) => {
            if (lobby.giocatori[i]) {
                p.nome = lobby.giocatori[i].nome;
                p.id = lobby.giocatori[i].id;
                p.isHuman = true;
                p.token = lobby.giocatori[i].token;
                p.uniqueCode = lobby.giocatori[i].uniqueCode;
            }
        });
        lobby.gameInstance.distribuisci();
        inviaStato(code);
        gestisciIA(code);
    }

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

            game.players[game.turnoAttuale].dichiarazione = val;
            game.sommaScommesse += val;
            game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
            if (game.players.every(p => p.dichiarazione !== "-")) game.fase = "gioco";
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

    function risolviPresa(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game) return; // Sicurezza anti-crash aggiuntiva

        const vincitore = game.calcolaVincitorePresa();
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

                // --- SALVATAGGIO CLASSIFICHE MONGO DB ---
                if (dbConnected) {
                    const vincitoreAssoluto = classificaFinale[0].punti;
                    game.players.forEach(async (p) => {
                        if (p.isHuman && p.uniqueCode && !p.uniqueCode.startsWith("GUEST_")) {
                            try {
                                let isWinner = (p.punti === vincitoreAssoluto) ? 1 : 0;
                                await User.updateOne(
                                    { uniqueCode: p.uniqueCode },
                                    {
                                        $inc: { partiteGiocate: 1, partiteVinte: isWinner, punteggioTotale: p.punti },
                                        $set: { nickname: p.nome } // Sincronizza eventuale nome in caso sia cambiato globalmente (se permetti update)
                                    }
                                );
                            } catch (e) { console.error("Errore update user stats:", e); }
                        }
                    });
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
        // Impedisce all'IA di agire se: non c'è il gioco, è il turno di un umano, o l'IA sta già elaborando
        if (!game || game.players[game.turnoAttuale].isHuman || game.botThinking) return;

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
