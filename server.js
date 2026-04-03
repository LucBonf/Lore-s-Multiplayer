import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import filter from 'leo-profanity';

// Inizializza il filtro con le lingue supportate
filter.loadDictionary('en');
filter.add(filter.list('it'));
filter.add(filter.list('fr'));
filter.add(filter.list('es'));
filter.add(filter.list('de'));
filter.add(filter.list('pt'));
filter.add(filter.list('ru'));

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
    punteggioTotale: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

let dbConnected = false;
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => { console.log('🔗 Connesso a MongoDB Atlas!'); dbConnected = true; })
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
        mazzo.sort(() => Math.random() - 0.5);
        let qta = this.sequenzaTurni[this.indiceGiro];
        this.players.forEach(p => {
            p.resetGiro();
            for (let i = 0; i < qta; i++) p.mano.push(mazzo.pop());
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
        // Controllo profanità universale
        if (dati.nickname && filter.check(dati.nickname)) {
            return socket.emit('login_err', 'Per favore, usa un nickname rispettoso!');
        }

        if (!dbConnected) {
            // Modalità simulata in assenza di DB
            return socket.emit('login_ok', { uniqueCode: dati.uniqueCode, nickname: dati.nickname || "Player", partiteVinte: 0, punteggioTotale: 0 });
        }

        // --- SKIPA IL DB PER GLI OSPITI ---
        if (dati.uniqueCode && dati.uniqueCode.startsWith("GUEST_")) {
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
                const existingName = await User.findOne({ nickname: { $regex: new RegExp("^" + dati.nickname + "$", "i") } });
                if (existingName) {
                    return socket.emit('login_err', 'Non puoi usare questo username / Hai sbagliato il PIN.');
                }

                user = new User({ uniqueCode: dati.uniqueCode, nickname: dati.nickname });
                await user.save();
            }
            socket.emit('login_ok', user);
        } catch (e) {
            socket.emit('login_err', 'Errore DB: ' + e.message);
        }
    });

    socket.on('richiedi_classifica', async () => {
        if (!dbConnected) return socket.emit('classifica_dati', []);
        try {
            let limit = await User.find().sort({ punteggioTotale: -1 }).limit(10);
            socket.emit('classifica_dati', limit);
        } catch(e) {}
    });

    socket.on('crea_lobby', (dati) => {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        lobbies[code] = { host: socket.id, parametri: dati, giocatori: [{ id: socket.id, nome: dati.nome, token: dati.token, uniqueCode: dati.uniqueCode }] };
        socket.join(code);
        socket.roomCode = code; // Aggiungi questa riga!
        socket.emit('lobby_creata', { code: code, giocatori: lobbies[code].giocatori });
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
            socket.roomCode = dati.code; // Aggiungi questa riga!
            io.to(dati.code).emit('aggiorna_lobby', { giocatori: lobby.giocatori, code: dati.code });
        } else {
            socket.emit('errore', "Codice stanza non valido!");
        }
    });

    socket.on('richiesta_inizio_partita', () => {
        const code = socket.roomCode;
        if (code) avviaPartita(code);
    });

    socket.on('disconnect', () => {
        console.log(`Giocatore disconnesso: ${socket.id}`);

        // Cerchiamo in quale lobby si trovava
        for (const code in lobbies) {
            const lobby = lobbies[code];
            const index = lobby.giocatori.findIndex(p => p.id === socket.id);

            // Se lo troviamo in questa lobby...
            if (index !== -1) {
                if (lobby.gameInstance) {
                    // PARTITA IN CORSO: Trasformiamo in CPU
                    const game = lobby.gameInstance;
                    const playerIndex = game.players.findIndex(p => p.id === socket.id);
                    if (playerIndex !== -1) {
                        game.players[playerIndex].isHuman = false;
                        game.players[playerIndex].nome += " (Bot)";
                        inviaStato(code); // Aggiorna i nomi per gli altri

                        // Il Bot muove solo se è il suo turno e la presa non è in fase di animazione
                        if (game.turnoAttuale === playerIndex && game.tavolo.length < game.numPlayers) {
                            gestisciIA(code);
                        }
                    }
                } else {
                    // LOBBY D'ATTESA: Lo rimuoviamo semplicemente prima che inizi
                    lobby.giocatori.splice(index, 1);
                    io.to(code).emit('aggiorna_lobby', { giocatori: lobby.giocatori, code: code });
                }
                break; // Trovato e gestito, fermiamo il ciclo
            }
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
        const val = parseInt(valRaw);
        const code = socket.roomCode;
        const game = lobbies[code]?.gameInstance;
        if (!game || game.players[game.turnoAttuale].id !== socket.id) return;

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
    });

    socket.on('gioca_carta', (dati) => {
        const code = socket.roomCode;
        const game = lobbies[code]?.gameInstance;
        const pIdx = game?.turnoAttuale;
        if (!game || game.players[pIdx].id !== socket.id) return;
        
        // --- MICRO-RITARDO ANTI-GLITCH ---
        if (!game.acceptInput) return;

        // --- FIX 1: Evita che si giochino carte mentre la presa si sta già chiudendo (ritardo 1.2s) ---
        if (game.tavolo.length >= game.numPlayers) return;

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
                            } catch(e) { console.error("Errore update user stats:", e); }
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
        if (!game || game.players[game.turnoAttuale].isHuman) return;

        setTimeout(() => {
            const p = game.players[game.turnoAttuale];
            const qta = game.sequenzaTurni[game.indiceGiro];

            if (game.fase === "scommesse") {
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
                const div = (game.numPlayers <= 3) ? 120 : 150;
                
                // 2. Adattamento alla posizione (chi parla dopo ha più info)
                const ordineTurno = (game.turnoAttuale - (game.indiceMazziere + 1) + game.numPlayers) % game.numPlayers;
                const posFactor = 0.85 + (ordineTurno / game.numPlayers) * 0.3; // 0.85x per il primo, 1.15x per l'ultimo

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
                
                inviaStato(code);
                gestisciIA(code);
            } else {
                // FASE DI GIOCO: Intelligenza Migliorata Goal-Oriented
                const manoV = p.mano.filter(c => !c.giocata);
                let cartaDaGiocare;
                const vuoleVincere = p.preseFatte < p.dichiarazione;

                if (game.tavolo.length === 0) {
                    // LEAD: Il Bot lancia per primo
                    if (vuoleVincere) {
                        let cartaRegnante = manoV.find(c => {
                            const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                            return superiori.every(sr => game.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                        });
                        cartaDaGiocare = cartaRegnante || manoV.sort((a, b) => b.forza - a.forza)[Math.floor(manoV.length / 2)];
                    } else {
                        cartaDaGiocare = manoV.sort((a, b) => a.forza - b.forza)[0];
                    }
                } else {
                    // RISPOSTA: Deve seguire il seme
                    const semeUscita = game.tavolo[0].card.seme;
                    const carteValide = manoV.filter(c => c.seme === semeUscita);

                    if (carteValide.length > 0) {
                        const vincenteAttuale = game.calcolaVincitorePresa();
                        const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);

                        if (vuoleVincere) {
                            cartaDaGiocare = (carteVincenti.length > 0) ? carteVincenti.sort((a, b) => a.forza - b.forza)[0] : carteValide.sort((a, b) => b.forza - a.forza)[0];
                        } else {
                            const cartePerdenti = carteValide.filter(c => c.forza < vincenteAttuale.card.forza);
                            cartaDaGiocare = (cartePerdenti.length > 0) ? cartePerdenti.sort((a, b) => b.forza - a.forza)[0] : carteValide.sort((a, b) => a.forza - b.forza)[0];
                        }
                    } else {
                        // SCARTO: Non ha il seme
                        cartaDaGiocare = vuoleVincere ? manoV.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => b.forza - a.forza)[0];
                    }
                }

                cartaDaGiocare.giocata = true;
                game.tavolo.push({ playerId: game.turnoAttuale, card: cartaDaGiocare });

                if (game.tavolo.length === game.numPlayers) {
                    inviaStato(code);
                    setTimeout(() => risolviPresa(code), 1500);
                } else {
                    game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
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
