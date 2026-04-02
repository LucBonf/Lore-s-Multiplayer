import fs from 'fs';

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
    constructor(id, nome, isSmart = true) {
        this.id = id;
        this.nome = nome;
        this.isSmart = isSmart;
        this.mano = [];
        this.punti = 0;
        this.dichiarazione = "-";
        this.preseFatte = 0;
        
        // Statistiche aggiuntive
        this.dichiarazioniAzzeccate = 0;
        this.totaleManiGiocate = 0;
    }
    resetGiro() {
        this.mano = [];
        this.dichiarazione = "-";
        this.preseFatte = 0;
    }
}

class LucasGame {
    constructor(numPlayers) {
        this.players = Array.from({ length: numPlayers }, (_, i) => new Player(i, i === 0 ? 'Random' : `Smart ${i}`, i !== 0));
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
        seq.push(1);
        this.sequenzaTurni = seq;
        this.turnoAttuale = (this.indiceMazziere + 1) % numPlayers;
        this.carteUscite = [];
    }

    distribuisci() {
        let mazzo = [];
        SEMI.forEach(s => VALORI.forEach(v => mazzo.push(new Card(v, s))));
        mazzo.sort(() => Math.random() - 0.5);
        let qta = this.sequenzaTurni[this.indiceGiro];
        this.players.forEach(p => {
            p.resetGiro();
            p.totaleManiGiocate++;
            for (let i = 0; i < qta; i++) p.mano.push(mazzo.pop());
        });
        this.fase = "scommesse";
        this.turnoAttuale = (this.indiceMazziere + 1) % this.players.length;
        this.sommaScommesse = 0;
        this.tavolo = [];
        this.carteUscite = [];
    }

    calcolaVincitorePresa() {
        return this.tavolo.reduce((migliore, attuale) => {
            return (attuale.card.forza > migliore.card.forza) ? attuale : migliore;
        });
    }
}

