import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
    constructor(id, nome, isHuman = false) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
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

class LoreGame {
    constructor(numPlayers) {
        this.players = Array.from({ length: numPlayers }, (_, i) => new Player(i, `CPU ${i}`));
        this.numPlayers = numPlayers;
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.maxCarte = Math.floor(40 / numPlayers);
        this.indiceGiro = 0;
        this.tavolo = [];
        this.fase = "scommesse";
        this.sommaScommesse = 0;

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
    socket.on('crea_lobby', (dati) => {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        lobbies[code] = { host: socket.id, parametri: dati, giocatori: [{ id: socket.id, nome: dati.nome }] };
        socket.join(code);
        socket.roomCode = code; // Aggiungi questa riga!
        socket.emit('lobby_creata', { code: code, giocatori: lobbies[code].giocatori });
    });

    socket.on('unisciti_lobby', (dati) => {
        const lobby = lobbies[dati.code];
        if (lobby) {
            if (lobby.giocatori.length >= parseInt(lobby.parametri.numGiocatori)) {
                return socket.emit('errore', "La lobby è piena!");
            }
            if (lobby.giocatori.find(p => p.id === socket.id)) return;
            lobby.giocatori.push({ id: socket.id, nome: dati.nome });
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
        lobby.gameInstance = new LoreGame(parseInt(lobby.parametri.numGiocatori));
        lobby.gameInstance.players.forEach((p, i) => {
            if (lobby.giocatori[i]) {
                p.nome = lobby.giocatori[i].nome;
                p.id = lobby.giocatori[i].id;
                p.isHuman = true;
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
        const pIdx = game.turnoAttuale;
        if (!game || game.players[pIdx].id !== socket.id) return;

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
            setTimeout(() => risolviPresa(code), 1200);
        } else {
            game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
            inviaStato(code);
            gestisciIA(code);
        }
    });

    function risolviPresa(code) {
        const game = lobbies[code]?.gameInstance;
        if (!game) return; // Sicurezza anti-crash aggiuntiva

        const vincitore = game.calcolaVincitorePresa();
        game.players[vincitore.playerId].preseFatte++;
        game.tavolo = [];
        game.turnoAttuale = vincitore.playerId;

        // --- FIX 3: Ora la mano finisce SOLO se TUTTI i giocatori hanno davvero giocato tutte le carte ---
        if (game.players.every(p => p.mano.every(c => c.giocata))) {
            game.players.forEach(p => {
                p.punti += p.preseFatte + (p.preseFatte === p.dichiarazione ? 8 : 0);
            });
            game.indiceGiro++;
            if (game.indiceGiro >= game.sequenzaTurni.length) {
                io.to(code).emit('fine_partita', [...game.players].sort((a, b) => b.punti - a.punti));
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
                // SCOMMESSA: Il bot conta quante carte forti ha (Assi, Tre, Re) e scommette di conseguenza
                let s = p.mano.filter(c => c.forza >= 300).length;
                s = Math.min(s, qta); // Non scommette mai più delle carte in mano

                // Vincolo mazziere per i Bot
                if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                    s = (s > 0) ? s - 1 : s + 1;
                }

                p.dichiarazione = s;
                game.sommaScommesse += s;
                game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
                if (game.players.every(pl => pl.dichiarazione !== "-")) game.fase = "gioco";
            } else {
                // FASE DI GIOCO: Intelligenza Migliorata
                const manoV = p.mano.filter(c => !c.giocata);
                let cartaDaGiocare;

                if (game.tavolo.length === 0) {
                    // 1. Il Bot lancia per primo: gioca la sua carta più alta
                    cartaDaGiocare = manoV.reduce((max, c) => (c.forza > max.forza) ? c : max, manoV[0]);
                } else {
                    // 2. Deve rispondere a una carta
                    const semeUscita = game.tavolo[0].card.seme;
                    const carteValide = manoV.filter(c => c.seme === semeUscita); // Obbligo di rispondere al seme

                    if (carteValide.length > 0) {
                        // Ha il seme richiesto! Trova la carta che al momento sta vincendo sul tavolo
                        const vincenteAttuale = game.calcolaVincitorePresa();

                        // Guarda se tra le carte valide ne ha una che batte quella vincente
                        const carteVincenti = carteValide.filter(c => c.forza > vincenteAttuale.card.forza);

                        if (carteVincenti.length > 0) {
                            // Può vincere: gioca la carta PIÙ PICCOLA necessaria per vincere (risparmiando le più forti!)
                            cartaDaGiocare = carteVincenti.reduce((min, c) => (c.forza < min.forza) ? c : min, carteVincenti[0]);
                        } else {
                            // Sa di perdere la presa: gioca la sua carta più inutile di quel seme
                            cartaDaGiocare = carteValide.reduce((min, c) => (c.forza < min.forza) ? c : min, carteValide[0]);
                        }
                    } else {
                        // Non ha il seme richiesto: si libera della carta più debole assoluta che ha in mano
                        cartaDaGiocare = manoV.reduce((min, c) => (c.forza < min.forza) ? c : min, manoV[0]);
                    }
                }

                cartaDaGiocare.giocata = true;
                game.tavolo.push({ playerId: game.turnoAttuale, card: cartaDaGiocare });

                if (game.tavolo.length === game.numPlayers) {
                    inviaStato(code);
                    setTimeout(() => risolviPresa(code), 1400);
                    return;
                }
                game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
            }
            inviaStato(code);
            gestisciIA(code);
        }, 1500); // Ritardo leggermente aumentato per far capire all'umano le mosse
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
