// =============================================
// MOTORE DI GIOCO: BRISCOLA (ES MODULE)
// =============================================

const SEMI = ['Denari', 'Spade', 'Coppe', 'Bastoni'];
const VALORI = ['Asso', '3', 'Re', 'Cavallo', 'Fante', '7', '6', '5', '4', '2'];

// Punti ufficiali delle carte nella Briscola (totale 120 pt)
const PUNTI_BRISCOLA = {
    'Asso': 11,
    '3': 10,
    'Re': 4,
    'Cavallo': 3,
    'Fante': 2,
    '7': 0,
    '6': 0,
    '5': 0,
    '4': 0,
    '2': 0
};

// Gerarchia di forza nella presa (Asso > 3 > Re > Cavallo > Fante > 7 > 6 > 5 > 4 > 2)
const PESO_PRESA_BRISCOLA = {
    'Asso': 10,
    '3': 9,
    'Re': 8,
    'Cavallo': 7,
    'Fante': 6,
    '7': 5,
    '6': 4,
    '5': 3,
    '4': 2,
    '2': 1
};

function puntiCartaBriscola(valore) {
    return PUNTI_BRISCOLA[valore] !== undefined ? PUNTI_BRISCOLA[valore] : 0;
}

function pesoPresaCartaBriscola(valore) {
    return PESO_PRESA_BRISCOLA[valore] !== undefined ? PESO_PRESA_BRISCOLA[valore] : 0;
}

function determinaVincitorePresaBriscola(tavolo, semeBriscola) {
    if (!tavolo || tavolo.length === 0) return null;

    const semeUscita = tavolo[0].card.seme;
    let migliore = tavolo[0];
    let miglioreHaBriscola = (migliore.card.seme === semeBriscola);

    for (let i = 1; i < tavolo.length; i++) {
        const corrente = tavolo[i];
        const correnteHaBriscola = (corrente.card.seme === semeBriscola);

        if (correnteHaBriscola) {
            if (!miglioreHaBriscola) {
                migliore = corrente;
                miglioreHaBriscola = true;
            } else {
                if (pesoPresaCartaBriscola(corrente.card.valore) > pesoPresaCartaBriscola(migliore.card.valore)) {
                    migliore = corrente;
                }
            }
        } else if (!miglioreHaBriscola) {
            if (corrente.card.seme === semeUscita) {
                if (pesoPresaCartaBriscola(corrente.card.valore) > pesoPresaCartaBriscola(migliore.card.valore)) {
                    migliore = corrente;
                }
            }
        }
    }

    return {
        vincitoreId: migliore.playerId,
        cartaVincente: migliore.card
    };
}

class BriscolaPlayer {
    constructor(id, nome, isHuman = false, token = null, uniqueCode = null) {
        this.id = id;
        this.nome = nome;
        this.isHuman = isHuman;
        this.token = token;
        this.uniqueCode = uniqueCode;
        this.mano = [];
        this.prese = [];        // Carte catturate
        this.puntiTotali = 0;   // Somma punti delle carte catturate
        this.ruolo = null;      // 'chiamante' | 'socio' | 'buono' (per la variante a 5)
        this.eloMomentaneo = 1000;
        this.aiLevel = 0;
    }

    reset() {
        this.mano = [];
        this.prese = [];
        this.puntiTotali = 0;
        this.ruolo = null;
    }

    calcolaPunti() {
        this.puntiTotali = this.prese.reduce((acc, c) => acc + puntiCartaBriscola(c.valore), 0);
        return this.puntiTotali;
    }
}

