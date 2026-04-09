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
    switchSection('setup-menu');
});

// --- NOVITÀ: Gestione Centralizzata delle Sezioni (Resiliente) ---
function switchSection(activeId) {
    try {
        const sections = ['login-menu', 'setup-menu', 'lobby-wait', 'game-area', 'classifica-finale-container'];
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = (id === activeId) ? 'block' : 'none';
            }
        });

        // Toggle della visibilità dei tasti in alto a destra (Swap Classifica / ESCI)
        const btnLeaderboard = document.getElementById('btn-leaderboard');
        const btnEsci = document.getElementById('btn-esci-principale');
        
        if (btnLeaderboard && btnEsci) {
            const isGame = (activeId === 'game-area');
            btnLeaderboard.style.display = isGame ? 'none' : 'inline-block';
            btnEsci.style.display = isGame ? 'inline-block' : 'none';
        }
    } catch (e) {
        console.error("Errore in switchSection:", e);
    }
}
window.switchSection = switchSection;

// --- INIZIALIZZAZIONE UI ALL'AVVIO ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        const savedUser = localStorage.getItem('lucas_user');
        const isRoomActive = sessionStorage.getItem('lucas_room');

        if (savedUser) {
            const user = JSON.parse(savedUser);
            socket.emit('login', { uniqueCode: user.uniqueCode, nickname: user.nickname, token: sessionToken });
        } else {
            // Se non abbiamo un utente salvato, mostriamo subito il login
            switchSection('login-menu');
        }

        // --- SICUREZZA TOTALE (SELF-HEALING): SE DOPO 3 SECONDI IL TAVOLO È ANCORA VUOTO, FORZA ---
        setTimeout(() => {
            const sections = ['game-area', 'lobby-wait', 'setup-menu', 'login-menu'];
            const isAnythingVisible = sections.some(id => {
                const el = document.getElementById(id);
                return el && el.style.display !== 'none';
            });

            if (!isAnythingVisible) {
                console.warn("Rilevato stato 'Empty Table'. Tentativo di ripristino UI...");
                if (savedUser) {
                    switchSection('setup-menu');
                } else {
                    switchSection('login-menu');
                }
            }
        }, 3000);
    } catch (err) {
        console.error("Errore fatale in inizializzazione:", err);
        // Fallback estremo: prova a mostrare il login
        switchSection('login-menu');
    }
});

// =========================================
//   LOGICA LOGIN E CLASSIFICA
// =========================================

let userProfile = null;

window.eseguiLogin = () => {
    const nickname = document.getElementById('login-nickname').value.trim();
    const pin = document.getElementById('login-pin').value.trim();
    if (!nickname) {
        mostraErrore("Devi inserire un Nickname!");
        return;
    }
    if (!pin || pin.length !== 4 || isNaN(pin)) {
        mostraErrore("Devi inserire un PIN numerico di 4 cifre!");
        return;
    }
    const code = nickname.toLowerCase() + "_" + pin;
    socket.emit('login', { uniqueCode: code, nickname: nickname, token: sessionToken });
};

window.continuaComeOspite = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const guestId = "GUEST_" + randomSuffix;
    socket.emit('login', { uniqueCode: guestId, nickname: "Ospite " + randomSuffix, token: sessionToken });
};

