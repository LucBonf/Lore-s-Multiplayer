const socket = io();
let qtaAttuale = 0; // Per validazione locale
let canPlay = true;

let sessionToken = sessionStorage.getItem('lucas_token');
if (!sessionToken) {
    sessionToken = Math.random().toString(36).substring(2, 12);
    sessionStorage.setItem('lucas_token', sessionToken);
}

socket.on('connect', () => {
    const savedCode = sessionStorage.getItem('lucas_room');
    if (savedCode) {
        socket.emit('riconnetti', { code: savedCode, token: sessionToken });
    }
});

socket.on('riconnessione_fallita', () => {
    sessionStorage.removeItem('lucas_room');
});

// =========================================
//   LOGICA LOGIN E CLASSIFICA
// =========================================

let userProfile = null;

window.eseguiLogin = () => {
    const code = document.getElementById('login-code').value.trim();
    const nickname = document.getElementById('login-nickname').value.trim();
    if (!code) {
        mostraErrore("Devi inserire un codice segreto!");
        return;
    }
    socket.emit('login', { uniqueCode: code, nickname: nickname, token: sessionToken });
};

window.continuaComeOspite = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const guestId = "GUEST_" + randomSuffix;
    socket.emit('login', { uniqueCode: guestId, nickname: "Ospite " + randomSuffix, token: sessionToken });
};

socket.on('login_ok', (profile) => {
    userProfile = profile;
    document.getElementById('login-menu').style.display = 'none';
    document.getElementById('setup-menu').style.display = 'block';
    
    // Mostriamo i dati dell'utente nel menu setup
    document.getElementById('welcome-message').innerHTML = `
        Benvenuto, ${profile.nickname}! 
        <div style="font-size:0.9rem; margin-top:5px; color:#ddd;">Partite Vinte: ${profile.partiteVinte} | Punti: ${profile.punteggioTotale}</div>
    `;
});

socket.on('login_err', (msg) => {
    mostraErrore(msg);
});

window.apriClassifica = () => {
    document.getElementById('modal-classifica').style.display = 'block';
    socket.emit('richiedi_classifica');
};

window.chiudiClassifica = () => {
    document.getElementById('modal-classifica').style.display = 'none';
};

socket.on('classifica_dati', (dati) => {
    const container = document.getElementById('leaderboard-list');
    if (dati.length === 0) {
        container.innerHTML = "<p style='text-align:center;'>Nessun dato ancora disponibile in classifica.</p>";
        return;
    }
    container.innerHTML = dati.map((u, i) => `
        <div style="display:flex; justify-content:space-between; border-bottom: 1px solid #555; padding: 10px 0;">
            <span><strong>${i+1}°.</strong> ${u.nickname}</span>
            <span>${u.punteggioTotale} pt (${u.partiteVinte} Vinte)</span>
        </div>
    `).join('');
});

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
            if (isMyTurn && fase === 'gioco' && canPlay) {
                canPlay = false; // Blocca click multipli istantanei
                socket.emit('gioca_carta', { cartaIdx: mano.indexOf(c) });
            }
        };
        handCont.appendChild(div);
    });
}

window.creaNuovaStanza = () => {
    sessionStorage.removeItem('lucas_room');
    const nome = userProfile ? userProfile.nickname : "Host";
    const num = document.getElementById('select-players').value;
    socket.emit('crea_lobby', { nome: nome, numGiocatori: num, token: sessionToken, uniqueCode: userProfile ? userProfile.uniqueCode : null });
};

window.uniscitiAStanza = () => {
    const nome = userProfile ? userProfile.nickname : "Giocatore";
    const code = document.getElementById('input-room-code').value.toUpperCase();
    socket.emit('unisciti_lobby', { nome: nome, code: code, token: sessionToken, uniqueCode: userProfile ? userProfile.uniqueCode : null });
};

window.iniziaPartitaVera = () => socket.emit('richiesta_inizio_partita');

window.inviaDichiarazione = () => {
    if (!canPlay) return;
    const val = parseInt(document.getElementById('bet-input').value);
    if (val > qtaAttuale) {
        alert(`Non puoi dichiarare più di ${qtaAttuale}!`);
        return;
    }
    canPlay = false; // Blocca click multipli
    socket.emit('invia_scommessa', val);
};

socket.on('lobby_creata', (d) => {
    sessionStorage.setItem('lucas_room', d.code);
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
        sessionStorage.setItem('lucas_room', dati.code);
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

    // --- MICRO-RITARDO SUI CLICK ---
    // Ritarda la possibilità di giocare una carta non appena lo stato viene ricevuto e renderizzato, evitando carte "istantanee"
    canPlay = false;
    setTimeout(() => { canPlay = true; }, 500);
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
    sessionStorage.removeItem('lucas_room');
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
    const modalRegole = document.getElementById('modal-regole');
    const modalClassifica = document.getElementById('modal-classifica');
    if (event.target === modalRegole) {
        modalRegole.style.display = 'none';
    }
    if (event.target === modalClassifica) {
        modalClassifica.style.display = 'none';
    }
};