class BriscolaGame {
    constructor(numPlayers = 2, variante = 'classica') {
        this.numPlayers = numPlayers; // 2, 4 o 5
        this.variante = (numPlayers === 5) ? 'chiamata' : (variante || 'classica');
        this.players = Array.from({ length: numPlayers }, (_, i) => new BriscolaPlayer(i, `CPU ${i}`));
        this.mazzo = [];
        this.cartaBriscola = null; // La carta scoperta sotto il tallone
        this.semeBriscola = null;
        this.tavolo = [];          // [ { playerId, card } ]
        this.indiceMazziere = Math.floor(Math.random() * numPlayers);
        this.turnoAttuale = 0;
        this.primoDiMano = 0;
        this.fase = "gioco";       // "chiamata" | "gioco" | "fine_partita"
        this.smazzataNum = 1;
        this.botThinking = false;

        // Campi per Briscola Chiamata (a 5)
        this.chiamanteIdx = 0;
        this.socioIdx = null;
        this.cartaChiamata = null; // { valore, seme }
        this.socioRivelato = false;
        this.puntiObiettivo = 61;
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
        this.players.forEach(p => p.reset());
        this.tavolo = [];
        this.socioRivelato = false;

        if (this.variante === 'chiamata') {
            // A 5 giocatori si distribuiscono tutte le 40 carte (8 carte a testa)
            for (let i = 0; i < 8; i++) {
                for (let p of this.players) {
                    p.mano.push(this.mazzo.pop());
                }
            }
            this.chiamanteIdx = (this.indiceMazziere + 1) % this.numPlayers;
            this.primoDiMano = this.chiamanteIdx;
            this.turnoAttuale = this.chiamanteIdx;

            // IA o Giocatore determina la chiamata
            this.eseguiChiamataAutomatica();
            this.fase = "gioco";
        } else {
            // Briscola classica: 3 carte a testa
            for (let i = 0; i < 3; i++) {
                for (let p of this.players) {
                    p.mano.push(this.mazzo.pop());
                }
            }
            // 1 carta scoperta definisce la Briscola e resta sotto il tallone
            this.cartaBriscola = this.mazzo.shift(); // Posata in fondo al mazzo
            this.semeBriscola = this.cartaBriscola.seme;

            this.primoDiMano = (this.indiceMazziere + 1) % this.numPlayers;
            this.turnoAttuale = this.primoDiMano;
            this.fase = "gioco";
        }
    }

    eseguiChiamataAutomatica() {
        // Seleziona la chiamata migliore per il chiamante (chiamando l'Asso o il 3 del proprio seme più lungo/forte)
        const p = this.players[this.chiamanteIdx];
        const conteggioSemi = { Denari: 0, Spade: 0, Coppe: 0, Bastoni: 0 };
        p.mano.forEach(c => conteggioSemi[c.seme]++);

        let migliorSeme = 'Denari';
        let maxCount = -1;
        for (let s of SEMI) {
            if (conteggioSemi[s] > maxCount) {
                maxCount = conteggioSemi[s];
                migliorSeme = s;
            }
        }

        // Cerca di chiamare l'Asso del proprio seme migliore se non lo possiede
        const haAsso = p.mano.some(c => c.valore === 'Asso' && c.seme === migliorSeme);
        const haTre = p.mano.some(c => c.valore === '3' && c.seme === migliorSeme);

        let valoreChiamato = 'Asso';
        if (haAsso && !haTre) valoreChiamato = '3';
        else if (haAsso && haTre) valoreChiamato = 'Re';

        this.semeBriscola = migliorSeme;
        this.cartaChiamata = { valore: valoreChiamato, seme: migliorSeme };
        this.cartaBriscola = { valore: valoreChiamato, seme: migliorSeme }; // indicativa

        // Assegna ruoli iniziali
        p.ruolo = 'chiamante';
        this.players.forEach((giocatore, idx) => {
            if (idx !== this.chiamanteIdx) {
                const haLaCarta = giocatore.mano.some(c => c.valore === this.cartaChiamata.valore && c.seme === this.cartaChiamata.seme);
                if (haLaCarta) {
                    this.socioIdx = idx;
                    giocatore.ruolo = 'socio';
                } else {
                    giocatore.ruolo = 'buono';
                }
            }
        });

        // Caso in cui il chiamante si è chiamato da solo
        if (p.mano.some(c => c.valore === this.cartaChiamata.valore && c.seme === this.cartaChiamata.seme)) {
            this.socioIdx = this.chiamanteIdx;
            this.socioRivelato = true;
        }
    }

