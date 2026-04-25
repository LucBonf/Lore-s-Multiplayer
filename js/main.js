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

        // --- FIX AUTO-SCALE MOBILE ---
        const handleResize = () => {
            if (window.innerWidth <= 768) {
                const container = document.getElementById('game-container');
                if (container) {
                    const vh = window.innerHeight * 0.01;
                    document.documentElement.style.setProperty('--vh', `${vh}px`);
                    
                    // Se lo schermo è basso (es. iPhone SE) o stretto, riduciamo la scala globale
                    if (window.innerHeight < 750 || window.innerWidth < 380) {
                        const scale = Math.min(window.innerWidth / 400, window.innerHeight / 800, 0.9);
                        container.style.transform = `scale(${scale})`;
                        container.style.transformOrigin = 'center center';
                    } else {
                        container.style.transform = 'none';
                    }
                }
            }
        };
        window.addEventListener('resize', handleResize);
        handleResize();
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
    const { top10, userRank } = dati;

    if (!top10 || top10.length === 0) {
        container.innerHTML = "<p style='text-align:center;'>Nessun dato ancora disponibile in classifica.</p>";
        return;
    }

    let html = top10.map((u, i) => `
        <div style="display:flex; justify-content:space-between; border-bottom: 1px solid #555; padding: 10px 0;">
            <span><strong>${i+1}°.</strong> ${u.nickname}</span>
            <span>${u.punteggioTotale} pt (${u.partiteVinte} Vinte)</span>
        </div>
    `).join('');

    if (userRank) {
        const formattedPos = userRank.posizione.toLocaleString('it-IT');
        html += `
            <div style="margin-top: 20px; border-top: 2px solid #e67e22; padding-top: 15px; background: rgba(230, 126, 34, 0.1); border-radius: 0 0 8px 8px; padding: 15px;">
                <div style="display:flex; justify-content:space-between; color: #f1c40f; font-weight: bold;">
                    <span><strong>${formattedPos}°.</strong> ${userRank.nickname} (Tu)</span>
                    <span>${userRank.punteggioTotale} pt (${userRank.partiteVinte} Vinte)</span>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
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

    infoGiro.innerText = `Giro ${data.qtaCarte} | Somma: ${data.sommaScommesse}`;

    const numPlayers = data.tuttiGiocatori.length;
    const mioIndice = data.tuttiGiocatori.findIndex(p => p.socketId === socket.id);

    // SCALE DINAMICHE: Rimpiccioliamo i box se ci sono tanti giocatori
    const isMobile = window.innerWidth <= 768;
    let scalaPlayerBlock = isMobile ? 1 : 1; 
    let scalaTableCard = isMobile ? 0.4 : 0.8; 

    if (numPlayers >= 7) {
        scalaPlayerBlock = isMobile ? 0.65 : 0.7;
        scalaTableCard = isMobile ? 0.3 : 0.55;
    } else if (numPlayers >= 5) {
        scalaPlayerBlock = isMobile ? 0.75 : 0.8;
        scalaTableCard = isMobile ? 0.35 : 0.7;
    }

    const posizioniCarteTavoloPerGiocatore = new Map();
    const raggioCarteX = 26; // Aumentato da 18 per spandere orizzontalmente
    const raggioCarteY = 18; // Aumentato da 15 per distanziarle verticalmente

    for (let i = 0; i < numPlayers; i++) {
        const serverPlayerIndex = (mioIndice + i) % numPlayers;
        const p = data.tuttiGiocatori[serverPlayerIndex];
        const isMe = (p.socketId === socket.id);

        let posX, posY;
        let angoloGradi;

        if (isMe) {
            // POSIZIONE FISSA IN BASSO PER "ME"
            posX = 50;
            posY = 85; 
            angoloGradi = 90; // La carta lanciata salirà dritta
        } else {
            // POSIZIONAMENTO AVVERSARI IN UN ARCO SUPERIORE (160° -> 380°)
            const indexOpp = i - 1; // 0, 1, 2...
            const numOpp = numPlayers - 1;
            
            if (numOpp === 1) {
                angoloGradi = 270; // Singolo avversario in alto al centro
            } else {
                const startA = 160;
                const endA = 380;
                angoloGradi = startA + (indexOpp * (endA - startA) / (numOpp - 1));
            }

            const angoloRad = angoloGradi * (Math.PI / 180);
            posX = 50 + 44 * Math.cos(angoloRad);
            posY = 40 + 30 * Math.sin(angoloRad);
        }

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

        // POSIZIONE CARTE SUL TAVOLO: Coordinate relative per ogni giocatore
        let cartaX, cartaY;

        if (isMe) {
            cartaX = 50;
            cartaY = 68; // Portata a metà strada (da 62 a 68) tra il box (85) e il centro (circa 50)
        } else {
            // Distanziate le carte degli avversari per evitare il centro troppo affollato
            cartaX = 50 + raggioCarteX * Math.cos( angoloGradi * (Math.PI / 180) );
            cartaY = 44 + raggioCarteY * Math.sin( angoloGradi * (Math.PI / 180) ); // Centro carte abbassato coerentemente (da 42 a 44)
        }
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

    // --- NOVITÀ: SCALA PIÙ GENEROSA GRAZIE AL NUOVO SPAZIO ---
    const isMobile = window.innerWidth <= 768;
    const baseScale = isMobile ? 0.65 : 1.0; // Aumentata scala base su mobile (da 0.5 a 0.65)
    
    // Riduciamo la scala solo se necessario
    let dynamicScale = baseScale;
    if (numCarte > 7) {
        dynamicScale = baseScale * Math.max(0.45, 1 - (numCarte - 7) * 0.08); // Più aggressivo nella riduzione su mobile
    }

    // MATEMATICA: Margine calcolato per stare nei 98vw
    let marginLeft = 0;
    if (isMobile) {
        // Su mobile cerchiamo di usare tutto lo spazio
        if (numCarte > 1) {
            const overlapFactor = numCarte > 8 ? -30 : (numCarte > 5 ? -20 : -10);
            marginLeft = overlapFactor;
        }
    } else {
        if (numCarte > 10) marginLeft = -35;
        else if (numCarte > 7) marginLeft = -20;
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
    nascondiErrore();
    
    const inputEl = document.getElementById('bet-input');
    let val = parseInt(inputEl.value);
    
    // Se l'input è vuoto o non è un numero, mostriamo errore invece di mettere 0 di default
    if (isNaN(val)) {
        mostraErrore("Inserisci un numero per dichiarare!");
        return;
    }
    
    if (val < 0 || val > qtaAttuale) {
        mostraErrore(`Dichiarazione non valida! Puoi dichiarare da 0 a ${qtaAttuale}.`);
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
    const mazziereWarning = document.getElementById('mazziere-warning');

    if (dati.fase === 'scommesse' && eMioTurno) {
        areaScommessa.style.display = 'block';
        const betInput = document.getElementById('bet-input');
        betInput.max = qtaAttuale;
        betInput.value = ""; 
        betInput.focus();

        // Controllo se sono il mazziere per mostrare il vincolo
        const me = dati.tuttiGiocatori.find(p => p.socketId === socket.id);
        if (me && me.isMazziere) {
            const forbidden = dati.qtaCarte - dati.sommaScommesse;
            if (forbidden >= 0 && forbidden <= dati.qtaCarte) {
                mazziereWarning.innerText = `⚠️ VINCOLO MAZZIERE: Non puoi dichiarare ${forbidden}!`;
                mazziereWarning.style.display = 'block';
            } else {
                mazziereWarning.style.display = 'none';
            }
        } else {
            mazziereWarning.style.display = 'none';
        }
    } else {
        areaScommessa.style.display = 'none';
        if (mazziereWarning) mazziereWarning.style.display = 'none';
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