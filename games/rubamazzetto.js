// =============================================
// RUBAMAZZETTO - LOGICA DI GIOCO COMPLETA (SERVER)
// =============================================

const SEMI = ["Coppe", "Denari", "Bastoni", "Spade"];
const VALORI = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];

const VALORE_NOMINALE = {
    "Asso": 1, "2": 2, "3": 3, "4": 4, "5": 5,
    "6": 6, "7": 7, "Fante": 8, "Cavallo": 9, "Re": 10
};

function valoreNominale(valore) {
    return VALORE_NOMINALE[valore] || 0;
}

function trovaCombinazioniSomma(carteTavolo, target) {
    const ris = [];
    function backtrack(start, combinazione, somma) {
        if (somma === target) {
            ris.push([...combinazione]);
            return;
        }
        if (somma > target) return;
        for (let i = start; i < carteTavolo.length; i++) {
            combinazione.push(carteTavolo[i]);
            backtrack(i + 1, combinazione, somma + valoreNominale(carteTavolo[i].valore));
            combinazione.pop();
        }
    }
    backtrack(0, [], 0);
    return ris;
}

class RubamazzettoPlayer {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.mazzetto = [];       // Carte catturate nel proprio mazzetto
        this.cimaMazzetto = null;  // Ultima carta presa (visibile a tutti!)
        this.puntiSmazzata = 0;   // Carte nel mazzetto a fine smazzata
        this.puntiTotali = 0;     // Cumulativo se si gioca a più smazzate
        this.eloMomentaneo = 1000;
        this.aiLevel = 0;
    }

    resetSmazzata() {
        this.mano = [];
        this.mazzetto = [];
        this.cimaMazzetto = null;
        this.puntiSmazzata = 0;
    }
}

class RubamazzettoGame {
    constructor(numPlayers = 2, limitePunti = 40) {
        this.numPlayers = numPlayers; // da 2 a 4 giocatori
        this.limitePunti = limitePunti;
        this.players = Array.from({ length: numPlayers }, (_, i) => new RubamazzettoPlayer(i, `CPU ${i}`));
        this.mazzo = [];
        this.tavolo = [];
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.turnoAttuale = 0;
        this.ultimoPresista = -1;
        this.smazzataNum = 1;
        this.distribuzioneNum = 1;
        this.fase = "gioco"; // "gioco" | "fine_partita"
        this.botThinking = false;
        this.matchId = null;
        this.hostNickname = null;
    }

    creaMazzo() {
        const m = [];
        for (let s of SEMI) {
            for (let v of VALORI) {
                m.push({ valore: v, seme: s, giocata: false });
            }
        }
        for (let i = m.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [m[i], m[j]] = [m[j], m[i]];
        }
        return m;
    }

    distribuisciIniziale() {
        this.mazzo = this.creaMazzo();
        this.tavolo = [this.mazzo.pop(), this.mazzo.pop(), this.mazzo.pop(), this.mazzo.pop()];
        this.players.forEach(p => p.resetSmazzata());
        this.distribuzioneNum = 1;
        this.ultimoPresista = -1;

        this.distribuisciMano();
        this.turnoAttuale = (this.indiceMazziere + 1) % this.numPlayers;
        this.fase = "gioco";
    }

    distribuisciMano() {
        for (let i = 0; i < 3; i++) {
            for (let p of this.players) {
                if (this.mazzo.length > 0) {
                    p.mano.push(this.mazzo.pop());
                }
            }
        }
    }