    giocaCarta(playerIdx, cartaIdx) {
        if (this.fase !== 'gioco') return { successo: false, motivo: "Partita non in fase di gioco" };
        if (this.turnoAttuale !== playerIdx) return { successo: false, motivo: "Non è il tuo turno" };

        const player = this.players[playerIdx];
        if (!player || cartaIdx < 0 || cartaIdx >= player.mano.length) {
            return { successo: false, motivo: "Indice carta non valido" };
        }

        const cartaGiocata = player.mano.splice(cartaIdx, 1)[0];
        cartaGiocata.giocata = true;

        this.tavolo.push({
            playerId: playerIdx,
            card: cartaGiocata
        });

        // Verifica se la carta giocata è la carta chiamata (Briscola a 5)
        let socioRivelatoOra = false;
        if (this.variante === 'chiamata' && this.cartaChiamata && !this.socioRivelato) {
            if (cartaGiocata.valore === this.cartaChiamata.valore && cartaGiocata.seme === this.cartaChiamata.seme) {
                this.socioRivelato = true;
                socioRivelatoOra = true;
            }
        }

        // Se tutti hanno giocato, la mano è completa
        const manoCompleta = (this.tavolo.length === this.numPlayers);

        if (!manoCompleta) {
            this.turnoAttuale = (this.turnoAttuale + 1) % this.numPlayers;
            return {
                successo: true,
                manoCompleta: false,
                carta: cartaGiocata,
                socioRivelatoOra
            };
        } else {
            return {
                successo: true,
                manoCompleta: true,
                carta: cartaGiocata,
                socioRivelatoOra
            };
        }
    }

    risolviPresa() {
        if (this.tavolo.length < this.numPlayers) return null;

        const esito = determinaVincitorePresaBriscola(this.tavolo, this.semeBriscola);
        const vincitore = this.players[esito.vincitoreId];

        // Raccoglie tutte le carte del tavolo
        for (let g of this.tavolo) {
            vincitore.prese.push(g.card);
        }

        const cartePrese = [...this.tavolo];
        this.tavolo = [];
        this.turnoAttuale = esito.vincitoreId;
        this.primoDiMano = esito.vincitoreId;

        // Pesca le carte se siamo in Briscola Classica
        let pescataAvvenuta = false;
        if (this.variante !== 'chiamata') {
            // A partire dal vincitore della presa
            for (let i = 0; i < this.numPlayers; i++) {
                const pIdx = (esito.vincitoreId + i) % this.numPlayers;
                const p = this.players[pIdx];

                if (this.mazzo.length > 0) {
                    p.mano.push(this.mazzo.pop());
                    pescataAvvenuta = true;
                } else if (this.cartaBriscola) {
                    // L'ultimo giocatore pesca la carta di Briscola scoperta
                    p.mano.push(this.cartaBriscola);
                    this.cartaBriscola = null;
                    pescataAvvenuta = true;
                }
            }
        }

        // Verifica se la smazzata è terminata (nessun giocatore ha più carte)
        const partitaFinita = this.players.every(p => p.mano.length === 0);
        if (partitaFinita) {
            this.fase = "fine_partita";
        }

        return {
            vincitoreId: esito.vincitoreId,
            nomeVincitore: vincitore.nome,
            cartaVincente: esito.cartaVincente,
            cartePrese,
            pescataAvvenuta,
            partitaFinita
        };
    }

    calcolaClassificaFinale() {
        this.players.forEach(p => p.calcolaPunti());

        if (this.variante === 'chiamata') {
            const chiamante = this.players[this.chiamanteIdx];
            const socio = this.socioIdx !== null ? this.players[this.socioIdx] : null;

            let puntiSquadraChiamante = chiamante.puntiTotali;
            if (socio && socio.id !== chiamante.id) {
                puntiSquadraChiamante += socio.puntiTotali;
            }
            const puntiDifesa = 120 - puntiSquadraChiamante;
            const vittoriaChiamante = puntiSquadraChiamante >= this.puntiObiettivo;

            const classifica = [...this.players].sort((a, b) => b.puntiTotali - a.puntiTotali);

            return {
                variante: 'chiamata',
                vittoriaChiamante,
                puntiSquadraChiamante,
                puntiDifesa,
                chiamanteNome: chiamante.nome,
                socioNome: socio ? socio.nome : "Nessuno",
                classifica
            };
        } else if (this.numPlayers === 4) {
            // Briscola classica a 4 giocatori (A coppie: 0 e 2 contro 1 e 3)
            const puntiSquadra0 = this.players[0].puntiTotali + this.players[2].puntiTotali;
            const puntiSquadra1 = this.players[1].puntiTotali + this.players[3].puntiTotali;
            const isPareggio = (puntiSquadra0 === puntiSquadra1); // 60 a 60
            const vincenteSquadra = isPareggio ? -1 : (puntiSquadra0 > puntiSquadra1 ? 0 : 1);
            const vincitore = isPareggio ? null : (vincenteSquadra === 0 ? this.players[0] : this.players[1]);

            const classifica = [...this.players].sort((a, b) => {
                const idxA = this.players.indexOf(a);
                const idxB = this.players.indexOf(b);
                const teamA = (idxA % 2 === 0) ? puntiSquadra0 : puntiSquadra1;
                const teamB = (idxB % 2 === 0) ? puntiSquadra0 : puntiSquadra1;
                if (teamA !== teamB) return teamB - teamA;
                return b.puntiTotali - a.puntiTotali;
            });

            return {
                variante: 'classica',
                isPareggio,
                vincitore,
                vincitoreId: vincitore ? vincitore.id : null,
                vincenteSquadra,
                puntiSquadra0,
                puntiSquadra1,
                classifica
            };
        } else {
            // Briscola classica a 2 giocatori (1 contro 1)
            const classifica = [...this.players].sort((a, b) => b.puntiTotali - a.puntiTotali);
            const isPareggio = (classifica.length > 1 && classifica[0].puntiTotali === classifica[1].puntiTotali);
            const vincitore = isPareggio ? null : (classifica[0] || null);
            const vincitoreId = vincitore ? vincitore.id : null;

            return {
                variante: 'classica',
                isPareggio,
                vincitore,
                vincitoreId,
                classifica
            };
        }
    }

