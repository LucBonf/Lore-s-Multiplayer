// =============================================
// SCOPA - LOGICA DI GIOCO COMPLETA (SERVER)
// =============================================

const SEMI = ["Coppe", "Denari", "Bastoni", "Spade"];
const VALORI = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];

const VALORE_NOMINALE = {
    "Asso": 1, "2": 2, "3": 3, "4": 4, "5": 5,
    "6": 6, "7": 7, "Fante": 8, "Cavallo": 9, "Re": 10
};

const VALORE_PRIMIERA = {
    "7": 21, "6": 18, "Asso": 16, "5": 15,
    "4": 14, "3": 13, "2": 12, "Re": 10, "Cavallo": 10, "Fante": 10
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

function calcolaPresaScopa(cartaGiocata, carteTavolo) {
    const vGiocata = valoreNominale(cartaGiocata.valore);

    // 1. Regola presa singola obbligatoria:
    // Se c'è una carta dello stesso valore, si DEVE prendere la singola
    const singole = carteTavolo.filter(c => valoreNominale(c.valore) === vGiocata);
    if (singole.length > 0) {
        // Se ce n'è più di una, preferisci il Settebello o carte di Denari
        singole.sort((a, b) => {
            if (a.valore === '7' && a.seme === 'Denari') return -1;
            if (b.valore === '7' && b.seme === 'Denari') return 1;
            if (a.seme === 'Denari' && b.seme !== 'Denari') return -1;
            if (b.seme === 'Denari' && a.seme !== 'Denari') return 1;
            return 0;
        });
        return { presaPossibile: true, tipo: 'singola', cartePrese: [singole[0]] };
    }

    // 2. Presa per somma di due o più carte
    const comb = trovaCombinazioniSomma(carteTavolo, vGiocata);
    if (comb.length > 0) {
        // Ordina combinazioni per valore strategico (Settebello > Denari > maggior numero di carte)
        comb.sort((c1, c2) => {
            const haSettebello1 = c1.some(c => c.valore === '7' && c.seme === 'Denari') ? 1 : 0;
            const haSettebello2 = c2.some(c => c.valore === '7' && c.seme === 'Denari') ? 1 : 0;
            if (haSettebello1 !== haSettebello2) return haSettebello2 - haSettebello1;

            const denari1 = c1.filter(c => c.seme === 'Denari').length;
            const denari2 = c2.filter(c => c.seme === 'Denari').length;
            if (denari1 !== denari2) return denari2 - denari1;

            return c2.length - c1.length;
        });
        return { presaPossibile: true, tipo: 'somma', cartePrese: comb[0] };
    }

    return { presaPossibile: false, tipo: 'nessuna', cartePrese: [] };
}

function calcolaPrimiera(prese) {
    const migliori = { Denari: 0, Spade: 0, Coppe: 0, Bastoni: 0 };
    for (let c of prese) {
        const val = VALORE_PRIMIERA[c.valore] || 0;
        if (val > migliori[c.seme]) {
            migliori[c.seme] = val;
        }
    }
    const semiMancanti = Object.values(migliori).filter(v => v === 0).length;
    const totale = migliori.Denari + migliori.Spade + migliori.Coppe + migliori.Bastoni;
    return { totale, semiMancanti, migliori };
}

class ScopaPlayer {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.prese = []; // Tutte le carte catturate
        this.scope = 0;  // Numero di scope fatte nella smazzata
        this.puntiSmazzata = 0;
        this.puntiTotali = 0;
        this.dettaglioPuntiSmazzata = null;
        this.eloMomentaneo = 1000;
        this.aiLevel = 0;
    }

    resetSmazzata() {
        this.mano = [];
        this.prese = [];
        this.scope = 0;
        this.puntiSmazzata = 0;
        this.dettaglioPuntiSmazzata = null;
    }
}

class ScopaGame {
    constructor(numPlayers = 2, limitePunti = 11) {
        this.numPlayers = numPlayers; // tipicamente 2 (o 4)
        this.limitePunti = limitePunti;
        this.players = Array.from({ length: numPlayers }, (_, i) => new ScopaPlayer(i, `CPU ${i}`));
        this.mazzo = [];
        this.tavolo = []; // Carte scoperte sul tavolo
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.turnoAttuale = 0;
        this.ultimoPresista = -1;
        this.smazzataNum = 1;
        this.distribuzioneNum = 1; // Mani da 3 carte (1..6 a 2 giocatori)
        this.fase = "gioco"; // "gioco" | "fine_smazzata" | "fine_partita"
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
        // Shuffle
        for (let i = m.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [m[i], m[j]] = [m[j], m[i]];
        }
        return m;
    }