socket.on('login_ok', (profile) => {
    userProfile = profile;
    // Persistenza identità
    localStorage.setItem('lucas_user', JSON.stringify({ uniqueCode: profile.uniqueCode, nickname: profile.nickname }));
    
    // Mostriamo il menu di setup solo se non siamo già in partita
    if (!sessionStorage.getItem('lucas_room')) {
        switchSection('setup-menu');
    }

    // Mostriamo i dati dell'utente nel menu setup
    const welcome = document.getElementById('welcome-message');
    if (welcome) {
        welcome.innerHTML = `
            Benvenuto, ${profile.nickname}! 
            <div style="font-size:0.9rem; margin-top:5px; color:#ddd;">Partite Vinte: ${profile.partiteVinte} | Punti: ${profile.punteggioTotale}</div>
        `;
    }
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

    // SCALE DINAMICHE: Rimpiccioliamo le carte se ci sono tanti giocatori
    const isMobile = window.innerWidth <= 768;
    let scalaPlayerBlock = isMobile ? 1 : 1; 
    let scalaTableCard = isMobile ? 0.4 : 0.8; // Su mobile le carte al centro devono essere molto piccole

    if (numPlayers >= 7) {
        scalaPlayerBlock = isMobile ? 0.65 : 0.7;
        scalaTableCard = isMobile ? 0.3 : 0.55;
    } else if (numPlayers >= 5) {
        scalaPlayerBlock = isMobile ? 0.75 : 0.8;
        scalaTableCard = isMobile ? 0.35 : 0.7;
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
        pBlock.setAttribute('data-player-id', serverPlayerIndex);
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
                
                // Scala ridotta se siamo su mobile, altrimenti la versione desktop
                const isMobile = window.innerWidth <= 768;
                const scaleValue = isMobile ? 0.4 : 0.7;
                
                fronteDiv.style.transform = `scale(${scaleValue})`;
                fronteDiv.style.transformOrigin = "center";
                fronteDiv.style.margin = isMobile ? "-20px auto" : "10px auto"; // Spazio sopra e sotto ridotto su mobile
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

    // --- NOVITÀ: Identifichiamo la carta vincente attuale sul tavolo ---
    let maxForza = -1;
    let winnerCardDiv = null;

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
            divCartaTavolo.style.transform = `translate(-50%, -50%) scale(${scalaTableCard}) rotate(${randRot}deg)`;

            // Cerchiamo la carta più forte
            if (c.forza > maxForza) {
                maxForza = c.forza;
                winnerCardDiv = divCartaTavolo;
            }

            cardsOnTable.appendChild(divCartaTavolo);
        }
    });

    // Applichiamo l'evidenziazione alla carta vincente
    if (winnerCardDiv) {
        winnerCardDiv.classList.add('card-winning');
    }
}

