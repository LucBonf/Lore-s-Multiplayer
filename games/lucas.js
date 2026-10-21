// =============================================
// MOTORE DI GIOCO: LUCAS (ES MODULE)
// =============================================

export const SEMI = ["Coppe", "Denari", "Bastoni", "Spade"];
export const VALORI = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];
export const PESO_SEME = { "Denari": 400, "Ori": 400, "Spade": 300, "Coppe": 200, "Bastoni": 100 };
export const PESO_VALORE = { "Asso": 12, "3": 11, "Re": 10, "Cavallo": 9, "Fante": 8, "7": 7, "6": 6, "5": 5, "4": 4, "2": 3 };

export class Card {
    constructor(valore, seme) {
        this.valore = valore;
        this.seme = seme;
        this.forza = PESO_SEME[seme] + PESO_VALORE[valore];
        this.giocata = false;
    }
}

export class Player {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.eloMomentaneo = 1000;
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
        this.voidSuits = [];
        this.dichiarazioniAzzeccate = 0;
    }
    resetGiro() {
        this.mano = [];
        this.dichiarazione = "-";
        this.preseFatte = 0;
        this.voidSuits = [];
    }
}

export class LucasGame {
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
        this.carteUscite = [];
        this.botThinking = false;

        let seq = [];
        for (let i = 2; i <= this.maxCarte; i++) seq.push(i);
        for (let i = this.maxCarte - 1; i >= 2; i--) seq.push(i);
        seq.push(1);
        this.sequenzaTurni = seq;
        this.turnoAttuale = (this.indiceMazziere + 1) % numPlayers;
    }

    distribuisci() {
        let mazzo = [];
        SEMI.forEach(s => VALORI.forEach(v => mazzo.push(new Card(v, s))));
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
        this.carteUscite = [];
    }

    calcolaVincitorePresa() {
        return this.tavolo.reduce((migliore, attuale) => {
            return (attuale.card.forza > migliore.card.forza) ? attuale : migliore;
        });
    }
}
