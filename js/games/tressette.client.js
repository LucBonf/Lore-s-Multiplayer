// =============================================
// MOTORE CLIENT TRESSETTE
// =============================================
const PESO_PRESA_TRESSETTE_CLIENT = {
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

socket.on('conferma_inizio_tressette', (dati) => {
    currentGameType = 'tressette';
    window.ultimoStatoGioco = dati;
    nascondiErrore();

    const titleEl = document.getElementById('game-title');
    if (titleEl) titleEl.innerText = 'Lucas';

    switchSection('game-area');

    const areaScommessa = document.getElementById('dichiarazione-area');
    if (areaScommessa) areaScommessa.style.display = 'none';

    const scartiBar = document.getElementById('ciapano-scarti-bar');
    if (scartiBar) scartiBar.style.display = 'none';

    const chiamataBanner = document.getElementById('briscola-chiamata-banner');
    if (chiamataBanner) chiamataBanner.style.display = 'none';

    const deckCont = document.getElementById('briscola-deck-container');
    if (deckCont) deckCont.style.display = 'none';

    const signalsBar = document.getElementById('tressette-signals-bar');
    if (signalsBar) signalsBar.style.display = (dati.numPlayers === 4) ? 'flex' : 'none';

    renderGiocatoriTressette(dati);
    updateChatVisibility(dati.tuttiGiocatori);

    const pAttuale = dati.tuttiGiocatori[dati.turnoAttuale];
    const eMioTurno = pAttuale && (pAttuale.isMe || pAttuale.socketId === socket.id);
    if (eMioTurno) {
        sound.playYourTurn();
    }

    if (window.clientTurnInterval) {
        clearInterval(window.clientTurnInterval);
        window.clientTurnInterval = null;
    }
    const timerDisplay = document.getElementById('turn-timer-display');
    if (timerDisplay) {
        let timeLeft = 30;
        window.clientTurnInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 10) {
                timerDisplay.style.display = 'block';
                timerDisplay.innerText = `${timeLeft}s`;
            }
            if (timeLeft <= 0) {
                clearInterval(window.clientTurnInterval);
                timerDisplay.innerText = "Timeout!";
            }
        }, 1000);
    }

    canPlay = false;
    setTimeout(() => { canPlay = true; }, 400);
});

socket.on('mossa_tressette', (dati) => {
    if (dati.card) sound.playCardPlay(dati.card);
});

socket.on('segnale_tressette', ({ playerIdx, nome, tipo }) => {
    if (tipo === 'busso') {
        if (sound.playKnock) sound.playKnock();
    } else {
        if (sound.playCardPlay) sound.playCardPlay();
    }

    const pBlock = document.querySelector(`.player-block[data-player-id="${playerIdx}"]`);
    if (pBlock) {
        const old = pBlock.querySelector('.tressette-signal-popup');
        if (old) old.remove();

        const popup = document.createElement('div');
        popup.className = 'tressette-signal-popup';
        if (tipo === 'busso') {
            popup.innerHTML = `👊 <b>${nome}</b>: Bussa! (Carichi forti)`;
            popup.style.borderColor = '#3498db';
        } else if (tipo === 'striscio') {
            popup.innerHTML = `📜 <b>${nome}</b>: Striscia! (Niente carichi)`;
            popup.style.borderColor = '#9b59b6';
        } else {
            popup.innerHTML = `🕊️ <b>${nome}</b>: Vola! (Ultima carta)`;
            popup.style.borderColor = '#2ecc71';
        }
        pBlock.appendChild(popup);
        setTimeout(() => { if (popup.parentNode) popup.remove(); }, 2500);
    }
});

function setupTressetteSignals() {
    const btnBusso = document.getElementById('btn-tressette-busso');
    const btnStriscio = document.getElementById('btn-tressette-striscio');
    const btnVolo = document.getElementById('btn-tressette-volo');

    if (btnBusso) btnBusso.onclick = () => socket.emit('segnale_tressette', { tipo: 'busso' });
    if (btnStriscio) btnStriscio.onclick = () => socket.emit('segnale_tressette', { tipo: 'striscio' });
    if (btnVolo) btnVolo.onclick = () => socket.emit('segnale_tressette', { tipo: 'volo' });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTressetteSignals);
} else {
    setupTressetteSignals();
}

