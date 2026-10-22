// =============================================
// MOTORE CLIENT SCOPA
// =============================================
window.scopaAnimazioneInCorso = false;
window.statoScopaInAttesa = null;

socket.on('conferma_inizio_scopa', (dati) => {
    currentGameType = 'scopa';
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

    if (window.scopaAnimazioneInCorso) {
        // Se c'è un'animazione in volo, salviamo lo stato e lo applichiamo al termine
        window.statoScopaInAttesa = dati;
        setTimeout(() => {
            if (window.statoScopaInAttesa) {
                renderGiocatoriScopa(window.statoScopaInAttesa);
                window.statoScopaInAttesa = null;
                window.scopaAnimazioneInCorso = false;
            }
        }, 900);
    } else {
        renderGiocatoriScopa(dati);
    }

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
    setTimeout(() => { canPlay = true; }, 350);
});

// ANIMAZIONE FLUIDA CARTA GIOCATA E PRESA (DINAMICA STILE SOLITALIAN)
function animazioneMossaScopa(dati, onComplete) {
    const carta = dati.cartaGiocata || dati.carta;
    if (!carta) {
        if (onComplete) onComplete();
        return;
    }

    const pBlock = document.querySelector(`.player-block[data-player-id="${dati.playerIdx}"]`);
    const centralTable = document.getElementById('central-table') || document.getElementById('cards-on-table');
    if (!pBlock || !centralTable) {
        if (onComplete) onComplete();
        return;
    }

    let startRect = null;
    const mioIndice = window.ultimoStatoGioco?.tuttiGiocatori?.findIndex(p => p.isMe || p.socketId === socket.id);
    const isMe = (dati.playerIdx === mioIndice);

    if (isMe) {
        const myCards = document.querySelectorAll('#tu-mano .card');
        for (let mc of myCards) {
            if (mc.dataset.seme === carta.seme && String(mc.dataset.valore) === String(carta.valore)) {
                startRect = mc.getBoundingClientRect();
                mc.style.opacity = '0';
                break;
            }
        }
    } else {
        const oppCards = pBlock.querySelectorAll('.card-back');
        if (oppCards.length > 0) {
            startRect = oppCards[oppCards.length - 1].getBoundingClientRect();
        }
    }

    if (!startRect) {
        startRect = pBlock.getBoundingClientRect();
    }

    const tableRect = centralTable.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;
    const targetScale = isMobile ? 0.40 : 0.68;
    const targetX = tableRect.left + tableRect.width / 2;
    const targetY = tableRect.top + tableRect.height / 2;

    const flying = document.createElement('div');
    flying.className = `card flying-card seme-${carta.seme} val-${carta.valore}`;
    flying.style.left = `${startRect.left + (startRect.width - 80) / 2}px`;
    flying.style.top = `${startRect.top + (startRect.height - 130) / 2}px`;
    flying.style.transform = `scale(${startRect.width / 80 || 0.6})`;
    document.body.appendChild(flying);

    sound.playCardPlay(carta);

    requestAnimationFrame(() => {
        flying.style.left = `${targetX - 40}px`;
        flying.style.top = `${targetY - 65}px`;
        flying.style.transform = `scale(${targetScale})`;
    });

    setTimeout(() => {
        if (!dati.presa) {
            // Calata senza presa: atterra sul tavolo
            flying.remove();
            if (onComplete) onComplete();
            return;
        }

        // PRESA: evidenzia carte prese dal tavolo
        const cartePrese = dati.cartePreseDalTavolo || [];
        const carteElPrese = [];
        const tableCards = document.querySelectorAll('#cards-on-table .table-card');

        cartePrese.forEach(cp => {
            for (let tc of tableCards) {
                if (!carteElPrese.includes(tc) && 
                    tc.dataset.seme === cp.seme && 
                    String(tc.dataset.valore) === String(cp.valore)) {
                    carteElPrese.push(tc);
                    tc.classList.add('card-capturing-glow');
                    break;
                }
            }
        });

        setTimeout(() => {
            const playerTargetRect = pBlock.getBoundingClientRect();
            const pTargetX = playerTargetRect.left + playerTargetRect.width / 2 - 40;
            const pTargetY = playerTargetRect.top + playerTargetRect.height / 2 - 65;

            flying.style.transition = 'all 0.40s cubic-bezier(0.4, 0, 0.2, 1)';
            flying.style.left = `${pTargetX}px`;
            flying.style.top = `${pTargetY}px`;
            flying.style.transform = 'scale(0.30)';
            flying.style.opacity = '0.5';

            carteElPrese.forEach(tc => {
                const rect = tc.getBoundingClientRect();
                const flyingCaptured = document.createElement('div');
                flyingCaptured.className = tc.className + ' flying-card';
                flyingCaptured.style.left = `${rect.left}px`;
                flyingCaptured.style.top = `${rect.top}px`;
                flyingCaptured.style.transform = `scale(${targetScale})`;
                document.body.appendChild(flyingCaptured);

                tc.style.opacity = '0';

                requestAnimationFrame(() => {
                    flyingCaptured.style.transition = 'all 0.40s cubic-bezier(0.4, 0, 0.2, 1)';
                    flyingCaptured.style.left = `${pTargetX}px`;
                    flyingCaptured.style.top = `${pTargetY}px`;
                    flyingCaptured.style.transform = 'scale(0.30)';
                    flyingCaptured.style.opacity = '0.5';
                    setTimeout(() => flyingCaptured.remove(), 420);
                });
            });

            setTimeout(() => {
                flying.remove();
                sound.playTrickWon(isMe);

                pBlock.classList.add('winner-pulse');
                setTimeout(() => pBlock.classList.remove('winner-pulse'), 1200);

                // Scopa discreta ed elegante: badge fluttuante sopra il giocatore SENZA coprire il tavolo
                if (dati.isScopa || dati.scopa) {
                    const scopaBadge = document.createElement('div');
                    scopaBadge.className = 'scopa-float-badge';
                    scopaBadge.innerHTML = '🧹 SCOPA! +1';
                    pBlock.appendChild(scopaBadge);
                    setTimeout(() => scopaBadge.remove(), 1300);
                } else if (dati.tipoPresa === 'asso_piglia_tutto') {
                    const assoBadge = document.createElement('div');
                    assoBadge.className = 'scopa-float-badge';
                    assoBadge.style.background = 'linear-gradient(135deg, #00d2d3, #0984e3)';
                    assoBadge.style.color = '#fff';
                    assoBadge.innerHTML = '⚡ Spazza tavolo!';
                    pBlock.appendChild(assoBadge);
                    setTimeout(() => assoBadge.remove(), 1300);
                } else if (dati.tipoPresa === 'furto') {
                    const furtoBadge = document.createElement('div');
                    furtoBadge.className = 'scopa-float-badge';
                    furtoBadge.style.background = 'linear-gradient(135deg, #9b59b6, #8e44ad)';
                    furtoBadge.style.color = '#fff';
                    furtoBadge.innerHTML = `🥷 Ruba a ${dati.rubatoANome || 'avv'}!`;
                    pBlock.appendChild(furtoBadge);
                    setTimeout(() => furtoBadge.remove(), 1300);
                }

                if (onComplete) onComplete();
            }, 420);

        }, 260);

    }, 340);
}

