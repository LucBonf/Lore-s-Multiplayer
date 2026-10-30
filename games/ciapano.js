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
        this.posizioneFinale = null;
        this.rank = null;
        this.eloAssegnato = false;
        this.eloChange = 0;
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

        // 1. Calcolo punti effettivi della smazzata:
        // Per tutti i giocatori tranne chi ha preso l'ultimo giro:
        // 1/3 per figure, 2, 3 e +1 per l'asso, arrotondato per difetto (Math.floor(terzi / 3)).
        let sommaAltri = 0;
        attivi.forEach(p => {
            if (p.id !== this.ultimoPresista) {
                const terzi = p.contaPuntiPrese();
                p.puntiSmazzata = Math.floor(terzi / 3);
                sommaAltri += p.puntiSmazzata;
            }
        });

        // Chi ha preso l'ultima mano riceve: 11 - somma dei punteggi effettivi di tutti gli altri.
        // In questo modo la somma totale della smazzata è SEMPRE esattamente 11.
        const ultimoPlayer = attivi.find(p => p.id === this.ultimoPresista);
        if (ultimoPlayer) {
            ultimoPlayer.puntiSmazzata = 11 - sommaAltri;
        } else {
            // Fallback di sicurezza
            attivi.forEach(p => {
                if (p.puntiSmazzata === undefined) {
                    p.puntiSmazzata = Math.floor(p.contaPuntiPrese() / 3);
                }
            });
        }

        // 2. Controllo Cappotto:
        // Se la mano si conclude con tutti i giocatori a 0 e uno solo con 11, allora è cappotto!
        // Chi ha preso 11 riceve 0 punti (+0) e tutti quelli che hanno preso 0 ricevono 11 punti (+11).
        let cappottoPlayer = attivi.find(p => p.puntiSmazzata === 11);
        const tuttiGliAltriAZero = cappottoPlayer && attivi.every(p => p.id === cappottoPlayer.id || p.puntiSmazzata === 0);

        if (cappottoPlayer && tuttiGliAltriAZero) {
            const cappottoPlayerId = cappottoPlayer.id;
            attivi.forEach(p => {
                p.puntiSmazzata = (p.id === cappottoPlayerId) ? 0 : 11;
            });
            return { isCappotto: true, cappottoPlayerId };
        }

        return { isCappotto: false, cappottoPlayerId: -1 };
    }

    applicaPunteggi(isCappotto = false, cappottoPlayerId = -1) {
        const attivi = this.getGiocatoriAttivi();
        if (isCappotto && cappottoPlayerId !== -1) {
            attivi.forEach(p => {
                p.puntiSmazzata = (p.id === cappottoPlayerId) ? 0 : 11;
                p.puntiTotali += p.puntiSmazzata;
            });
        } else {
            attivi.forEach(p => {
                p.puntiTotali += p.puntiSmazzata;
            });
        }

        const appenaEliminati = [];
        attivi.forEach(p => {
            if (p.puntiTotali >= this.limitePunti) {
                p.eliminato = true;
                appenaEliminati.push(p);
            }
        });

        const attiviRimasti = this.getGiocatoriAttivi();
        const K = attiviRimasti.length;

        // Assegniamo la posizione finale e rank a chi è appena stato eliminato
        if (appenaEliminati.length > 0) {
            // Chi ha meno punti totali si classifica meglio tra gli eliminati della stessa mano
            appenaEliminati.sort((a, b) => a.puntiTotali - b.puntiTotali);
            appenaEliminati.forEach((p, idx) => {
                p.posizioneFinale = (K + 1) + idx;
                p.rank = p.posizioneFinale - 1;
            });
        }

        const gameOver = attiviRimasti.length <= 1;

        if (gameOver) {
            if (attiviRimasti.length === 1) {
                attiviRimasti[0].posizioneFinale = 1;
                attiviRimasti[0].rank = 0;
            } else if (attiviRimasti.length === 0 && appenaEliminati.length > 0) {
                // Nel caso raro in cui tutti i rimasti superino la soglia contemporaneamente
                appenaEliminati[0].posizioneFinale = 1;
                appenaEliminati[0].rank = 0;
            }
        }

        return { gameOver, attiviRimasti, appenaEliminati };
    }
}
