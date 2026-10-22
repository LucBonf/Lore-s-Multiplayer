// =============================================
// MOTORE CLIENT BRISCOLA
// =============================================
const PUNTI_BRISCOLA_CLIENT = { "Asso": 11, "3": 10, "Re": 4, "Cavallo": 3, "Fante": 2, "7": 0, "6": 0, "5": 0, "4": 0, "2": 0 };
const PESO_PRESA_BRISCOLA_CLIENT = { "Asso": 10, "3": 9, "Re": 8, "Cavallo": 7, "Fante": 6, "7": 5, "6": 4, "5": 3, "4": 2, "2": 1 };

socket.on('conferma_inizio_briscola', (dati) => {
    currentGameType = 'briscola';
    window.ultimoStatoGioco = dati;
    nascondiErrore();

    const titleEl = document.getElementById('game-title');
    if (titleEl) titleEl.innerText = 'Lucas';

    switchSection('game-area');

    const areaScommessa = document.getElementById('dichiarazione-area');
    if (areaScommessa) areaScommessa.style.display = 'none';

    const scartiBar = document.getElementById('ciapano-scarti-bar');
    if (scartiBar) scartiBar.style.display = 'none';

    renderGiocatoriBriscola(dati);
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

socket.on('mossa_briscola', (dati) => {
    if (dati.card) sound.playCardPlay(dati.card);
});

socket.on('vincitore_presa_briscola', ({ vincitoreId, vincitoreIdx, cartaVincente, puntiPresa }) => {
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

socket.on('fine_partita_briscola', (data) => {
    if (window.clientTurnInterval) {
        clearInterval(window.clientTurnInterval);
        window.clientTurnInterval = null;
    }
    sessionStorage.removeItem('lucas_room');

    const modal = document.getElementById('modal-endgame');
    if (modal) {
        modal.style.display = 'block';
        const h2El = modal.querySelector('h2');
        if (h2El) {
            h2El.innerText = data.variante === 'chiamata' ? "Fine Briscola Chiamata" : "Classifica Finale Briscola";
        }
        const listEl = document.getElementById('endgame-list');
        if (listEl && data.classifica) {
            let bannerHtml = '';
            if (data.variante === 'chiamata') {
                const esitoStr = data.vittoriaChiamante
                    ? `🏆 Vince la Coppia Chiamante (${data.chiamanteNome} & ${data.socioNome}) con ${data.puntiSquadraChiamante} pt!`
                    : `🛡️ Vincono i Buoni (Difesa) con ${data.puntiDifesa} pt!`;
                bannerHtml = `<div style="text-align:center; padding:10px; margin-bottom:12px; font-weight:bold; color:#f1c40f; background:rgba(230,126,34,0.25); border-radius:8px; border:1px solid #e67e22;">${esitoStr}</div>`;
            }
            listEl.innerHTML = bannerHtml + data.classifica.map(p => {
                const medal = p.posizione === 1 ? '🥇' : p.posizione === 2 ? '🥈' : p.posizione === 3 ? '🥉' : `#${p.posizione}`;
                const eloStr = p.eloChange ? ` (ELO ${p.eloChange > 0 ? '+' : ''}${p.eloChange})` : '';
                let ruoloTag = '';
                if (p.ruolo === 'chiamante') ruoloTag = ' <span class="briscola-ruolo-badge briscola-ruolo-chiamante">Chiamante</span>';
                else if (p.ruolo === 'socio') ruoloTag = ' <span class="briscola-ruolo-badge briscola-ruolo-socio">Socio</span>';
                else if (p.ruolo === 'buono') ruoloTag = ' <span class="briscola-ruolo-badge briscola-ruolo-buono">Buono</span>';

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <span>${medal} ${renderNomeConStemma(p.nome, p.stemma)}${ruoloTag}</span>
                        <span style="color: #e67e22; font-weight: bold;">${p.puntiTotali} pt${eloStr}</span>
                    </div>
                `;
            }).join('');
        }
    }
});

function renderGiocatoriBriscola(data) {
    const playersCircle = document.getElementById('players-circle');
    const cardsOnTable = document.getElementById('cards-on-table');
    const infoGiro = document.getElementById('info-giro');

    // Chiamata Banner
    const chiamataBanner = document.getElementById('briscola-chiamata-banner');
    const chiamataTesto = document.getElementById('briscola-chiamata-testo');
    if (chiamataBanner && chiamataTesto) {
        if (data.variante === 'chiamata' && data.cartaChiamata) {
            chiamataBanner.style.display = 'block';
            const socioInfo = data.socioRivelato ? ' | Socio svelato!' : ' (Socio Segreto 🤫)';
            chiamataTesto.innerHTML = `Chiamata: <span style="color:#fff;">${data.cartaChiamata.valore} di ${data.cartaChiamata.seme}</span> | Briscola: <span style="color:#e67e22;">${data.semeBriscola}</span>${socioInfo}`;
        } else {
            chiamataBanner.style.display = 'none';
        }
    }

    // Tallone e Briscola visibile sotto al mazzo
    const deckCont = document.getElementById('briscola-deck-container');
    const cartaScopertaEl = document.getElementById('briscola-carta-scoperta');
    const deckCountEl = document.getElementById('briscola-deck-count');
    if (deckCont && cartaScopertaEl && deckCountEl) {
        if (data.variante !== 'chiamata' && data.cartaBriscola && data.mazzoRimanente > 0) {
            deckCont.style.display = 'block';
            cartaScopertaEl.className = `card seme-${data.cartaBriscola.seme} val-${data.cartaBriscola.valore}`;
            deckCountEl.innerText = `${data.mazzoRimanente} carte`;
        } else {
            deckCont.style.display = 'none';
        }
    }

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

    const briscolaSemeTxt = data.semeBriscola ? `Briscola: ${data.semeBriscola}` : '';
    infoGiro.innerText = data.variante === 'chiamata'
        ? `Briscola Chiamata | ${briscolaSemeTxt}`
        : `${briscolaSemeTxt} | Tallone: ${data.mazzoRimanente} carte`;

    const isMobile = window.innerWidth <= 768;
    const { scalaPlayerBlock, scalaTableCard } = getPlayerScaleAndCardScale(numPlayers, isMobile);

    const posizioniCarteTavoloPerGiocatore = new Map();
    const raggioCarteX = 26;
    const raggioCarteY = 18;

    for (let i = 0; i < numPlayers; i++) {
        const serverPlayerIndex = (mioIndice + i) % numPlayers;
        const p = data.tuttiGiocatori[serverPlayerIndex];
        const isMe = p.isMe || (p.socketId === socket.id);

        let posX, posY;
        let angoloGradi;

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

        let ruoloHtml = '';
        if (p.ruolo === 'chiamante') ruoloHtml = '<span class="briscola-ruolo-badge briscola-ruolo-chiamante">Chiamante</span>';
        else if (p.ruolo === 'socio') ruoloHtml = '<span class="briscola-ruolo-badge briscola-ruolo-socio">Socio</span>';
        else if (p.ruolo === 'buono') ruoloHtml = '<span class="briscola-ruolo-badge briscola-ruolo-buono">Buono</span>';

        pBlock.innerHTML = `
            <div class="name">${nomeConStemma}${ruoloMazziere} ${ruoloHtml}</div>
            <div class="stats"><span class="briscola-punti-badge">Prese: ${p.cartePreseCount || 0}</span></div>
            ${timerHtml}
        `;

        if (isMe) {
            const myHandCont = document.createElement('div');
            myHandCont.id = 'tu-mano';
            pBlock.appendChild(myHandCont);
            renderTuaManoBriscola(myHandCont, p.mano || data.mano, serverPlayerIndex === data.turnoAttuale, data.semeBriscola);
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

            const isScoperta = Array.isArray(p.mano) && p.mano.length > 0 && p.mano[0] && p.mano[0].valore;
            for (let c = 0; c < carteInManoCount; c++) {
                if (isScoperta && p.mano[c]) {
                    const cardDiv = document.createElement('div');
                    cardDiv.className = `card seme-${p.mano[c].seme} val-${p.mano[c].valore}`;
                    cardDiv.style.width = isMobile ? '28px' : '44px';
                    cardDiv.style.height = isMobile ? '42px' : '66px';
                    cardDiv.style.backgroundSize = 'contain';
                    cardDiv.style.backgroundRepeat = 'no-repeat';
                    cardDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.4)';
                    cardDiv.style.borderRadius = '3px';
                    if (c > 0) cardDiv.style.marginLeft = `${margineNegativo}px`;
                    oppHandCont.appendChild(cardDiv);
                } else {
                    const cardBack = document.createElement('div');
                    cardBack.className = 'card-back';
                    if (c > 0) cardBack.style.marginLeft = `${margineNegativo}px`;
                    oppHandCont.appendChild(cardBack);
                }
            }
            pBlock.appendChild(oppHandCont);
        }

        playersCircle.appendChild(pBlock);

        const posCarta = getPosizioneCartaTavolo(serverPlayerIndex, mioIndice, numPlayers, isMobile);
        posizioniCarteTavoloPerGiocatore.set(serverPlayerIndex, posCarta);
    }

    // Calcolo carta temporaneamente vincente sul tavolo
    let winnerCardDiv = null;
    if (data.tavolo && data.tavolo.length > 0) {
        const semeBriscola = data.semeBriscola;
        const semeBase = data.tavolo[0].card.seme;
        let bestGiocata = data.tavolo[0];
        let bestDiv = null;

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

                if (index === 0) {
                    bestDiv = divCartaTavolo;
                } else {
                    const cSeme = c.seme;
                    const bSeme = bestGiocata.card.seme;
                    const cPeso = PESO_PRESA_BRISCOLA_CLIENT[c.valore] || 0;
                    const bPeso = PESO_PRESA_BRISCOLA_CLIENT[bestGiocata.card.valore] || 0;

                    if (cSeme === semeBriscola && bSeme !== semeBriscola) {
                        bestGiocata = giocata;
                        bestDiv = divCartaTavolo;
                    } else if (cSeme === bSeme && cPeso > bPeso) {
                        bestGiocata = giocata;
                        bestDiv = divCartaTavolo;
                    }
                }

                cardsOnTable.appendChild(divCartaTavolo);
            }
        });

        if (bestDiv) {
            bestDiv.classList.add('card-winning');
        }
    }
}

function renderTuaManoBriscola(handCont, mano, isMyTurn, semeBriscola) {
    if (!handCont) return;
    handCont.innerHTML = '';

    const carteDaDisegnare = (mano || []).filter(c => !c.giocata);

    // Ordina: prima le non-briscole per seme, poi le briscole alla fine
    carteDaDisegnare.sort((a, b) => {
        const aIsBriscola = a.seme === semeBriscola ? 1 : 0;
        const bIsBriscola = b.seme === semeBriscola ? 1 : 0;
        if (aIsBriscola !== bIsBriscola) return aIsBriscola - bIsBriscola;
        if (a.seme !== b.seme) return a.seme.localeCompare(b.seme);
        return (PESO_PRESA_BRISCOLA_CLIENT[b.valore] || 0) - (PESO_PRESA_BRISCOLA_CLIENT[a.valore] || 0);
    });

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
                socket.emit('gioca_carta_briscola', { cartaIdx: mano.indexOf(c) });
            }
        };
        handCont.appendChild(div);
    });
}
