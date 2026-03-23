const socket = io();
let qtaAttuale = 0; // Per validazione locale

// =========================================
//   NUOVO RENDER GIOCATORI CIRCOLARE (MAIN.JS)
// =========================================

function renderGiocatori(data) {
    const playersCircle = document.getElementById('players-circle');
    const cardsOnTable = document.getElementById('cards-on-table');
    const infoGiro = document.getElementById('info-giro');

    playersCircle.innerHTML = '';
    cardsOnTable.innerHTML = '';

    infoGiro.innerText = `Giro ${data.qtaCarte} carte - Somma Scommesse: ${data.sommaScommesse}`;

    const numPlayers = data.tuttiGiocatori.length;
    const mioIndice = data.tuttiGiocatori.findIndex(p => p.socketId === socket.id);
    const stepAngolo = 360 / numPlayers;

    const raggioX = 42;
    const raggioY = 38;
    const raggioCarteX = 20;
    const raggioCarteY = 20;

    // RIPRISTINIAMO LE SCALE DINAMICHE PER IL TAVOLO CENTRALE
    let scalaPlayerBlock = 1;
    let scalaTableCard = 0.8;
    if (numPlayers >= 7) {
        scalaPlayerBlock = 0.7;
        scalaTableCard = 0.55; // Carte sul tavolo piccolissime per fare spazio!
    } else if (numPlayers >= 5) {
        scalaPlayerBlock = 0.8;
        scalaTableCard = 0.7;
    }

    const posizioniCarteTavoloPerGiocatore = new Map();

    for (let i = 0; i < numPlayers; i++) {
        const serverPlayerIndex = (mioIndice + i) % numPlayers;
        const p = data.tuttiGiocatori[serverPlayerIndex];
        const isMe = (p.socketId === socket.id);

        const angoloGradi = 90 + (i * stepAngolo);
        const angoloRadianti = angoloGradi * (Math.PI / 180);

        const posX = 50 + raggioX * Math.cos(angoloRadianti);
        const posY = 50 + raggioY * Math.sin(angoloRadianti);

        const pBlock = document.createElement('div');
        pBlock.className = 'player-block';
        if (isMe) pBlock.classList.add('me');
        if (data.turnoAttuale === serverPlayerIndex) pBlock.classList.add('active-turn');
        pBlock.style.left = `${posX}%`;
        pBlock.style.top = `${posY}%`;

        // Usiamo la scala dinamica per i box
        pBlock.style.transform = `translate(-50%, -50%) scale(${scalaPlayerBlock})`;

        const ruolo = p.isMazziere ? " (M)" : "";
        pBlock.innerHTML = `
            <div class="name">${p.nome}${ruolo}</div>
            <div class="stats">Punti: ${p.punti} | Dich: ${p.dichiarazione} | Prese: ${p.prese}</div>
        `;

        if (isMe) {
            const myHandCont = document.createElement('div');
            myHandCont.id = 'tu-mano';
            pBlock.appendChild(myHandCont);
            renderTuaMano(myHandCont, p.mano, serverPlayerIndex === data.turnoAttuale, data.fase);
        } else {
            const oppHandCont = document.createElement('div');
            oppHandCont.className = 'opponent-hand';
            if (data.qtaCarte === 1 && p.cartaFronte) {
                const fronteDiv = document.createElement('div');
                fronteDiv.className = `card seme-${p.cartaFronte.seme} val-${p.cartaFronte.valore}`;
                fronteDiv.style.transform = "scale(0.7)";
                oppHandCont.appendChild(fronteDiv);
            } else {
                const carteInManoCount = p.mano ? p.mano.filter(c => !c.giocata).length : 0;

                let margineNegativo = 0;
                if (carteInManoCount > 1) {
                    const spazioPerCarta = (160 - 35) / (carteInManoCount - 1);
                    margineNegativo = Math.min(0, spazioPerCarta - 35);
                }

                for (let c = 0; c < carteInManoCount; c++) {
                    const cardBack = document.createElement('div');
                    cardBack.className = 'card-back';
                    if (c > 0) cardBack.style.marginLeft = `${margineNegativo}px`;
                    oppHandCont.appendChild(cardBack);
                }
            }
            pBlock.appendChild(oppHandCont);
        }

        playersCircle.appendChild(pBlock);

        const cartaX = 50 + raggioCarteX * Math.cos(angoloRadianti);
        const cartaY = 50 + raggioCarteY * Math.sin(angoloRadianti);
        posizioniCarteTavoloPerGiocatore.set(serverPlayerIndex, { x: cartaX, y: cartaY });
    }

    data.tavolo.forEach((giocata, index) => {
        const c = giocata.card;
        const pId = giocata.playerId;
        const posData = posizioniCarteTavoloPerGiocatore.get(pId);

        if (posData) {
            const divCartaTavolo = document.createElement('div');
            divCartaTavolo.className = `card seme-${c.seme} val-${c.valore} table-card`;
            divCartaTavolo.style.left = `${posData.x}%`;
            divCartaTavolo.style.top = `${posData.y}%`;
            divCartaTavolo.style.zIndex = 100 + index;

            const randRot = (Math.random() * 14) - 7;
            // Usiamo la scala dinamica per le carte giocate!
            divCartaTavolo.style.transform = `translate(-50%, -50%) scale(${scalaTableCard}) rotate(${randRot}deg)`;

            cardsOnTable.appendChild(divCartaTavolo);
        }
    });
}

