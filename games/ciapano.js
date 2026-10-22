// =============================================
// MOTORE DI GIOCO: CIAPANÒ (TRAVERSONE) (ES MODULE)
// =============================================

export const SEMI_CIAPANO = ["Coppe", "Denari", "Bastoni", "Spade"];
export const VALORI_CIAPANO = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];

export const PESO_VALORE_CIAPANO = {
    "3": 10,
    "2": 9,
    "Asso": 8,
    "Re": 7,
    "Cavallo": 6,
    "Fante": 5,
    "7": 4,
    "6": 3,
    "5": 2,
    "4": 1
};

export function puntiCartaCiapano(valore) {
    if (valore === 'Asso') return 3; // 1 punto = 3 terzi
    if (['3', '2', 'Re', 'Cavallo', 'Fante'].includes(valore)) return 1; // 1/3 punto = 1 terzo
    return 0; // 7, 6, 5, 4 = 0 punti
}

export function formattaPuntiCiapano(punti) {
    return `${punti}`;
}

export function puntiCiapanoNumerico(punti) {
    return punti;
}

export function calcolaDistrCiapano(numPlayers) {
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

export class CiapanoPlayer {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.preseFatte = [];
        this.puntiSmazzata = 0;
        this.puntiTotali = 0;
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

export class CiapanoGame {
    constructor(numPlayers, limitePunti = 31) {
        this.numPlayers = numPlayers;
        this.players = Array.from({ length: numPlayers }, (_, i) => new CiapanoPlayer(i, `CPU ${i}`));
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.turnoAttuale = 0;
        this.tavolo = [];
        this.fase = "gioco";
        this.carteScartate = [];
        this.limitePunti = limitePunti;
        this.smazzataNum = 1;
        this.ultimoPresista = -1;
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
        return this.getGiocatoriAttivi().length;
    }

    distribuisci() {
        let mazzo = [];
        SEMI_CIAPANO.forEach(s => VALORI_CIAPANO.forEach(v => mazzo.push({ valore: v, seme: s, giocata: false })));

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

        for (let i = mazzo.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mazzo[i], mazzo[j]] = [mazzo[j], mazzo[i]];
        }

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

        // 1. Calcola i terzi esatti per ogni giocatore attivo:
        // Ogni Asso = 3 terzi (1 punto)
        // Figure, 2, 3 = 1 terzo ciascuno (1/3 di punto)
        // Chi vince l'ultima presa = +1 terzo (punto dell'ultima mano)
        const terziPerGiocatore = new Map();
        attivi.forEach(p => {
            let terzi = p.contaPuntiPrese();
            if (p.id === this.ultimoPresista) {
                terzi += 1;
            }
            terziPerGiocatore.set(p.id, terzi);
        });

        // 2. Controllo Cappotto REALE:
        // C'è cappotto solo se un giocatore ha fatto TUTTI i 33 terzi (tutti gli 11 punti),
        // cioè tutti gli altri giocatori attivi hanno preso 0 terzi di presa.
        let cappottoPlayerId = -1;
        for (const p of attivi) {
            const terzi = terziPerGiocatore.get(p.id) || 0;
            if (terzi === 33) {
                cappottoPlayerId = p.id;
                break;
            }
        }

        if (cappottoPlayerId !== -1) {
            attivi.forEach(p => {
                p.puntiSmazzata = (p.id === cappottoPlayerId) ? 0 : 11;
            });
            return { isCappotto: true, cappottoPlayerId };
        }

        // 3. Calcolo punti per difetto di ciascun giocatore in base ai suoi terzi (ogni 3 terzi = 1 punto)
        attivi.forEach(p => {
            const terzi = terziPerGiocatore.get(p.id) || 0;
            p.puntiSmazzata = Math.floor(terzi / 3);
        });

        return { isCappotto: false, cappottoPlayerId: -1 };
    }

    applicaPunteggi(isCappotto = false, cappottoPlayerId = -1) {
        const attivi = this.getGiocatoriAttivi();
        if (isCappotto && cappottoPlayerId !== -1) {
            attivi.forEach(p => {
                if (p.id === cappottoPlayerId) {
                    p.puntiSmazzata = 0;
                } else {
                    p.puntiSmazzata = 11;
                    p.puntiTotali += 11;
                }
            });
        } else {
            attivi.forEach(p => {
                p.puntiTotali += p.puntiSmazzata;
            });
        }

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