    distribuisciIniziale() {
        let mazzoValido = false;
        while (!mazzoValido) {
            this.mazzo = this.creaMazzo();
            // 4 carte sul banco
            this.tavolo = [this.mazzo.pop(), this.mazzo.pop(), this.mazzo.pop(), this.mazzo.pop()];
            // Regola tradizionale Scopa: se sul tavolo ci sono 3 o 4 Re, si rimescola
            const numRe = this.tavolo.filter(c => c.valore === 'Re').length;
            if (numRe < 3) {
                mazzoValido = true;
            }
        }

        this.players.forEach(p => p.resetSmazzata());
        this.distribuzioneNum = 1;
        this.ultimoPresista = -1;

        // Distribuisci 3 carte a testa
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
        const esitoPresa = calcolaPresaScopa(cartaGiocata, this.tavolo);

        let isScopa = false;
        let carteCatturate = [];

        if (esitoPresa.presaPossibile) {
            // Rimuovi dal tavolo le carte prese
            for (let cPresa of esitoPresa.cartePrese) {
                const idx = this.tavolo.findIndex(tc => tc.valore === cPresa.valore && tc.seme === cPresa.seme);
                if (idx !== -1) {
                    this.tavolo.splice(idx, 1);
                }
            }
            carteCatturate = [...esitoPresa.cartePrese, cartaGiocata];
            p.prese.push(...carteCatturate);
            this.ultimoPresista = playerIdx;

            // Verifica Scopa: tavolo vuoto e NON è l'ultimissima carta della smazzata
            const isUltimaCartaAssoluta = (this.mazzo.length === 0 && this.players.every(pl => pl.mano.length === 0));
            if (this.tavolo.length === 0 && !isUltimaCartaAssoluta) {
                p.scope++;
                isScopa = true;
            }
        } else {
            // Carta non prende: resta sul tavolo
            this.tavolo.push(cartaGiocata);
        }

        return {
            cartaGiocata,
            presa: esitoPresa.presaPossibile,
            tipoPresa: esitoPresa.tipo,
            cartePrese: carteCatturate,
            isScopa
        };
    }

    verificaAvanzamentoMano() {
        const tuttiSenzaCarte = this.players.every(p => p.mano.length === 0);
        if (!tuttiSenzaCarte) {
            this.turnoAttuale = (this.turnoAttuale + 1) % this.numPlayers;
            return { smazzataFinita: false, nuovaManoDistribuita: false };
        }

        // Se tutti hanno finito le carte della mano:
        if (this.mazzo.length > 0) {
            // Distribuisci altre 3 carte
            this.distribuzioneNum++;
            this.distribuisciMano();
            this.turnoAttuale = (this.turnoAttuale + 1) % this.numPlayers;
            return { smazzataFinita: false, nuovaManoDistribuita: true };
        } else {
            // Mazzo esaurito: la smazzata è terminata!
            // L'ultimo che ha preso prende le carte rimaste sul tavolo (senza scopa)
            if (this.tavolo.length > 0 && this.ultimoPresista !== -1) {
                const ultP = this.players[this.ultimoPresista];
                if (ultP) {
                    ultP.prese.push(...this.tavolo);
                }
                this.tavolo = [];
            }
            return { smazzataFinita: true, nuovaManoDistribuita: false };
        }
    }