function getSemeSimbolo(seme) {
    switch (seme) {
        case 'Ori': return '🪙';
        case 'Spade': return '🗡️';
        case 'Coppe': return '🍷';
        case 'Bastoni': return '🏏';
        default: return '';
    }
}

// Aggiunto "handCont" tra le parentesi
function renderTuaMano(handCont, mano, isMyTurn, fase) {
    if (!handCont) return;
    handCont.innerHTML = ''; // Pulizia di sicurezza

    const carteDaDisegnare = mano.filter(c => !c.giocata);

    // --- 1. NOVITÀ: ORDINA LE CARTE DALLA PIÙ DEBOLE ALLA PIÙ FORTE ---
    // Usiamo il valore "forza" già calcolato dal server (Ori > Spade > Coppe > Bastoni)
    carteDaDisegnare.sort((a, b) => a.forza - b.forza);

    const numCarte = carteDaDisegnare.length;

    // MATEMATICA: Più carte hai, più si incastrano per non uscire dallo schermo!
    let marginLeft = 0;
    if (numCarte > 10) {
        marginLeft = -50;
    } else if (numCarte > 7) {
        marginLeft = -35;
    } else if (numCarte > 4) {
        marginLeft = -15;
    }

    carteDaDisegnare.forEach((c, idx) => {
        const div = document.createElement('div');

        // --- 2. NOVITÀ: FIX ASSO DI COPPE E DORSO CON IMMAGINE ---
        // Se il server ci ha nascosto la carta (Giro Fronte da 1)
        if (c.valore === "?") {
            // Aggiungiamo 'card-back' per usare l'immagine definita nel CSS
            // e manteniamo 'card' per le dimensioni corrette nel tuo box
            div.className = 'card card-back';

            // Rimuoviamo gli stili inline vecchi (quelli del dorso blu)
            div.style.background = '';
            div.style.border = '';
        } else {
            // Carta normale visibile
            div.className = `card seme-${c.seme} val-${c.valore}`;
        }

        // Applichiamo il margine negativo per farle sovrapporre!
        if (idx > 0) div.style.marginLeft = `${marginLeft}px`;

        // Assegniamo lo z-index corretto per farle impilare da sinistra verso destra
        div.style.zIndex = 10 + idx;

        div.onclick = () => {
            // Clicchi per giocare la carta. 
            // NOTA: Usando mano.indexOf(c) peschiamo l'indice originale corretto anche se le abbiamo riordinate visivamente!
            if (isMyTurn && fase === 'gioco') socket.emit('gioca_carta', { cartaIdx: mano.indexOf(c) });
        };
        handCont.appendChild(div);
    });
}