    scegliMossaIA(playerIdx) {
        const player = this.players[playerIdx];
        if (!player || player.mano.length === 0) return 0;

        const mano = player.mano;
        const tavolo = this.tavolo;
        const briscola = this.semeBriscola;

        // Se primo di mano: gioca preferibilmente una carta liscia di seme non briscola col valore più basso
        if (tavolo.length === 0) {
            let migliorIdx = 0;
            let minPunti = 999;
            mano.forEach((c, idx) => {
                const pt = puntiCartaBriscola(c.valore);
                const isBr = (c.seme === briscola);
                // Penalizza fortemente giocare briscole o carichi come primo di mano
                const peso = pt + (isBr ? 50 : 0);
                if (peso < minPunti) {
                    minPunti = peso;
                    migliorIdx = idx;
                }
            });
            return migliorIdx;
        }

        // Ci sono carte sul tavolo: calcola punti in palio sul tavolo
        const puntiSulTavolo = tavolo.reduce((acc, g) => acc + puntiCartaBriscola(g.card.valore), 0);
        const vincenteAttuale = determinaVincitorePresaBriscola(tavolo, briscola);

        // Verifica se il giocatore può superare l'attuale vincente
        const mosseVincenti = [];
        const mosseScarto = [];

        mano.forEach((c, idx) => {
            const simulazioneTavolo = [...tavolo, { playerId: playerIdx, card: c }];
            const esito = determinaVincitorePresaBriscola(simulazioneTavolo, briscola);
            if (esito.vincitoreId === playerIdx) {
                mosseVincenti.push({ idx, card: c });
            } else {
                mosseScarto.push({ idx, card: c });
            }
        });

        // Se ci sono punti importanti sul tavolo (> 4 pt es. Asso o 3 o Re) e possiamo prendere:
        if (puntiSulTavolo >= 4 && mosseVincenti.length > 0) {
            // Prendi spendendo la carta più economica possibile (es. briscola più bassa o carta a seme più bassa)
            mosseVincenti.sort((a, b) => {
                const ptA = puntiCartaBriscola(a.card.valore);
                const ptB = puntiCartaBriscola(b.card.valore);
                if (ptA !== ptB) return ptA - ptB;
                return pesoPresaCartaBriscola(a.card.valore) - pesoPresaCartaBriscola(b.card.valore);
            });
            return mosseVincenti[0].idx;
        }

        // Se non ci sono molti punti o non vale la pena spendere briscole/carichi, scarta la carta peggiore (liscia)
        if (mosseScarto.length > 0) {
            // Scarta liscia di seme non briscola
            mosseScarto.sort((a, b) => {
                const isBrA = (a.card.seme === briscola) ? 50 : 0;
                const isBrB = (b.card.seme === briscola) ? 50 : 0;
                return (puntiCartaBriscola(a.card.valore) + isBrA) - (puntiCartaBriscola(b.card.valore) + isBrB);
            });
            return mosseScarto[0].idx;
        }

        // Fallback: gioca la prima carta disponibile
        return 0;
    }
}

export {
    BriscolaGame,
    BriscolaPlayer,
    determinaVincitorePresaBriscola,
    puntiCartaBriscola,
    pesoPresaCartaBriscola,
    SEMI,
    VALORI,
    PUNTI_BRISCOLA
};