// --- NOVITÀ: Animazione Vincitore Presa ---
socket.on('vincitore_presa', ({ playerId }) => {
    const playerBlock = document.querySelector(`.player-block[data-player-id="${playerId}"]`);
    if (playerBlock) {
        const badge = document.createElement('div');
        badge.className = 'winner-badge';
        badge.innerText = '🏆';
        playerBlock.appendChild(badge);
        
        // Rimuoviamo dopo 2 secondi (poco dopo la pulizia del tavolo)
        setTimeout(() => badge.remove(), 2000);
    }
});

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

    // --- 1. NOVITÀ: SCALA DINAMICA IN BASE AL NUMERO DI CARTE ---
    // Più carte hai, più diventano piccole (minimo 0.6 su desktop, 0.35 su mobile)
    const isMobile = window.innerWidth <= 768;
    const baseScale = isMobile ? 0.5 : 1.0;
    
    // Se hai più di 5 carte, iniziamo a rimpicciolirle
    let dynamicScale = baseScale;
    if (numCarte > 5) {
        // Riduciamo di un 5% per ogni carta oltre la quinta
        dynamicScale = baseScale * Math.max(0.65, 1 - (numCarte - 5) * 0.06);
    }

    // MATEMATICA: Più carte hai, più si incastrano per non uscire dallo schermo!
    let marginLeft = 0;
    if (numCarte > 10) {
        marginLeft = isMobile ? -35 : -50;
    } else if (numCarte > 7) {
        marginLeft = isMobile ? -25 : -35;
    } else if (numCarte > 4) {
        marginLeft = isMobile ? -15 : -15;
    }

    // Applichiamo la scala e il margine dinamico
    carteDaDisegnare.forEach((c, idx) => {
        const div = document.createElement('div');
        div.style.transform = `scale(${dynamicScale})`;
        div.style.transformOrigin = "center";
        if (idx > 0) div.style.marginLeft = `${marginLeft}px`;

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
                nascondiErrore(); // Rimuove eventuali messaggi di errore precedenti
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
    nascondiErrore(); // Rimuove eventuali messaggi di errore precedenti
    
    const inputEl = document.getElementById('bet-input');
    let val = parseInt(inputEl.value);
    
    // Se l'input è vuoto o non è un numero, imposta a 0 di default
    if (isNaN(val)) val = 0;
    
    if (val > qtaAttuale) {
        mostraErrore(`Non puoi dichiarare più di ${qtaAttuale}!`);
        return;
    }
    
    canPlay = false; // Blocca click multipli
    socket.emit('invia_scommessa', val);
};

window.esciDallaPartita = () => {
    console.log("Uscita dalla partita (Fast Exit)...");
    sessionStorage.removeItem('lucas_room');
    socket.emit('esci_partita');
    // Torniamo alla schermata di setup
    window.switchSection('setup-menu');
};

window.apriRegole = () => {
    document.getElementById('modal-regole').style.display = 'block';
};

window.chiudiRegole = () => {
    document.getElementById('modal-regole').style.display = 'none';
};

socket.on('lobby_creata', (d) => {
    sessionStorage.setItem('lucas_room', d.code);
    switchSection('lobby-wait');
    document.getElementById('display-room-code').innerText = d.code;
    document.getElementById('lobby-info').style.display = 'block';
    document.getElementById('start-game-btn').style.display = 'block';
    document.getElementById('joined-players-list').innerHTML = d.giocatori.map(p => `<div>👤 ${p.nome}</div>`).join('');
});

socket.on('aggiorna_lobby', (dati) => {
    switchSection('lobby-wait');

    // Mostriamo il codice stanza all'amico e la lista aggiornata
    if (dati.code) {
        sessionStorage.setItem('lucas_room', dati.code);
        document.getElementById('display-room-code').innerText = dati.code;
        document.getElementById('lobby-info').style.display = 'block';
    }

    document.getElementById('joined-players-list').innerHTML = dati.giocatori.map(p => `<div>👤 ${p.nome}</div>`).join('');
});

socket.on('conferma_inizio_partita', (dati) => {
    nascondiErrore(); // Pulisce messaggi vecchi all'arrivo di un nuovo stato
    qtaAttuale = dati.qtaCarte;
    switchSection('game-area');

    const pAttuale = dati.tuttiGiocatori[dati.turnoAttuale];
    const eMioTurno = (pAttuale.socketId === socket.id);

    // Gestione comparsa riquadro scommesse
    const areaScommessa = document.getElementById('dichiarazione-area');
    if (dati.fase === 'scommesse' && eMioTurno) {
        areaScommessa.style.display = 'block';
        const betInput = document.getElementById('bet-input');
        betInput.max = qtaAttuale;
        betInput.value = ""; // Svuota il campo per facilitare l'inserimento da mobile
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
let errorTimeout = null;

function mostraErrore(messaggio) {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    
    if (errorTimeout) clearTimeout(errorTimeout);
    
    banner.innerText = "⚠️ " + messaggio;
    banner.classList.add('show');
    
    errorTimeout = setTimeout(() => {
        banner.classList.remove('show');
    }, 3500);
}

function nascondiErrore() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.classList.remove('show');
    if (errorTimeout) clearTimeout(errorTimeout);
}

socket.on('errore', (m) => {
    mostraErrore(m);
    canPlay = true; // Sblocca l'interfaccia se c'è stato un errore (es. vincolo mazziere)
});
socket.on('fine_partita', (cl) => {
    sessionStorage.removeItem('lucas_room');
    
    // Popola la classifica della stanza nel modal
    const listHtml = cl.map((p, i) => {
        let pos = i === 0 ? "🥇" : (i === 1 ? "🥈" : (i === 2 ? "🥉" : `${i + 1}°`));
        let pts = p.punti;
        return `<div style="display: flex; justify-content: space-between; border-bottom: 1px solid #7f8c8d; padding: 5px 0;">
                    <span>${pos} ${p.nome}</span>
                    <span style="color: #f1c40f; font-weight: bold;">${pts} pt</span>
                </div>`;
    }).join('');
    
    document.getElementById('endgame-list').innerHTML = listHtml;
    document.getElementById('modal-endgame').style.display = 'block';
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