window.creaNuovaStanza = () => {
    const nome = document.getElementById('player-nickname').value.trim() || "Host";
    const num = document.getElementById('select-players').value;
    socket.emit('crea_lobby', { nome: nome, numGiocatori: num });
};

window.uniscitiAStanza = () => {
    const nome = document.getElementById('player-nickname').value.trim() || "Giocatore";
    const code = document.getElementById('input-room-code').value.toUpperCase();
    socket.emit('unisciti_lobby', { nome: nome, code: code });
};

window.iniziaPartitaVera = () => socket.emit('richiesta_inizio_partita');

window.inviaDichiarazione = () => {
    const val = parseInt(document.getElementById('bet-input').value);
    if (val > qtaAttuale) {
        alert(`Non puoi dichiarare più di ${qtaAttuale}!`);
        return;
    }
    socket.emit('invia_scommessa', val);
};

socket.on('lobby_creata', (d) => {
    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('lobby-wait').style.display = 'block';
    document.getElementById('display-room-code').innerText = d.code;
    document.getElementById('lobby-info').style.display = 'block';
    document.getElementById('start-game-btn').style.display = 'block';
    document.getElementById('joined-players-list').innerHTML = d.giocatori.map(p => `<div>👤 ${p.nome}</div>`).join('');
});

socket.on('aggiorna_lobby', (dati) => {
    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('lobby-wait').style.display = 'block';

    // Mostriamo il codice stanza all'amico e la lista aggiornata
    if (dati.code) {
        document.getElementById('display-room-code').innerText = dati.code;
        document.getElementById('lobby-info').style.display = 'block';
    }

    document.getElementById('joined-players-list').innerHTML = dati.giocatori.map(p => `<div>👤 ${p.nome}</div>`).join('');
});

socket.on('conferma_inizio_partita', (dati) => {
    qtaAttuale = dati.qtaCarte;
    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('lobby-wait').style.display = 'none';
    document.getElementById('game-area').style.display = 'block';

    const pAttuale = dati.tuttiGiocatori[dati.turnoAttuale];
    const eMioTurno = (pAttuale.socketId === socket.id);

    // Gestione comparsa riquadro scommesse
    const areaScommessa = document.getElementById('dichiarazione-area');
    if (dati.fase === 'scommesse' && eMioTurno) {
        areaScommessa.style.display = 'block';
        document.getElementById('bet-input').max = qtaAttuale;
    } else {
        areaScommessa.style.display = 'none';
    }

    // CHIAMIAMO LA MAGIA CIRCOLARE QUI!
    renderGiocatori(dati);

});

// Funzione per mostrare banner di errore a schermo
function mostraErrore(messaggio) {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    banner.innerText = "⚠️ " + messaggio;
    banner.classList.add('show');
    
    // Rimuove la notifica dopo 3.5 secondi
    setTimeout(() => {
        banner.classList.remove('show');
    }, 3500);
}

socket.on('errore', (m) => mostraErrore(m));
socket.on('fine_partita', (cl) => {
    alert("🏆 CLASSIFICA FINALE:\n" + cl.map((p, i) => `${i + 1}° ${p.nome}: ${p.punti}pt`).join('\n'));
    location.reload();
});

// Funzioni per l'apertura e chiusura del Regolamento
window.apriRegole = () => {
    document.getElementById('modal-regole').style.display = 'block';
};

window.chiudiRegole = () => {
    document.getElementById('modal-regole').style.display = 'none';
};

// Chiudi il modal cliccando fuori dal riquadro
window.onclick = (event) => {
    const modal = document.getElementById('modal-regole');
    if (event.target === modal) {
        modal.style.display = 'none';
    }
};