    giocaCarta(playerIdx, cartaIdx) {
        const p = this.players[playerIdx];
        if (!p || cartaIdx < 0 || cartaIdx >= p.mano.length) return null;

        const cartaGiocata = p.mano.splice(cartaIdx, 1)[0];
        const vGiocata = valoreNominale(cartaGiocata.valore);

        let tipoAzione = "scarto"; // "ruba" | "presa_tavolo" | "scarto"
        let vittimaFurtoId = -1;
        let carteCoinvolte = [];

        // 1. Controlla prima se può RUBARE il mazzetto a un avversario
        // Trova avversari che hanno una cimaMazzetto con lo stesso valore
        const bersagliRubabili = [];
        this.players.forEach((avv, idx) => {
            if (idx !== playerIdx && avv.cimaMazzetto && valoreNominale(avv.cimaMazzetto.valore) === vGiocata) {
                bersagliRubabili.push(avv);
            }
        });

        if (bersagliRubabili.length > 0) {
            // Ruba al giocatore che ha il mazzetto più ricco
            bersagliRubabili.sort((a, b) => b.mazzetto.length - a.mazzetto.length);
            const vittima = bersagliRubabili[0];
            vittimaFurtoId = vittima.id;

            tipoAzione = "ruba";
            carteCoinvolte = [...vittima.mazzetto, cartaGiocata];
            p.mazzetto.push(...vittima.mazzetto, cartaGiocata);
            p.cimaMazzetto = cartaGiocata;

            // Il mazzetto della vittima viene svuotato
            vittima.mazzetto = [];
            vittima.cimaMazzetto = null;
            this.ultimoPresista = playerIdx;
        } else {
            // 2. Altrimenti, controlla se c'è presa dal tavolo
            // 2a. Carta singola di pari valore sul tavolo
            const matchSingoloIdx = this.tavolo.findIndex(c => valoreNominale(c.valore) === vGiocata);
            if (matchSingoloIdx !== -1) {
                const cartaPresa = this.tavolo.splice(matchSingoloIdx, 1)[0];
                tipoAzione = "presa_tavolo";
                carteCoinvolte = [cartaPresa, cartaGiocata];
                p.mazzetto.push(cartaPresa, cartaGiocata);
                p.cimaMazzetto = cartaGiocata;
                this.ultimoPresista = playerIdx;
            } else {
                // 2b. Combinazione di carte sul tavolo la cui somma fa il valore della carta
                const comb = trovaCombinazioniSomma(this.tavolo, vGiocata);
                if (comb.length > 0) {
                    // Prendi la combinazione con più carte
                    comb.sort((a, b) => b.length - a.length);
                    const scelta = comb[0];
                    for (let c of scelta) {
                        const idx = this.tavolo.findIndex(tc => tc.valore === c.valore && tc.seme === c.seme);
                        if (idx !== -1) this.tavolo.splice(idx, 1);
                    }
                    tipoAzione = "presa_tavolo";
                    carteCoinvolte = [...scelta, cartaGiocata];
                    p.mazzetto.push(...scelta, cartaGiocata);
                    p.cimaMazzetto = cartaGiocata;
                    this.ultimoPresista = playerIdx;
                } else {
                    // 3. Nessuna presa o furto possibile: scarto sul tavolo
                    this.tavolo.push(cartaGiocata);
                    tipoAzione = "scarto";
                    carteCoinvolte = [cartaGiocata];
                }
            }
        }

        return {
            cartaGiocata,
            tipoAzione,
            vittimaFurtoId,
            carteCoinvolte
        };
    }

    verificaAvanzamentoMano() {
        const tuttiSenzaCarte = this.players.every(p => p.mano.length === 0);
        if (!tuttiSenzaCarte) {
            this.turnoAttuale = (this.turnoAttuale + 1) % this.numPlayers;
            return { smazzataFinita: false, nuovaManoDistribuita: false };
        }

        // Tutti hanno giocato le 3 carte:
        if (this.mazzo.length > 0) {
            this.distribuzioneNum++;
            this.distribuisciMano();
            this.turnoAttuale = (this.turnoAttuale + 1) % this.numPlayers;
            return { smazzataFinita: false, nuovaManoDistribuita: true };
        } else {
            // Fine smazzata!
            // L'ultimo che ha preso raccoglie le carte residue sul tavolo
            if (this.tavolo.length > 0 && this.ultimoPresista !== -1) {
                const ultP = this.players[this.ultimoPresista];
                if (ultP) {
                    ultP.mazzetto.push(...this.tavolo);
                }
                this.tavolo = [];
            }
            return { smazzataFinita: true, nuovaManoDistribuita: false };
        }
    }

    calcolaClassificaFinale() {
        this.players.forEach(p => {
            p.puntiSmazzata = p.mazzetto.length;
            p.puntiTotali += p.puntiSmazzata;
        });

        const classifica = [...this.players].sort((a, b) => b.puntiSmazzata - a.puntiSmazzata);
        const isPareggio = (classifica.length > 1 && classifica[0].puntiSmazzata === classifica[1].puntiSmazzata);
        const vincitoreId = isPareggio ? null : classifica[0].id;
        return { classifica, vincitoreId, isPareggio };
    }

    scegliMossaIA(playerIdx) {
        const p = this.players[playerIdx];
        if (!p || p.mano.length === 0) return 0;

        let migliorIdx = 0;
        let punteggioMigliore = -999;

        p.mano.forEach((carta, idx) => {
            let score = 0;
            const v = valoreNominale(carta.valore);

            // 1. Opportunità di furto (priorità massima!)
            const bersagli = this.players.filter((avv, i) => i !== playerIdx && avv.cimaMazzetto && valoreNominale(avv.cimaMazzetto.valore) === v);
            if (bersagli.length > 0) {
                const maxRubate = Math.max(...bersagli.map(b => b.mazzetto.length));
                score += 100 + maxRubate * 3;
            } else {
                // 2. Presa dal banco
                const matchSingolo = this.tavolo.some(c => valoreNominale(c.valore) === v);
                if (matchSingolo) {
                    score += 40;
                } else {
                    const comb = trovaCombinazioniSomma(this.tavolo, v);
                    if (comb.length > 0) {
                        score += 30 + comb[0].length * 5;
                    } else {
                        // 3. Scarto: valuta quale carta è meno pericolosa da lasciare
                        score -= 10;
                    }
                }
            }

            if (score > punteggioMigliore) {
                punteggioMigliore = score;
                migliorIdx = idx;
            }
        });

        return migliorIdx;
    }
}

export {
    RubamazzettoGame,
    RubamazzettoPlayer,
    valoreNominale,
    SEMI,
    VALORI
};
