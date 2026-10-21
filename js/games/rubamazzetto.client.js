// =============================================
// MOTORE CLIENT RUBAMAZZETTO
// =============================================
socket.on('conferma_inizio_rubamazzetto', (dati) => {
    currentGameType = 'rubamazzetto';
    window.ultimoStatoGioco = dati;
    nascondiErrore();

    const titleEl = document.getElementById('game-title');
    if (titleEl) titleEl.innerText = 'Lucas';

    switchSection('game-area');

    const areaScommessa = document.getElementById('dichiarazione-area');
    if (areaScommessa) areaScommessa.style.display = 'none';

    const scartiBar = document.getElementById('ciapano-scarti-bar');
    if (scartiBar) scartiBar.style.display = 'none';

    aggiornaMazzoScopa(dati.mazzoRimanente);

    renderGiocatoriRubamazzetto(dati);
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

socket.on('mossa_rubamazzetto', (dati) => {
    if (dati.carta) sound.playCardPlay(dati.carta);
    if (dati.tipo === 'furto' || dati.tipoPresa === 'furto') {
        const mioIndice = window.ultimoStatoGioco?.tuttiGiocatori?.findIndex(p => p.isMe || p.socketId === socket.id);
        const isMe = (dati.playerIdx === mioIndice);
        sound.playTrickWon(isMe);
        const pBlock = document.querySelector(`.player-block[data-player-id="${dati.playerIdx}"]`);
        if (pBlock) {
            pBlock.classList.add('winner-pulse');
            setTimeout(() => pBlock.classList.remove('winner-pulse'), 1200);
            const furtoBadge = document.createElement('div');
            furtoBadge.className = 'scopa-float-badge';
            furtoBadge.style.background = 'linear-gradient(135deg, #9b59b6, #8e44ad)';
            furtoBadge.style.color = '#fff';
            furtoBadge.innerHTML = `🥷 FURTO!`;
            pBlock.appendChild(furtoBadge);
            setTimeout(() => furtoBadge.remove(), 1300);
        }
    }
});

socket.on('fine_partita_rubamazzetto', (data) => {
    if (window.clientTurnInterval) {
        clearInterval(window.clientTurnInterval);
        window.clientTurnInterval = null;
    }
    sessionStorage.removeItem('lucas_room');

    const modal = document.getElementById('modal-endgame');
    if (modal) {
        modal.style.display = 'block';
        const h2El = modal.querySelector('h2');
        if (h2El) h2El.innerText = "Classifica Finale Rubamazzetto";
        const listEl = document.getElementById('endgame-list');
        if (listEl && data.classifica) {
            listEl.innerHTML = data.classifica.map(p => {
                const medal = p.posizione === 1 ? '🥇' : p.posizione === 2 ? '🥈' : p.posizione === 3 ? '🥉' : `#${p.posizione}`;
                const eloStr = p.eloChange ? ` (ELO ${p.eloChange > 0 ? '+' : ''}${p.eloChange})` : '';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <span>${medal} ${renderNomeConStemma(p.nome, p.stemma)}</span>
                        <span style="color: #9b59b6; font-weight: bold;">${p.carteMazzetto} carte${eloStr}</span>
                    </div>
                `;
            }).join('');
        }
    }
});

function renderGiocatoriRubamazzetto(data) {
    const playersCircle = document.getElementById('players-circle');
    const cardsOnTable = document.getElementById('cards-on-table');
    const infoGiro = document.getElementById('info-giro');

    playersCircle.innerHTML = '';
    renderTavoloBanco(cardsOnTable, data.tavolo);

    const numPlayers = data.tuttiGiocatori.length;
    let mioIndice = data.tuttiGiocatori.findIndex(p => p.isMe || p.socketId === socket.id);
    if (mioIndice === -1) mioIndice = 0;

    infoGiro.innerText = `Smazzata ${data.smazzataNum} | Mazzo rimanente: ${data.mazzoRimanente}`;

    const isMobile = window.innerWidth <= 768;
    const { scalaPlayerBlock } = getPlayerScaleAndCardScale(numPlayers, isMobile);

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

        const ruolo = p.isMazziere ? " (Mazziere)" : "";
        const nomeConStemma = renderNomeConStemma(p.nome, p.stemma);
        let timerHtml = "";
        if (data.turnoAttuale === serverPlayerIndex && p.isHuman !== false) {
            timerHtml = `<div class="turn-timer" id="turn-timer-display" style="display: none;">30s</div>`;
        }

        let cimaHtml = '';
        if (p.cimaMazzetto) {
            const iconSeme = getSemeSimbolo(p.cimaMazzetto.seme);
            cimaHtml = `
                <div class="cima-mazzetto-box" title="Cima del mazzetto: rubabile con carta uguale!">
                    <span class="cima-mazzetto-label">Cima:</span>
                    <span class="cima-mazzetto-valore">${p.cimaMazzetto.valore} ${iconSeme}</span>
                </div>
            `;
        } else {
            cimaHtml = `<div style="font-size:0.75rem; color:#888; margin-top:2px;">(Mazzetto vuoto)</div>`;
        }

        pBlock.innerHTML = `
            <div class="name">${nomeConStemma}${ruolo}</div>
            <div class="stats"><span class="rubamazzetto-badge">Mazzetto: ${p.mazzettoCount || 0}</span></div>
            ${cimaHtml}
            ${timerHtml}
        `;

        if (isMe) {
            const myHandCont = document.createElement('div');
            myHandCont.id = 'tu-mano';
            pBlock.appendChild(myHandCont);
            renderTuaManoRubamazzetto(myHandCont, p.mano || data.mano, serverPlayerIndex === data.turnoAttuale);
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
    }
}

function renderTuaManoRubamazzetto(handCont, mano, isMyTurn) {
    if (!handCont) return;
    handCont.innerHTML = '';
    const carteDaDisegnare = (mano || []).filter(c => !c.giocata);
    const numCarte = carteDaDisegnare.length;
    const { dynamicScale, marginLeft } = calcolaLayoutCarteMano(numCarte);

    carteDaDisegnare.forEach((c, idx) => {
        const div = document.createElement('div');
        div.style.transform = `scale(${dynamicScale})`;
        div.style.setProperty('--card-scale', dynamicScale);
        div.style.transformOrigin = "bottom center";
        if (idx > 0) div.style.marginLeft = `${marginLeft}px`;
        div.className = `card seme-${c.seme} val-${c.valore}`;
        div.style.zIndex = 10 + idx;

        if (isMyTurn) {
            div.style.cursor = 'pointer';
        }

        div.onclick = () => {
            if (isMyTurn && canPlay && !isReplayMode) {
                nascondiErrore();
                canPlay = false;
                sound.playCardPlay(c);
                socket.emit('gioca_carta_rubamazzetto', { cartaIdx: mano.indexOf(c) });
            }
        };
        handCont.appendChild(div);
    });
}