socket.on('mossa_scopa', (dati) => {
    window.scopaAnimazioneInCorso = true;
    animazioneMossaScopa(dati, () => {
        window.scopaAnimazioneInCorso = false;
        if (window.statoScopaInAttesa) {
            renderGiocatoriScopa(window.statoScopaInAttesa);
            window.statoScopaInAttesa = null;
        }
    });

    const iconSemeGiocata = getSemeSimbolo(dati.carta?.seme || dati.cartaGiocata?.seme);
    const valGiocata = dati.carta?.valore || dati.cartaGiocata?.valore;
    let descrPrese = '';
    const cartePrese = dati.cartePreseDalTavolo || [];
    if (dati.tipoPresa === 'furto') {
        descrPrese = ` ➔ Ruba mazzetto`;
    } else if (cartePrese.length > 0) {
        const elenco = cartePrese.map(c => `${c.valore}${getSemeSimbolo(c.seme)}`).join(', ');
        descrPrese = ` ➔ Prende [${elenco}]`;
    } else if (dati.presa) {
        descrPrese = ` ➔ Spazza tavolo`;
    }
    window.ultimaMossaScopaInfo = `${dati.nome} [${valGiocata}${iconSemeGiocata}]${descrPrese}`;
});

function mostraFineSmazzataScopa(data) {
    let toast = document.getElementById('round-recap-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'round-recap-toast';
        toast.className = 'round-recap-modal';
        document.body.appendChild(toast);
    }

    let rowsHtml = '';
    if (data.punteggi && data.punteggi.length > 0) {
        rowsHtml = data.punteggi.map(p => {
            const dett = p.dettaglio || {};
            const badges = [];
            if (p.scope > 0) badges.push(`<span class="recap-badge-scopa">🧹 ${p.scope} scope</span>`);
            if (dett.carte > 0) badges.push(`<span class="recap-badge">🂠 Carte +1</span>`);
            if (dett.denari > 0) badges.push(`<span class="recap-badge">🪙 Denari +1</span>`);
            if (dett.settebello > 0) badges.push(`<span class="recap-badge">⭐ Settebello +1</span>`);
            if (dett.reBello > 0) badges.push(`<span class="recap-badge" style="background: rgba(241, 196, 15, 0.25); border-color: #f1c40f;">🤴 Re Bello +1</span>`);
            if (dett.napola > 0) badges.push(`<span class="recap-badge" style="background: rgba(230, 126, 34, 0.25); border-color: #e67e22;">👑 Napola +${dett.napola}</span>`);
            if (dett.primiera > 0) {
                const punteggio = dett.valorePrimiera ? ` (${dett.valorePrimiera} pt)` : '';
                badges.push(`<span class="recap-badge">🏆 Primiera +1${punteggio}</span>`);
            }

            return `
                <div class="recap-row">
                    <div class="recap-player-name">${renderNomeConStemma(p.nome, p.stemma)}</div>
                    <div class="recap-badges">${badges.join(' ')}</div>
                    <div class="recap-scores">
                        <span class="recap-pts-gain">+${p.puntiSmazzata} pt</span>
                        <span class="recap-pts-total">Tot: ${p.puntiTotali}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    toast.innerHTML = `
        <div class="recap-title">🏁 Fine Smazzata ${data.smazzataNum || ''}</div>
        <div class="recap-list">${rowsHtml}</div>
        <button class="recap-close-btn" onclick="document.getElementById('round-recap-toast').style.display='none'">CONTINUA</button>
    `;
    toast.style.display = 'block';

    if (window.roundRecapTimeout) clearTimeout(window.roundRecapTimeout);
    window.roundRecapTimeout = setTimeout(() => {
        if (toast) toast.style.display = 'none';
    }, 4500);
}

socket.on('fine_smazzata_scopa', (data) => {
    mostraFineSmazzataScopa(data);
});

socket.on('fine_partita_scopa', (data) => {
    if (window.clientTurnInterval) {
        clearInterval(window.clientTurnInterval);
        window.clientTurnInterval = null;
    }
    sessionStorage.removeItem('lucas_room');

    const recapToast = document.getElementById('round-recap-toast');
    if (recapToast) recapToast.style.display = 'none';

    const modal = document.getElementById('modal-endgame');
    if (modal) {
        modal.style.display = 'block';
        const h2El = modal.querySelector('h2');
        if (h2El) h2El.innerText = "Classifica Finale Scopa";
        const listEl = document.getElementById('endgame-list');
        if (listEl && data.classifica) {
            listEl.innerHTML = data.classifica.map(p => {
                const medal = p.posizione === 1 ? '🥇' : p.posizione === 2 ? '🥈' : p.posizione === 3 ? '🥉' : `#${p.posizione}`;
                const eloStr = p.eloChange ? ` (ELO ${p.eloChange > 0 ? '+' : ''}${p.eloChange})` : '';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <span>${medal} ${renderNomeConStemma(p.nome, p.stemma)}</span>
                        <span style="color: #2ecc71; font-weight: bold;">${p.puntiTotali} pt${eloStr}</span>
                    </div>
                `;
            }).join('');
        }
    }
});

function renderGiocatoriScopa(data) {
    const playersCircle = document.getElementById('players-circle');
    const cardsOnTable = document.getElementById('cards-on-table');
    const infoGiro = document.getElementById('info-giro');

    playersCircle.innerHTML = '';
    renderTavoloBanco(cardsOnTable, data.tavolo);

    const isMobile = window.innerWidth <= 768;
    const numPlayers = data.tuttiGiocatori.length;
    let mioIndice = data.tuttiGiocatori.findIndex(p => p.isMe || p.socketId === socket.id);
    if (mioIndice === -1) mioIndice = 0;

    const { scalaPlayerBlock } = getPlayerScaleAndCardScale(numPlayers, isMobile);

    let labelVariante = 'Scopa Classica';
    if (data.variante === 'asso_piglia_tutto') labelVariante = '⚡ Asso Piglia Tutto';
    else if (data.variante === 'scopa_ladra') labelVariante = '🥷 Scopa Ladra';
    else if (data.variante === 'combinata') labelVariante = '🔥 Asso + Ladra';
    const subInfo = (window.ultimaMossaScopaInfo && !isMobile) ? ` | ${window.ultimaMossaScopaInfo}` : '';
    infoGiro.innerText = `${labelVariante} | Smazzata ${data.smazzataNum} | Obiettivo: ${data.limitePunti || 11} pt${subInfo}`;

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
        if (data.variante === 'scopa_ladra' || data.variante === 'combinata') {
            if (p.cimaMazzetto) {
                const iconSeme = getSemeSimbolo(p.cimaMazzetto.seme);
                cimaHtml = `
                    <div class="cima-mazzetto-box" title="Cima del mazzetto: rubabile con carta di valore uguale!">
                        <span class="cima-mazzetto-label">Cima:</span>
                        <span class="cima-mazzetto-valore">${p.cimaMazzetto.valore} ${iconSeme}</span>
                    </div>
                `;
            } else {
                cimaHtml = `<div style="font-size:0.75rem; color:#888; margin-top:2px;">(Nessuna presa)</div>`;
            }
        }

        pBlock.innerHTML = `
            <div class="name">${nomeConStemma}${ruolo}</div>
            <div class="stats"><span class="scopa-punti-badge">Punti: ${p.puntiTotali}</span> | Scope: <span class="scopa-badge">🧹 ${p.scopeCount || 0}</span></div>
            <div class="player-mazzetto-stack">
                <div class="card card-back player-mazzetto-mini"></div>
                <span>${p.preseCount !== undefined ? p.preseCount : (p.cartePreseCount || 0)} carte</span>
            </div>
            ${cimaHtml}
            ${timerHtml}
        `;

        if (isMe) {
            const myHandCont = document.createElement('div');
            myHandCont.id = 'tu-mano';
            pBlock.appendChild(myHandCont);
            renderTuaManoScopa(myHandCont, p.mano || data.mano, serverPlayerIndex === data.turnoAttuale);
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

function renderTuaManoScopa(handCont, mano, isMyTurn) {
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
        div.dataset.seme = c.seme;
        div.dataset.valore = c.valore;
        div.style.zIndex = 10 + idx;

        if (isMyTurn) {
            div.style.cursor = 'pointer';
        }

        div.onclick = () => {
            if (isMyTurn && canPlay && !isReplayMode) {
                nascondiErrore();
                canPlay = false;
                socket.emit('gioca_carta_scopa', { cartaIdx: mano.indexOf(c) });
            }
        };
        handCont.appendChild(div);
    });
}