socket.on('vincitore_presa_tressette', ({ vincitoreId, vincitoreIdx, vincitoreNome, cartaVincente }) => {
    const mioIndice = window.ultimoStatoGioco?.tuttiGiocatori?.findIndex(p => p.isMe || p.socketId === socket.id);
    const isMe = (vincitoreIdx !== undefined) ? (vincitoreIdx === mioIndice) : (window.ultimoStatoGioco?.tuttiGiocatori?.[mioIndice]?.id === vincitoreId);
    sound.playTrickWon(isMe);

    const targetIdx = (vincitoreIdx !== undefined) ? vincitoreIdx : window.ultimoStatoGioco?.tuttiGiocatori?.findIndex(p => p.id === vincitoreId);
    if (targetIdx !== -1 && targetIdx !== undefined) {
        const pBlock = document.querySelector(`.player-block[data-player-id="${targetIdx}"]`);
        if (pBlock) {
            pBlock.classList.add('winner-pulse');
            setTimeout(() => pBlock.classList.remove('winner-pulse'), 1200);
        }
    }
});

socket.on('fine_smazzata_tressette', (data) => {
    const righe = (data.punteggi || []).map(p => {
        const dett = p.dettaglio || {};
        const badges = [];
        if (dett.assi > 0) badges.push(`<span class="recap-badge">👑 ${dett.assi} ${dett.assi === 1 ? 'Asso' : 'Assi'} (+${dett.assi})</span>`);
        if (dett.puntiPezzi > 0) badges.push(`<span class="recap-badge">🃏 ${dett.pezzi} Carichi/Fig. (+${dett.puntiPezzi})</span>`);
        if (dett.ultima > 0) badges.push(`<span class="recap-badge" style="background:rgba(46,204,113,0.25);border-color:#2ecc71;">⭐ Ultima Presa (+1)</span>`);
        return {
            nome: p.nome,
            stemma: p.stemma,
            badge: badges.join(' '),
            gain: `+${p.puntiSmazzata || 0} pt`,
            total: `Tot: ${p.puntiTotali || 0} pt`
        };
    });
    mostraFineSmazzataGenerica({
        titolo: `🏁 Fine Smazzata ${data.smazzataNum || ''}`,
        righe
    });
});