function runDeepSimulations() {
    console.log("=== LUCAS AI DEEP ANALYSIS: SMART vs RANDOM ===");
    console.log("Testando su 10.000 iterazioni per configurazione... Si prega di attendere.\n");
    
    let results = [];
    
    for (let num of [3, 4, 8]) {
        let winsRandom = 0;
        let winsSmart = 0;
        
        let smartAzzeccate = 0;
        let smartTotali = 0;
        let randomAzzeccate = 0;
        let randomTotali = 0;

        let matches = 100000;
        
        for (let sim = 0; sim < matches; sim++) {
            let game = new LucasGame(num);
            game.distribuisci();
            
            let abortSafety = 0;
            while(true) {
                abortSafety++;
                if(abortSafety > 10000) process.exit(1);

                if (game.indiceGiro >= game.sequenzaTurni.length) {
                    let maxPunti = Math.max(...game.players.map(p => p.punti));
                    let vincitori = game.players.filter(p => p.punti === maxPunti);
                    
                    if (vincitori.some(p => !p.isSmart)) winsRandom++;
                    if (vincitori.some(p => p.isSmart)) winsSmart++;
                    break;
                }

                const p = game.players[game.turnoAttuale];
                const qta = game.sequenzaTurni[game.indiceGiro];

                if (game.fase === "scommesse") {
                    let s = 0;
                    if (p.isSmart) {
                        let powerScore = 0;
                        p.mano.forEach(c => {
                            if (c.valore === 'Asso') powerScore += 90;
                            else if (c.valore === '3') powerScore += 75;
                            else if (['Re', 'Cavallo', 'Fante'].includes(c.valore)) powerScore += 50;
                            else powerScore += 20;
                            if (c.seme === 'Ori') powerScore += 40;
                            if (c.seme === 'Spade') powerScore += 25;
                        });
                        s = Math.floor(powerScore / 115);
                        if (qta >= 6 && s > qta * 0.7) s = Math.ceil(qta * 0.6);
                    } else {
                        s = Math.floor(Math.random() * (qta + 1));
                    }
                    
                    if (game.turnoAttuale === game.indiceMazziere && (game.sommaScommesse + s === qta)) {
                        s = (s >= qta / 2) ? s - 1 : s + 1;
                    }
                    s = Math.max(0, Math.min(s, qta));
                    
                    p.dichiarazione = s;
                    game.sommaScommesse += s;
                    game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
                    if (game.players.every(pl => pl.dichiarazione !== "-")) game.fase = "gioco";
                } else {
                    const manoV = p.mano.filter(c => !c.giocata);
                    let cartaDaGiocare;
                    
                    if (!p.isSmart) {
                        if (game.tavolo.length > 0) {
                            let seme = game.tavolo[0].card.seme;
                            let valide = manoV.filter(c => c.seme === seme);
                            if (valide.length > 0) cartaDaGiocare = valide[Math.floor(Math.random() * valide.length)];
                            else cartaDaGiocare = manoV[Math.floor(Math.random() * manoV.length)];
                        } else {
                            cartaDaGiocare = manoV[Math.floor(Math.random()*manoV.length)];
                        }
                    } else {
                        // SMART AI PLAY
                        const vuoleVincere = p.preseFatte < p.dichiarazione;
                        if (game.tavolo.length === 0) {
                            let cartaRegnante = manoV.find(c => {
                                const superiori = VALORI.filter(v => PESO_VALORE[v] > PESO_VALORE[c.valore]).map(v => new Card(v, c.seme));
                                return superiori.every(sr => game.carteUscite.some(cu => cu.seme === sr.seme && cu.valore === sr.valore));
                            });
                            cartaDaGiocare = cartaRegnante || manoV.sort((a, b) => b.forza - a.forza)[Math.floor(manoV.length / 2)];
                        } else {
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
                                cartaDaGiocare = vuoleVincere ? manoV.sort((a, b) => a.forza - b.forza)[0] : manoV.sort((a, b) => a.forza - b.forza)[0];
                            }
                        }
                    }

                    cartaDaGiocare.giocata = true;
                    game.tavolo.push({ playerId: game.turnoAttuale, card: cartaDaGiocare });

                    if (game.tavolo.length === game.numPlayers) {
                        const vincitore = game.calcolaVincitorePresa();
                        game.players[vincitore.playerId].preseFatte++;
                        game.tavolo.forEach(gt => game.carteUscite.push(gt.card));
                        game.tavolo = [];
                        game.turnoAttuale = vincitore.playerId;

                        if (game.players.every(pl => pl.mano.every(c => c.giocata))) {
                            game.players.forEach(pl => {
                                let successo = pl.preseFatte === pl.dichiarazione;
                                pl.punti += pl.preseFatte + (successo ? 8 : 0);
                                
                                if (pl.isSmart) {
                                    smartTotali++;
                                    if (successo) smartAzzeccate++;
                                } else {
                                    randomTotali++;
                                    if (successo) randomAzzeccate++;
                                }
                            });
                            
                            game.indiceGiro++;
                            if (game.indiceGiro < game.sequenzaTurni.length) {
                                game.indiceMazziere = (game.indiceMazziere + 1) % game.numPlayers;
                                game.distribuisci();
                            }
                        }
                    } else {
                        game.turnoAttuale = (game.turnoAttuale + 1) % game.numPlayers;
                    }
                }
            }
        }
        results.push({ 
            "Giocatori": num, 
            "Partite Giocate": matches,
            "Successo Prese IA (%)": `${((smartAzzeccate/smartTotali)*100).toFixed(1)}%`,
            "Successo Prese Umano-Sim (%)": `${((randomAzzeccate/randomTotali)*100).toFixed(1)}%`,
            "Partite Vinte IA": `${((winsSmart/matches)*100).toFixed(1)}%`
        });
    }
    console.table(results);
}

runDeepSimulations();