    calcolaPunteggiSmazzata() {
        // Punti tradizionali Scopa:
        // 1. Scope (1 punto per scopa)
        // 2. Carte (chi ha > 20 carte, a 2 giocatori)
        // 3. Denari (chi ha > 5 carte di denari)
        // 4. Settebello (chi ha il 7 di Denari)
        // 5. Primiera

        const p0 = this.players[0];
        const p1 = this.players[1];

        // 1. Scope
        p0.puntiSmazzata = p0.scope;
        p1.puntiSmazzata = p1.scope;

        const dett0 = { scope: p0.scope, carte: 0, denari: 0, settebello: 0, primiera: 0 };
        const dett1 = { scope: p1.scope, carte: 0, denari: 0, settebello: 0, primiera: 0 };

        // 2. Carte (> 20)
        if (p0.prese.length > p1.prese.length && p0.prese.length > 20) {
            p0.puntiSmazzata += 1;
            dett0.carte = 1;
        } else if (p1.prese.length > p0.prese.length && p1.prese.length > 20) {
            p1.puntiSmazzata += 1;
            dett1.carte = 1;
        }

        // 3. Denari (> 5)
        const denari0 = p0.prese.filter(c => c.seme === 'Denari').length;
        const denari1 = p1.prese.filter(c => c.seme === 'Denari').length;
        if (denari0 > denari1 && denari0 > 5) {
            p0.puntiSmazzata += 1;
            dett0.denari = 1;
        } else if (denari1 > denari0 && denari1 > 5) {
            p1.puntiSmazzata += 1;
            dett1.denari = 1;
        }

        // 4. Settebello
        const haSettebello0 = p0.prese.some(c => c.valore === '7' && c.seme === 'Denari');
        const haSettebello1 = p1.prese.some(c => c.valore === '7' && c.seme === 'Denari');
        if (haSettebello0) {
            p0.puntiSmazzata += 1;
            dett0.settebello = 1;
        } else if (haSettebello1) {
            p1.puntiSmazzata += 1;
            dett1.settebello = 1;
        }

        // 5. Primiera
        const prim0 = calcolaPrimiera(p0.prese);
        const prim1 = calcolaPrimiera(p1.prese);

        if (prim0.semiMancanti === 0 && prim1.semiMancanti > 0) {
            p0.puntiSmazzata += 1;
            dett0.primiera = 1;
        } else if (prim1.semiMancanti === 0 && prim0.semiMancanti > 0) {
            p1.puntiSmazzata += 1;
            dett1.primiera = 1;
        } else if (prim0.semiMancanti === prim1.semiMancanti) {
            if (prim0.totale > prim1.totale) {
                p0.puntiSmazzata += 1;
                dett0.primiera = 1;
            } else if (prim1.totale > prim0.totale) {
                p1.puntiSmazzata += 1;
                dett1.primiera = 1;
            }
        }

        p0.puntiTotali += p0.puntiSmazzata;
        p1.puntiTotali += p1.puntiSmazzata;
        p0.dettaglioPuntiSmazzata = dett0;
        p1.dettaglioPuntiSmazzata = dett1;

        // Verifica vittoria: qualcuno ha raggiunto o superato il limite (11 o 21 pt)
        let gameOver = false;
        let vincitoreId = -1;

        const maxPunti = Math.max(p0.puntiTotali, p1.puntiTotali);
        if (maxPunti >= this.limitePunti && p0.puntiTotali !== p1.puntiTotali) {
            gameOver = true;
            vincitoreId = (p0.puntiTotali > p1.puntiTotali) ? p0.id : p1.id;
        }

        return { gameOver, vincitoreId, dett0, dett1, denari0, denari1, prim0, prim1 };
    }

    scegliMossaIA(playerIdx) {
        const p = this.players[playerIdx];
        if (!p || p.mano.length === 0) return null;

        // Valuta ogni carta in mano e assegna un punteggio euristico alla mossa
        let mossaMiglioreIdx = 0;
        let punteggioMigliore = -999;

        p.mano.forEach((carta, idx) => {
            let score = 0;
            const esito = calcolaPresaScopa(carta, this.tavolo);

            if (esito.presaPossibile) {
                score += 10; // Fare presa è sempre positivo

                // Scopa (+100 punti euristici!)
                const tavRimanente = this.tavolo.length - esito.cartePrese.length;
                if (tavRimanente === 0) {
                    score += 100;
                }

                // Settebello preso (+50)
                if (carta.valore === '7' && carta.seme === 'Denari') score += 50;
                if (esito.cartePrese.some(c => c.valore === '7' && c.seme === 'Denari')) score += 50;

                // Denari presi (+15 per ogni carta di denari)
                if (carta.seme === 'Denari') score += 15;
                score += esito.cartePrese.filter(c => c.seme === 'Denari').length * 15;

                // Numero di carte (+5 per carta)
                score += (esito.cartePrese.length + 1) * 5;

                // Carte alte di primiera (7, 6, Asso)
                if (['7', '6', 'Asso'].includes(carta.valore)) score += 10;
                esito.cartePrese.forEach(c => {
                    if (['7', '6', 'Asso'].includes(c.valore)) score += 10;
                });
            } else {
                // Non prende: carta va sul tavolo. Penalizza lasciare carte facili da scopa
                // Non scartare il Settebello se possibile!
                if (carta.valore === '7' && carta.seme === 'Denari') score -= 80;
                else if (carta.seme === 'Denari') score -= 20;

                // Preferisci scartare carte con valore alto (Re=10) che sono più difficili da sommare
                score += valoreNominale(carta.valore) * 2;
            }

            if (score > punteggioMigliore) {
                punteggioMigliore = score;
                mossaMiglioreIdx = idx;
            }
        });

        return mossaMiglioreIdx;
    }
}

export {
    ScopaGame,
    ScopaPlayer,
    calcolaPresaScopa,
    calcolaPrimiera,
    valoreNominale,
    SEMI,
    VALORI
};