socket.on('fine_partita_tressette', (data) => {
    const signalsBar = document.getElementById('tressette-signals-bar');
    if (signalsBar) signalsBar.style.display = 'none';

    if (window.clientTurnInterval) {
        clearInterval(window.clientTurnInterval);
        window.clientTurnInterval = null;
    }
    sessionStorage.removeItem('lucas_room');

    const modal = document.getElementById('modal-endgame');
    if (modal) {
        modal.style.display = 'block';
        const h2El = modal.querySelector('h2');
        if (h2El) h2El.innerText = "Classifica Finale Tressette";
        const listEl = document.getElementById('endgame-list');
        if (listEl && data.classifica) {
            listEl.innerHTML = data.classifica.map(p => {
                const medal = p.posizione === 1 ? '🥇' : p.posizione === 2 ? '🥈' : p.posizione === 3 ? '🥉' : `#${p.posizione}`;
                const eloStr = p.eloChange ? ` (ELO ${p.eloChange > 0 ? '+' : ''}${p.eloChange})` : '';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <span>${medal} ${renderNomeConStemma(p.nome, p.stemma)}</span>
                        <span style="color: #3498db; font-weight: bold;">${p.puntiTotali} pt${eloStr}</span>
                    </div>
                `;
            }).join('');
        }
    }
});

function renderGiocatoriTressette(data) {
    const playersCircle = document.getElementById('players-circle');
    const cardsOnTable = document.getElementById('cards-on-table');
    const infoGiro = document.getElementById('info-giro');

    const prevTableCount = window.ultimoTavoloCount || 0;
    const currentTableCount = data.tavolo ? data.tavolo.length : 0;
    if (currentTableCount > prevTableCount) {
        const ultimaGiocata = data.tavolo[currentTableCount - 1];
        sound.playCardPlay(ultimaGiocata ? ultimaGiocata.card : null);
    }
    window.ultimoTavoloCount = currentTableCount;

    playersCircle.innerHTML = '';
    cardsOnTable.innerHTML = '';

    const numPlayers = data.tuttiGiocatori.length;
    let mioIndice = data.tuttiGiocatori.findIndex(p => p.isMe || p.socketId === socket.id);
    if (mioIndice === -1) mioIndice = 0;

    const talloneTxt = (numPlayers === 2 && data.mazzoRimanente > 0) ? ` | Tallone: ${data.mazzoRimanente} carte` : '';
    infoGiro.innerText = `Smazzata ${data.smazzataNum} | Limite: ${data.limitePunti || 21} pt${talloneTxt}`;

    const isMobile = window.innerWidth <= 768;
    const { scalaPlayerBlock, scalaTableCard } = getPlayerScaleAndCardScale(numPlayers, isMobile);

    const posizioniCarteTavoloPerGiocatore = new Map();
    const raggioCarteX = 26;
    const raggioCarteY = 18;

    for (let i = 0; i < numPlayers; i++) {
        const serverPlayerIndex = (mioIndice + i) % numPlayers;
        const p = data.tuttiGiocatori[serverPlayerIndex];
        const isMe = p.isMe || (p.socketId === socket.id);

        const pos = getPosizioneGiocatoreTavolo(serverPlayerIndex, mioIndice, numPlayers, isMobile);

        const pBlock = document.createElement('div');
        pBlock.className = 'player-block';
        pBlock.setAttribute('data-player-id', serverPlayerIndex);
        pBlock.setAttribute('data-socket-id', isMe ? 'me' : (p.socketId || ''));
        if (isMe) pBlock.classList.add('me');
        if (data.turnoAttuale === serverPlayerIndex) pBlock.classList.add('active-turn');

        pBlock.style.left = `${pos.posX}%`;
        pBlock.style.top = `${pos.posY}%`;
        pBlock.style.transform = isMe ? 'translate(-50%, -50%)' : `translate(-50%, -50%) scale(${scalaPlayerBlock})`;

        const ruoloMazziere = p.isMazziere ? " (Mazziere)" : "";
        const nomeConStemma = renderNomeConStemma(p.nome, p.stemma);
        let timerHtml = "";
        if (data.turnoAttuale === serverPlayerIndex && p.isHuman !== false) {
            timerHtml = `<div class="turn-timer" id="turn-timer-display" style="display: none;">30s</div>`;
        }

        pBlock.innerHTML = `
            <div class="name">${nomeConStemma}${ruoloMazziere}</div>
            <div class="stats"><span class="tressette-punti-badge">Punti: ${p.puntiTotali}</span> | Prese: ${p.cartePreseCount || 0}</div>
            ${timerHtml}
        `;

        if (isMe) {
            const myHandCont = document.createElement('div');
            myHandCont.id = 'tu-mano';
            pBlock.appendChild(myHandCont);
            renderTuaManoTressette(myHandCont, p.mano || data.mano, serverPlayerIndex === data.turnoAttuale, data.tavolo);
        } else {
            const oppHandCont = document.createElement('div');
            oppHandCont.className = 'opponent-hand';
            const carteInManoCount = p.numCarte !== undefined ? p.numCarte : (p.mano ? p.mano.length : 0);

            let margineNegativo = 0;
            if (carteInManoCount > 1) {
                const maxSpan = isMobile ? 65 : 125;
                const cW = isMobile ? 22 : 35;
                const spazioPerCarta = (maxSpan - cW) / (carteInManoCount - 1);
                margineNegativo = Math.min(0, Math.round(spazioPerCarta - cW));
            }

            for (let c = 0; c < carteInManoCount; c++) {
                const cardBack = document.createElement('div');
                cardBack.className = 'card-back';
                if (c > 0) cardBack.style.marginLeft = `${margineNegativo}px`;
                oppHandCont.appendChild(cardBack);
            }
            pBlock.appendChild(oppHandCont);
        }

        playersCircle.appendChild(pBlock);

        const posCarta = getPosizioneCartaTavolo(serverPlayerIndex, mioIndice, numPlayers, isMobile);
        posizioniCarteTavoloPerGiocatore.set(serverPlayerIndex, posCarta);
    }

    // Carta vincente sul tavolo
    let winnerCardDiv = null;
    let maxPeso = -1;
    let semeUscita = data.tavolo && data.tavolo.length > 0 ? data.tavolo[0].card.seme : null;

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

            const rot = ((pId * 5) % 9) - 4;
            divCartaTavolo.style.transform = `translate(-50%, -50%) scale(${scalaTableCard}) rotate(${rot}deg)`;

            const pObj = data.tuttiGiocatori[pId];
            if (pObj) {
                const badge = document.createElement('div');
                badge.className = 'table-card-player-badge';
                badge.innerText = pObj.isMe ? 'Tu' : (pObj.nome || `P${pId + 1}`);
                divCartaTavolo.appendChild(badge);
            }

            if (c.seme === semeUscita) {
                const peso = PESO_PRESA_TRESSETTE_CLIENT[c.valore] || 0;
                if (peso > maxPeso) {
                    maxPeso = peso;
                    winnerCardDiv = divCartaTavolo;
                }
            }

            cardsOnTable.appendChild(divCartaTavolo);
        }
    });

    if (winnerCardDiv) {
        winnerCardDiv.classList.add('card-winning');
    }
}

function renderTuaManoTressette(handCont, mano, isMyTurn, tavolo) {
    if (!handCont) return;
    handCont.innerHTML = '';

    const carteDaDisegnare = (mano || []).filter(c => !c.giocata);

    const ORDINE_SEMI = { "Denari": 1, "Spade": 2, "Coppe": 3, "Bastoni": 4 };
    carteDaDisegnare.sort((a, b) => {
        const diffSeme = (ORDINE_SEMI[a.seme] || 0) - (ORDINE_SEMI[b.seme] || 0);
        if (diffSeme !== 0) return diffSeme;
        return (PESO_PRESA_TRESSETTE_CLIENT[b.valore] || 0) - (PESO_PRESA_TRESSETTE_CLIENT[a.valore] || 0);
    });

    const numCarte = carteDaDisegnare.length;
    const { dynamicScale, marginLeft } = calcolaLayoutCarteMano(numCarte);

    const semeUscita = tavolo && tavolo.length > 0 ? tavolo[0].card.seme : null;
    const haSemeUscita = semeUscita ? carteDaDisegnare.some(c => c.seme === semeUscita) : false;

    carteDaDisegnare.forEach((c, idx) => {
        const div = document.createElement('div');
        div.style.transform = `scale(${dynamicScale})`;
        div.style.setProperty('--card-scale', dynamicScale);
        div.style.transformOrigin = "bottom center";
        if (idx > 0) div.style.marginLeft = `${marginLeft}px`;
        div.className = `card seme-${c.seme} val-${c.valore}`;
        div.style.zIndex = 10 + idx;

        if (isMyTurn && haSemeUscita && c.seme !== semeUscita) {
            div.style.opacity = '0.45';
            div.style.filter = 'grayscale(50%)';
            div.style.cursor = 'not-allowed';
        } else if (isMyTurn) {
            div.style.cursor = 'pointer';
        }

        div.onclick = () => {
            if (isMyTurn && canPlay && !isReplayMode) {
                if (haSemeUscita && c.seme !== semeUscita) {
                    const lang = localStorage.getItem('lucas_lang') || 'it';
                    const d = dictionary[lang] || dictionary['it'];
                    const template = d.alertMustFollowSuit || "Devi rispondere al seme di uscita ({suit})!";
                    mostraErrore(template.replace('{suit}', semeUscita));
                    return;
                }
                nascondiErrore();
                canPlay = false;
                sound.playCardPlay(c);
                socket.emit('gioca_carta_tressette', { cartaIdx: mano.indexOf(c) });
            }
        };
        handCont.appendChild(div);
    });
}