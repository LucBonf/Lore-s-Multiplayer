// games/tressette.js
// Implementazione del gioco tradizionale del Tressette (a 2 o a 4 giocatori)
// Mazzo da 40 carte italiane (Coppe, Denari, Spade, Bastoni)

export const SEMI_TRESSETTE = ["Coppe", "Denari", "Spade", "Bastoni"];
export const VALORI_TRESSETTE = ["Asso", "2", "3", "4", "5", "6", "7", "Fante", "Cavallo", "Re"];

// Gerarchia di presa del Tressette: 3 > 2 > Asso > Re > Cavallo > Fante > 7 > 6 > 5 > 4
export const PESO_PRESA_TRESSETTE = {
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

// Punti carte: Asso = 1, Figure/2/3 = 1/3, Liscie (7,6,5,4) = 0
export function puntiCartaTressette(carta) {
    if (!carta) return 0;
    if (carta.valore === "Asso") return 1;
    if (["3", "2", "Re", "Cavallo", "Fante"].includes(carta.valore)) return 1 / 3;
    return 0;
}

export function creaMazzoTressette() {
    const mazzo = [];
    for (const seme of SEMI_TRESSETTE) {
        for (const valore of VALORI_TRESSETTE) {
            mazzo.push({
                seme,
                valore,
                punti: puntiCartaTressette({ valore }),
                peso: PESO_PRESA_TRESSETTE[valore]
            });
        }
    }
    return mazzo;
}

export function mescolaMazzo(mazzo) {
    const arr = [...mazzo];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function determinaVincitorePresaTressette(tavolo) {
    if (!tavolo || tavolo.length === 0) return null;
    const semeUscita = tavolo[0].card.seme;
    let vincitore = tavolo[0];
    let maxPeso = PESO_PRESA_TRESSETTE[vincitore.card.valore] || 0;

    for (let i = 1; i < tavolo.length; i++) {
        const giocata = tavolo[i];
        if (giocata.card.seme === semeUscita) {
            const peso = PESO_PRESA_TRESSETTE[giocata.card.valore] || 0;
            if (peso > maxPeso) {
                maxPeso = peso;
                vincitore = giocata;
            }
        }
    }
    return vincitore;
}

export class TressettePlayer {
    constructor(id, nome, isHuman = true, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.prese = []; // Tutte le carte prese
        this.puntiTotali = 0;
        this.puntiSmazzata = 0;
        this.eloChange = 0;
    }
}

export class TressetteGame {
    constructor(players, opzioni = {}) {
        if (![2, 4].includes(players.length)) {
            throw new Error("Il Tressette supporta solo 2 o 4 giocatori.");
        }
        this.players = players;
        this.numPlayers = players.length;
        this.limitePunti = opzioni.limitePunti ? parseInt(opzioni.limitePunti, 10) : 21;
        this.smazzataNum = 0;
        this.indiceMazziere = Math.floor(Math.random() * this.numPlayers);
        this.primoDiMano = (this.indiceMazziere + 1) % this.numPlayers;
        this.turnoAttuale = this.primoDiMano;
        this.mazzo = [];
        this.tavolo = []; // Array di { playerId, card }
        this.fase = "in_corso"; // 'in_corso', 'fine_smazzata', 'fine_partita'
        this.ultimoPresoId = null;
        this.botThinking = false;

        this.nuovaSmazzata();
    }

    nuovaSmazzata() {
        this.smazzataNum++;
        this.mazzo = mescolaMazzo(creaMazzoTressette());
        this.tavolo = [];
        this.ultimoPresoId = null;

        for (const p of this.players) {
            p.mano = [];
            p.prese = [];
            p.puntiSmazzata = 0;
        }

        // Distribuzione:
        // A 4 giocatori: 10 carte a testa (tutto il mazzo distribuito)
        // A 2 giocatori: 10 carte a testa, le altre 20 restano nel tallone (pesca dopo ogni presa)
        for (let i = 0; i < 10; i++) {
            for (const p of this.players) {
                p.mano.push(this.mazzo.pop());
            }
        }

        this.primoDiMano = (this.indiceMazziere + 1) % this.numPlayers;
        this.turnoAttuale = this.primoDiMano;
        this.fase = "in_corso";
    }

    haSemeUscita(playerIdx) {
        if (this.tavolo.length === 0) return false;
        const semeUscita = this.tavolo[0].card.seme;
        const player = this.players[playerIdx];
        return player.mano.some(c => c.seme === semeUscita);
    }

    giocataValida(playerIdx, cartaIdx) {
        if (playerIdx !== this.turnoAttuale) return { valida: false, motivo: "Non è il tuo turno" };
        const player = this.players[playerIdx];
        if (!player || cartaIdx < 0 || cartaIdx >= player.mano.length) {
            return { valida: false, motivo: "Indice carta non valido" };
        }
        const cartaScelta = player.mano[cartaIdx];
        if (this.tavolo.length > 0) {
            const semeUscita = this.tavolo[0].card.seme;
            if (this.haSemeUscita(playerIdx) && cartaScelta.seme !== semeUscita) {
                return { valida: false, motivo: `Devi rispondere al seme di uscita (${semeUscita})!` };
            }
        }
        return { valida: true };
    }

    giocaCarta(playerIdx, cartaIdx) {
        const val = this.giocataValida(playerIdx, cartaIdx);
        if (!val.valida) return { ok: false, motivo: val.motivo };

        const player = this.players[playerIdx];
        const [carta] = player.mano.splice(cartaIdx, 1);
        this.tavolo.push({ playerId: player.id, playerIdx, card: carta });

        const manoCompleta = (this.tavolo.length === this.numPlayers);
        if (!manoCompleta) {
            this.turnoAttuale = (this.turnoAttuale + 1) % this.numPlayers;
        }

        return {
            ok: true,
            card: carta,
            manoCompleta,
            tavolo: this.tavolo
        };
    }

    risolviPresa() {
        if (this.tavolo.length < this.numPlayers) return null;

        const presaVincente = determinaVincitorePresaTressette(this.tavolo);
        const vincitoreIdx = presaVincente.playerIdx;
        const vincitore = this.players[vincitoreIdx];

        // Aggiungi carte prese
        for (const giocata of this.tavolo) {
            vincitore.prese.push(giocata.card);
        }

        this.ultimoPresoId = vincitore.id;
        const tavoloFinito = [...this.tavolo];
        this.tavolo = [];
        this.turnoAttuale = vincitoreIdx;

        // Se a 2 giocatori e c'è ancora il mazzo (pesca a turno, prima chi ha vinto la presa)
        if (this.numPlayers === 2 && this.mazzo.length > 0) {
            const perdenteIdx = (vincitoreIdx + 1) % 2;
            const cartaVinta = this.mazzo.pop();
            const cartaPersa = this.mazzo.pop();
            vincitore.mano.push(cartaVinta);
            this.players[perdenteIdx].mano.push(cartaPersa);
        }

        // Verifica se le mani sono vuote (fine smazzata)
        const carteRimaste = this.players.reduce((sum, p) => sum + p.mano.length, 0);
        const smazzataFinita = (carteRimaste === 0);

        let esitoSmazzata = null;
        if (smazzataFinita) {
            esitoSmazzata = this.calcolaPunteggiSmazzata(vincitoreIdx);
        }

        return {
            vincitoreId: vincitore.id,
            vincitoreIdx,
            vincitoreNome: vincitore.nome,
            cartaVincente: presaVincente.card,
            tavoloPrecedente: tavoloFinito,
            smazzataFinita,
            esitoSmazzata
        };
    }

    calcolaPunteggiSmazzata(ultimoVincitoreIdx) {
        // Punti calcolati: Assi = 1, Figure/2/3 = 1/3, Ultima = 1
        // Arrotondamento per difetto della somma dei terzi, +1 all'ultima presa.
        // Totale disponibile: 11 punti tondi.
        if (this.numPlayers === 4) {
            // Modalità a coppie (0 e 2 contro 1 e 3)
            const squadra0 = [this.players[0], this.players[2]];
            const squadra1 = [this.players[1], this.players[3]];

            let puntiGrezzi0 = 0;
            let puntiGrezzi1 = 0;

            for (const p of squadra0) {
                for (const c of p.prese) puntiGrezzi0 += puntiCartaTressette(c);
            }
            for (const p of squadra1) {
                for (const c of p.prese) puntiGrezzi1 += puntiCartaTressette(c);
            }

            // Bonus ultima presa (+1 punto alla squadra che ha preso l'ultima mano)
            if (ultimoVincitoreIdx === 0 || ultimoVincitoreIdx === 2) {
                puntiGrezzi0 += 1;
            } else {
                puntiGrezzi1 += 1;
            }

            const punti0 = Math.floor(puntiGrezzi0 + 0.0001);
            const punti1 = Math.floor(puntiGrezzi1 + 0.0001);

            squadra0.forEach(p => { p.puntiSmazzata = punti0; p.puntiTotali += punti0; });
            squadra1.forEach(p => { p.puntiSmazzata = punti1; p.puntiTotali += punti1; });
        } else {
            // A 2 giocatori (1 contro 1)
            let puntiGrezzi0 = 0;
            let puntiGrezzi1 = 0;

            for (const c of this.players[0].prese) puntiGrezzi0 += puntiCartaTressette(c);
            for (const c of this.players[1].prese) puntiGrezzi1 += puntiCartaTressette(c);

            if (ultimoVincitoreIdx === 0) puntiGrezzi0 += 1;
            else puntiGrezzi1 += 1;

            const p0 = Math.floor(puntiGrezzi0 + 0.0001);
            const p1 = Math.floor(puntiGrezzi1 + 0.0001);

            this.players[0].puntiSmazzata = p0;
            this.players[0].puntiTotali += p0;

            this.players[1].puntiSmazzata = p1;
            this.players[1].puntiTotali += p1;
        }

        // Verifica raggiungimento limite punti
        const maxPunti = Math.max(...this.players.map(p => p.puntiTotali));
        const partitaFinita = maxPunti >= this.limitePunti;

        if (partitaFinita) {
            this.fase = "fine_partita";
        } else {
            this.fase = "fine_smazzata";
            this.indiceMazziere = (this.indiceMazziere + 1) % this.numPlayers;
        }

        return {
            partitaFinita,
            smazzataNum: this.smazzataNum,
            punteggi: this.players.map(p => ({
                id: p.id,
                nome: p.nome,
                puntiSmazzata: p.puntiSmazzata,
                puntiTotali: p.puntiTotali
            }))
        };
    }

    calcolaClassificaFinale() {
        const classifica = [...this.players].sort((a, b) => b.puntiTotali - a.puntiTotali);
        return {
            vincitore: classifica[0],
            isPareggio: classifica.length > 1 && (classifica[0].puntiTotali === classifica[1].puntiTotali),
            classifica
        };
    }

    scegliMossaIA(playerIdx) {
        const player = this.players[playerIdx];
        if (!player || player.mano.length === 0) return 0;

        const mosseLegali = [];
        for (let i = 0; i < player.mano.length; i++) {
            if (this.giocataValida(playerIdx, i).valida) {
                mosseLegali.push({ idx: i, card: player.mano[i] });
            }
        }
        if (mosseLegali.length === 0) return 0;

        // Se primo di mano: gioca un 3 o 2 per fare presa sicura o una liscia (4,5,6)
        if (this.tavolo.length === 0) {
            // Prediligi liscia se non hai carichi forti da proteggere
            const liscia = mosseLegali.find(m => ["4", "5", "6", "7"].includes(m.card.valore));
            if (liscia) return liscia.idx;
            return mosseLegali[0].idx;
        }

        // Se secondo o successivo di mano:
        const semeUscita = this.tavolo[0].card.seme;
        const presaAttuale = determinaVincitorePresaTressette(this.tavolo);
        const mioCompagnoIdx = (this.numPlayers === 4) ? (playerIdx + 2) % 4 : null;
        const staPrendendoCompagno = (mioCompagnoIdx !== null && presaAttuale.playerIdx === mioCompagnoIdx);

        // Se sta vincendo il compagno, carica (Asso o 3 o figura)
        if (staPrendendoCompagno) {
            const carichi = mosseLegali.filter(m => puntiCartaTressette(m.card) > 0);
            if (carichi.length > 0) {
                // Gioca il carico di minor valore difensivo
                return carichi[0].idx;
            }
        }

        // Altrimenti, controlla se puoi superare la presa
        const pesoVincente = PESO_PRESA_TRESSETTE[presaAttuale.card.valore] || 0;
        const battenti = mosseLegali.filter(m => m.card.seme === semeUscita && PESO_PRESA_TRESSETTE[m.card.valore] > pesoVincente);

        if (battenti.length > 0) {
            // Prendi con la carta battente più economica (minore tra quelle battenti)
            battenti.sort((a, b) => PESO_PRESA_TRESSETTE[a.card.valore] - PESO_PRESA_TRESSETTE[b.card.valore]);
            return battenti[0].idx;
        }

        // Se non puoi battere, scarta la carta di minor valore (liscia più bassa)
        mosseLegali.sort((a, b) => {
            const pDiff = puntiCartaTressette(a.card) - puntiCartaTressette(b.card);
            if (pDiff !== 0) return pDiff;
            return PESO_PRESA_TRESSETTE[a.card.valore] - PESO_PRESA_TRESSETTE[b.card.valore];
        });
        return mosseLegali[0].idx;
    }
}
