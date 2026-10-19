/**
 * LORES / LUCAS GAME - VOICE CHAT ENGINE (WebRTC P2P Mesh)
 * Comunicazione vocale cifrata browser-to-browser.
 * Supporta fino a 8 giocatori simultanei in modalità Mesh.
 * Zero registrazione audio, codec Opus ad alta fedeltà.
 *
 * Configurazione ICE: STUN + TURN (OpenRelay / Metered free tier)
 * per garantire il funzionamento anche con NAT simmetrici e reti restrittive.
 */

const ICE_SERVERS = {
    iceServers: [
        // STUN servers (discovery IP pubblico)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },

        // TURN servers (relay per NAT simmetrici / firewall restrittivi)
        // OpenRelay by Metered - 20 GB/mese gratuiti
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    // Preferisce relay solo come fallback, ma lo rende disponibile
    iceTransportPolicy: 'all'
};

// Soglia di volume RMS per il rilevamento voce locale (0-255 su scala frequenza)
const VAD_THRESHOLD = 14;

// Intervallo di polling VAD in ms
const VAD_POLL_INTERVAL = 100;

// Throttle minimo tra invii voice_state al server (ms)
const SPEAKING_EMIT_THROTTLE = 250;

// Massimo numero di tentativi di riconnessione per peer prima di rinunciare
const MAX_RECONNECT_ATTEMPTS = 3;

// Timeout (ms) per considerare un ICE gathering troppo lento
const ICE_GATHERING_TIMEOUT = 10000;

class VoiceChatManager {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map(); // peerId -> { pc, audio, iceCandidateQueue, remoteDescriptionSet, offerSent, isPolite, reconnectAttempts, reconnectTimer }
        this.earlyCandidates = new Map(); // peerId -> [candidate, ...] (candidati arrivati prima dell'inizializzazione del peer)
        this.isEnabled = false;
        this.isMuted = false;
        this.isDeafened = false;
        this.audioCtx = null;
        this.localAnalyser = null;
        this.localDataArray = null;
        this.vadInterval = null;
        this.lastSpeakingState = false;
        this.speakingThrottle = 0;
        this._pendingSpeakingEmit = null;

        // Callback per notificare l'interfaccia utente
        this.onStateChange = null;
        this.onSpeakingChange = null;
    }

    isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    }

    init(socket) {
        if (this.socket) return;
        this.socket = socket;
        this._setupSocketListeners();
    }

    _setupSocketListeners() {
        if (!this.socket) return;

        // Riceviamo la lista di tutti i peer già presenti nella voice room
        this.socket.on('voice_peers_list', async (peerIds) => {
            if (!this.isEnabled || !this.localStream) return;
            console.log(`[Voice] 📡 Connessione a ${peerIds.length} peer esistenti...`);
            for (const peerId of peerIds) {
                // Essendo noi i nuovi arrivati, creiamo l'offerta per ciascun peer
                // Noi siamo "impolite" (initiator), loro sono "polite" (riceventi)
                await this._createPeerConnection(peerId, true);
            }
        });

        // Un nuovo peer si è connesso: prepariamo la connessione in attesa della sua offerta SDP
        this.socket.on('voice_peer_joined', async ({ peerId }) => {
            if (!this.isEnabled || !this.localStream) return;
            console.log(`[Voice] 🆕 Nuovo peer rilevato: ${peerId}`);
            if (!this.peers.has(peerId)) {
                // Noi siamo "polite" (aspettiamo la sua offerta), lui è "impolite" (initiator)
                await this._createPeerConnection(peerId, false);
            }
        });

        // Segnali WebRTC in arrivo (offer, answer, candidate)
        this.socket.on('voice_signal', async ({ from, signal }) => {
            if (!this.isEnabled || !this.localStream) return;
            try {
                await this._handleSignal(from, signal);
            } catch (err) {
                console.error("[Voice] ❌ Errore gestione segnale da", from, err);
            }
        });

        // Notifica stato parlando / muto inviata dal server in tempo reale
        this.socket.on('voice_peer_state', ({ peerId, isMuted, isSpeaking }) => {
            if (this.onSpeakingChange) {
                this.onSpeakingChange(peerId, isSpeaking && !isMuted);
            }
        });

        // Un peer ha lasciato la chat vocale
        this.socket.on('voice_peer_left', ({ peerId }) => {
            console.log(`[Voice] 👋 Peer disconnesso: ${peerId}`);
            this._removePeer(peerId);
        });
    }

    async toggleVoice() {
        if (this.isEnabled) {
            this.leaveVoice();
            return false;
        } else {
            return await this.startVoice();
        }
    }

    async startVoice() {
        if (!this.isSupported()) {
            alert("Il tuo browser non supporta WebRTC per la chat vocale. Assicurati di usare HTTPS e un browser recente (Chrome, Safari, Edge, Firefox).");
            return false;
        }

        // SBLOCCO SINCRONO AUDIO PER DISPOSITIVI MOBILI (iOS Safari e Android)
        // È fondamentale inizializzare l'AudioContext durante la gesture del click dell'utente
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                if (!this.audioCtx || this.audioCtx.state === 'closed') {
                    this.audioCtx = new AudioCtx();
                }
                if (this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume().catch(() => {});
                }
            }
        } catch (e) {
            console.warn("[Voice] Sblocco AudioContext mobile:", e);
        }

        try {
            // Richiesta accesso al microfono con impostazioni ottimali per la voce
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            this.isEnabled = true;
            this.isMuted = false;
            this.isDeafened = false;

            // Inizializza l'analizzatore di volume locale per la Voice Activity Detection (VAD)
            this._initLocalAnalyser();

            // Notifichiamo al server l'ingresso nella voice room
            if (this.socket) {
                this.socket.emit('voice_join');
            }

            console.log('[Voice] 🎙️ Chat vocale attivata (STUN + TURN configurati)');
            this._notifyState();
            return true;
        } catch (err) {
            console.error("[Voice] Accesso microfono negato o errore:", err);
            this.leaveVoice();
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert("Permesso microfono non concesso. Abilita l'accesso al microfono nelle impostazioni del browser/dispositivo per usare la chat vocale.");
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                alert("Nessun microfono rilevato sul dispositivo.");
            } else {
                alert("Impossibile accedere al microfono: " + err.message);
            }
            return false;
        }
    }

    toggleMute() {
        if (!this.isEnabled || !this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });

        if (this.socket) {
            this.socket.emit('voice_state', { isMuted: this.isMuted, isSpeaking: false });
        }

        if (this.onSpeakingChange) {
            this.onSpeakingChange('me', false);
        }

        this._notifyState();
        return this.isMuted;
    }

    toggleDeafen() {
        if (!this.isEnabled) return false;
        this.isDeafened = !this.isDeafened;

        for (const peerData of this.peers.values()) {
            if (peerData.audio) {
                peerData.audio.muted = this.isDeafened;
            }
        }

        this._notifyState();
        return this.isDeafened;
    }

    leaveVoice() {
        if (this._pendingSpeakingEmit) {
            clearTimeout(this._pendingSpeakingEmit);
            this._pendingSpeakingEmit = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        for (const peerId of Array.from(this.peers.keys())) {
            this._removePeer(peerId);
        }
        this.earlyCandidates.clear();

        if (this.vadInterval) {
            clearInterval(this.vadInterval);
            this.vadInterval = null;
        }

        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }

        this.localAnalyser = null;
        this.localDataArray = null;

        if (this.socket && this.isEnabled) {
            this.socket.emit('voice_leave');
        }

        this.isEnabled = false;
        this.isMuted = false;
        this.isDeafened = false;
        this.lastSpeakingState = false;

        if (this.onSpeakingChange) {
            this.onSpeakingChange('me', false);
        }

        console.log('[Voice] 🔇 Chat vocale disattivata');
        this._notifyState();
    }

    async _createPeerConnection(peerId, isInitiator) {
        // Se la connessione esiste già ed è attiva:
        if (this.peers.has(peerId)) {
            const existing = this.peers.get(peerId);
            if (existing.pc && existing.pc.connectionState !== 'failed' && existing.pc.connectionState !== 'closed') {
                // Se siamo chiamati come initiator ma non abbiamo ancora inviato un'offerta, inviamola ora!
                if (isInitiator && !existing.offerSent) {
                    existing.offerSent = true;
                    try {
                        const offer = await existing.pc.createOffer();
                        await existing.pc.setLocalDescription(offer);
                        if (this.socket) {
                            this.socket.emit('voice_signal', {
                                to: peerId,
                                signal: { sdp: existing.pc.localDescription }
                            });
                        }
                    } catch (err) {
                        console.error("[Voice] Errore offerta su peer pre-esistente:", peerId, err);
                    }
                }
                return existing.pc;
            }
            // Preserva il contatore di riconnessione
            const prevAttempts = existing.reconnectAttempts || 0;
            this._removePeer(peerId);
            // Lo ripristiniamo dopo la rimozione, solo per il nuovo peerData
            this._lastReconnectAttempts = prevAttempts;
        }

        const pc = new RTCPeerConnection(ICE_SERVERS);
        
        // Recupera eventuali candidati ICE arrivati prima della creazione della PC
        const queuedEarly = this.earlyCandidates.get(peerId) || [];
        this.earlyCandidates.delete(peerId);

        const peerData = {
            pc,
            audio: null,
            iceCandidateQueue: [...queuedEarly],
            remoteDescriptionSet: false,
            offerSent: !!isInitiator,
            // "Perfect Negotiation" pattern:
            // isPolite = true se NON siamo l'initiator (cediamo in caso di collisione offerte)
            isPolite: !isInitiator,
            // Makingp offer flag per gestire collisioni SDP
            makingOffer: false,
            // Contatore tentativi di riconnessione con backoff esponenziale
            reconnectAttempts: this._lastReconnectAttempts || 0,
            reconnectTimer: null
        };
        this._lastReconnectAttempts = 0;
        this.peers.set(peerId, peerData);

        // Aggiungiamo i track locali al peer
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Invio dei candidati ICE raccolti al peer remoto
        pc.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('voice_signal', {
                    to: peerId,
                    signal: { candidate: event.candidate }
                });
            }
        };

        // Diagnostica ICE gathering
        pc.onicegatheringstatechange = () => {
            console.log(`[Voice] 🧊 ICE gathering ${peerId}: ${pc.iceGatheringState}`);
        };

        // Diagnostica ICE connection state (più granulare di connectionState)
        pc.oniceconnectionstatechange = () => {
            const iceState = pc.iceConnectionState;
            console.log(`[Voice] 🔌 ICE connection ${peerId}: ${iceState}`);

            // "checking" per troppo tempo potrebbe indicare problemi NAT
            if (iceState === 'checking') {
                // Timeout: se dopo ICE_GATHERING_TIMEOUT siamo ancora in checking, logghiamo un warning
                const checkTimer = setTimeout(() => {
                    if (pc.iceConnectionState === 'checking') {
                        console.warn(`[Voice] ⚠️ ICE checking con ${peerId} sta impiegando troppo tempo. Potrebbe esserci un problema NAT/firewall.`);
                    }
                }, ICE_GATHERING_TIMEOUT);
                // Salviamo per pulirlo se cambia stato prima
                peerData._iceCheckTimer = checkTimer;
            } else if (peerData._iceCheckTimer) {
                clearTimeout(peerData._iceCheckTimer);
                peerData._iceCheckTimer = null;
            }
        };

        // Ricezione dello stream audio remoto
        pc.ontrack = (event) => {
            console.log(`[Voice] 🔊 ontrack da ${peerId}, kind: ${event.track?.kind}`);
            // Fix per Safari su iOS e browser con Unified Plan dove event.streams[0] può mancare
            const remoteStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);

            let audioEl = peerData.audio;
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                audioEl.playsInline = true;
                audioEl.setAttribute('playsinline', 'true');
                audioEl.setAttribute('webkit-playsinline', 'true');
                audioEl.volume = 1.0;
                // Manteniamo nel DOM ma invisibile fuori dallo schermo
                audioEl.style.position = 'fixed';
                audioEl.style.left = '-9999px';
                audioEl.style.top = '-9999px';
                audioEl.style.opacity = '0';
                audioEl.style.pointerEvents = 'none';
                document.body.appendChild(audioEl);
                peerData.audio = audioEl;
            }
            audioEl.srcObject = remoteStream;
            audioEl.muted = this.isDeafened;

            // Avvio riproduzione e gestione sblocco autoplay su mobile
            const playPromise = audioEl.play();
            if (playPromise) {
                playPromise.catch(e => {
                    console.warn(`[Voice] Autoplay audio bloccato per ${peerId}, in attesa di tocco:`, e);
                    const unlock = () => {
                        audioEl.play().catch(() => {});
                        document.removeEventListener('click', unlock);
                        document.removeEventListener('touchstart', unlock);
                    };
                    document.addEventListener('click', unlock, { once: true });
                    document.addEventListener('touchstart', unlock, { once: true });
                });
            }
        };

        // Monitoraggio dello stato della connessione P2P con retry intelligente
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log(`[Voice] 🔗 connectionState con ${peerId}: ${state}`);
            if (state === 'connected') {
                console.log(`[Voice] ✅ Connessione P2P vocale stabilita con ${peerId}`);
                // Reset contatore tentativi su connessione riuscita
                peerData.reconnectAttempts = 0;
                if (peerData.reconnectTimer) {
                    clearTimeout(peerData.reconnectTimer);
                    peerData.reconnectTimer = null;
                }
            } else if (state === 'failed') {
                console.warn(`[Voice] ❌ Connessione fallita con ${peerId}`);
                this._handleConnectionFailure(peerId);
            } else if (state === 'disconnected') {
                // Attesa breve prima di tentare ICE restart (potrebbe essere temporaneo)
                setTimeout(() => {
                    const pd = this.peers.get(peerId);
                    if (pd && pd.pc && pd.pc.connectionState === 'disconnected') {
                        console.warn(`[Voice] ⏰ Timeout disconnessione peer ${peerId}, riavvio ICE...`);
                        this._attemptIceRestart(peerId);
                    }
                }, 4000);
            } else if (state === 'closed') {
                this._removePeer(peerId);
            }
        };

        // Se siamo l'iniziatore, creiamo e inviamo l'offerta SDP
        if (isInitiator) {
            try {
                peerData.makingOffer = true;
                const offer = await pc.createOffer();
                // Controllo: se nel frattempo il signaling state è cambiato, non settare la local description
                if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-local-offer') {
                    console.warn(`[Voice] Signaling state cambiato durante creazione offerta per ${peerId}: ${pc.signalingState}`);
                    peerData.makingOffer = false;
                    return pc;
                }
                await pc.setLocalDescription(offer);
                if (this.socket) {
                    this.socket.emit('voice_signal', {
                        to: peerId,
                        signal: { sdp: pc.localDescription }
                    });
                }
            } catch (err) {
                console.error("[Voice] Errore creazione offerta SDP per", peerId, err);
            } finally {
                peerData.makingOffer = false;
            }
        }

        this._notifyState();
        return pc;
    }

    /**
     * Gestisce un fallimento di connessione con backoff esponenziale.
     * Dopo MAX_RECONNECT_ATTEMPTS tentativi, ricostruisce la peer connection da zero.
     */
    _handleConnectionFailure(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData) return;

        peerData.reconnectAttempts = (peerData.reconnectAttempts || 0) + 1;

        if (peerData.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            console.error(`[Voice] 🚫 Superato il limite di ${MAX_RECONNECT_ATTEMPTS} tentativi per ${peerId}. Ricostruzione completa...`);
            // Ricostruisce la connessione da zero
            const wasPolite = peerData.isPolite;
            this._removePeer(peerId);
            // Ritenta come initiator dopo un breve delay
            setTimeout(async () => {
                if (this.isEnabled && this.localStream) {
                    console.log(`[Voice] 🔄 Ricostruzione completa connessione con ${peerId}...`);
                    await this._createPeerConnection(peerId, !wasPolite);
                }
            }, 2000);
            return;
        }

        // Backoff esponenziale: 1s, 2s, 4s
        const delay = Math.pow(2, peerData.reconnectAttempts - 1) * 1000;
        console.log(`[Voice] 🔄 ICE restart ${peerData.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} per ${peerId} tra ${delay}ms...`);

        if (peerData.reconnectTimer) {
            clearTimeout(peerData.reconnectTimer);
        }
        peerData.reconnectTimer = setTimeout(() => {
            peerData.reconnectTimer = null;
            this._attemptIceRestart(peerId);
        }, delay);
    }

    async _attemptIceRestart(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData || !peerData.pc) return;

        try {
            const pc = peerData.pc;
            if (pc.connectionState === 'closed') {
                this._removePeer(peerId);
                return;
            }
            peerData.iceCandidateQueue = [];
            peerData.remoteDescriptionSet = false;

            peerData.makingOffer = true;
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            if (this.socket) {
                this.socket.emit('voice_signal', {
                    to: peerId,
                    signal: { sdp: pc.localDescription }
                });
            }
            console.log(`[Voice] 🔄 ICE restart inviato a ${peerId}`);
        } catch (err) {
            console.error("[Voice] ICE restart fallito per", peerId, err);
            this._handleConnectionFailure(peerId);
        } finally {
            if (peerData) peerData.makingOffer = false;
        }
    }

    /**
     * Gestione segnali WebRTC con "Perfect Negotiation" pattern.
     * Risolve il problema del "glare" (collisione offerte simultanee)
     * che causa fallimenti quando 3+ peer si connettono contemporaneamente.
     */
    async _handleSignal(peerId, signal) {
        let peerData = this.peers.get(peerId);
        let pc = peerData?.pc;

        if (signal.sdp) {
            const sdp = signal.sdp;

            // === PERFECT NEGOTIATION: gestione collisione offerte ===
            if (sdp.type === 'offer') {
                if (!pc) {
                    pc = await this._createPeerConnection(peerId, false);
                    peerData = this.peers.get(peerId);
                }

                // Collisione: entrambi i peer stanno inviando un'offerta contemporaneamente
                const offerCollision = peerData.makingOffer || pc.signalingState !== 'stable';

                if (offerCollision) {
                    if (!peerData.isPolite) {
                        // Noi siamo "impolite" (initiator): ignoriamo l'offerta dell'altro
                        console.log(`[Voice] ⚡ Collisione offerta con ${peerId}: ignoro (sono impolite/initiator)`);
                        return;
                    }
                    // Noi siamo "polite": cediamo, rollback della nostra offerta e accettiamo la sua
                    console.log(`[Voice] ⚡ Collisione offerta con ${peerId}: rollback (sono polite)`);
                }

                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    peerData.remoteDescriptionSet = true;

                    // Processa eventuali candidati ICE arrivati prima di setRemoteDescription
                    await this._flushIceCandidateQueue(peerId);

                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    if (this.socket) {
                        this.socket.emit('voice_signal', {
                            to: peerId,
                            signal: { sdp: pc.localDescription }
                        });
                    }
                } catch (err) {
                    console.error(`[Voice] Errore gestione offerta da ${peerId}:`, err);
                }
            } else if (sdp.type === 'answer') {
                if (pc) {
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                        if (peerData) {
                            peerData.remoteDescriptionSet = true;
                            await this._flushIceCandidateQueue(peerId);
                        }
                    } catch (err) {
                        // Se riceviamo un answer in uno stato inatteso, logghiamo ma non crashiamo
                        console.warn(`[Voice] Answer ignorata per ${peerId} (signalingState: ${pc.signalingState}):`, err.message);
                    }
                }
            }
        } else if (signal.candidate) {
            if (!pc) {
                // Non creare RTCPeerConnection prematuramente qui per evitare di invertire il ruolo di initiator!
                if (!this.earlyCandidates.has(peerId)) {
                    this.earlyCandidates.set(peerId, []);
                }
                this.earlyCandidates.get(peerId).push(signal.candidate);
                return;
            }

            if (peerData && !peerData.remoteDescriptionSet) {
                peerData.iceCandidateQueue.push(signal.candidate);
            } else if (pc) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } catch (e) {
                    // Ignora candidati ICE non validi (può succedere dopo un rollback)
                    if (pc.signalingState !== 'closed') {
                        console.warn("[Voice] Errore aggiunta ICE candidate:", e.message);
                    }
                }
            }
        }
    }

    async _flushIceCandidateQueue(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData || !peerData.pc || peerData.iceCandidateQueue.length === 0) return;

        const queue = peerData.iceCandidateQueue;
        peerData.iceCandidateQueue = [];

        for (const candidate of queue) {
            try {
                await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn("[Voice] Errore aggiunta ICE candidate da coda:", e.message);
            }
        }
    }

    _removePeer(peerId) {
        this.earlyCandidates.delete(peerId);
        const peerData = this.peers.get(peerId);
        if (!peerData) return;

        try {
            // Pulisci timer
            if (peerData.reconnectTimer) {
                clearTimeout(peerData.reconnectTimer);
            }
            if (peerData._iceCheckTimer) {
                clearTimeout(peerData._iceCheckTimer);
            }
            if (peerData.pc) {
                peerData.pc.onicecandidate = null;
                peerData.pc.ontrack = null;
                peerData.pc.onconnectionstatechange = null;
                peerData.pc.onicegatheringstatechange = null;
                peerData.pc.oniceconnectionstatechange = null;
                peerData.pc.close();
            }
            if (peerData.audio) {
                peerData.audio.pause();
                peerData.audio.srcObject = null;
                peerData.audio.remove();
            }
        } catch (e) {}

        this.peers.delete(peerId);

        if (this.onSpeakingChange) {
            this.onSpeakingChange(peerId, false);
        }

        this._notifyState();
        console.log(`[Voice] 🗑️ Peer ${peerId} rimosso`);
    }

    _initLocalAnalyser() {
        if (!this.localStream) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!this.audioCtx) this.audioCtx = new AudioCtx();

            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }

            const source = this.audioCtx.createMediaStreamSource(this.localStream);
            this.localAnalyser = this.audioCtx.createAnalyser();
            this.localAnalyser.fftSize = 256;
            this.localAnalyser.smoothingTimeConstant = 0.5;
            source.connect(this.localAnalyser);

            this.localDataArray = new Uint8Array(this.localAnalyser.frequencyBinCount);

            if (!this.vadInterval) {
                this.vadInterval = setInterval(() => this._checkVoiceActivity(), VAD_POLL_INTERVAL);
            }
        } catch (e) {
            console.warn("[Voice] Impossibile avviare analizzatore locale:", e);
        }
    }

    _checkVoiceActivity() {
        // Controllo locale (me): rileva se l'utente sta parlando e lo invia al server via socket.io
        if (this.localAnalyser && this.localDataArray && !this.isMuted && this.isEnabled) {
            this.localAnalyser.getByteFrequencyData(this.localDataArray);
            let sum = 0;
            for (let i = 0; i < this.localDataArray.length; i++) {
                sum += this.localDataArray[i];
            }
            const average = sum / this.localDataArray.length;
            const isSpeaking = average > VAD_THRESHOLD;

            if (isSpeaking !== this.lastSpeakingState) {
                this.lastSpeakingState = isSpeaking;
                if (this.onSpeakingChange) {
                    this.onSpeakingChange('me', isSpeaking);
                }
                const now = Date.now();
                this._emitSpeakingStateThrottled(isSpeaking, now);
            }
        }
    }

    _emitSpeakingStateThrottled(isSpeaking, now) {
        if (this._pendingSpeakingEmit) {
            clearTimeout(this._pendingSpeakingEmit);
            this._pendingSpeakingEmit = null;
        }

        if (now - this.speakingThrottle >= SPEAKING_EMIT_THROTTLE) {
            this.speakingThrottle = now;
            if (this.socket) {
                this.socket.emit('voice_state', { isMuted: false, isSpeaking: isSpeaking });
            }
        } else {
            const remaining = SPEAKING_EMIT_THROTTLE - (now - this.speakingThrottle);
            this._pendingSpeakingEmit = setTimeout(() => {
                this._pendingSpeakingEmit = null;
                this.speakingThrottle = Date.now();
                if (this.socket && this.isEnabled) {
                    this.socket.emit('voice_state', { isMuted: this.isMuted, isSpeaking: this.lastSpeakingState });
                }
            }, remaining);
        }
    }

    _notifyState() {
        if (this.onStateChange) {
            this.onStateChange({
                isEnabled: this.isEnabled,
                isMuted: this.isMuted,
                isDeafened: this.isDeafened,
                peersCount: this.peers.size
            });
        }
    }

    /**
     * Diagnostica: restituisce un report sullo stato di tutte le connessioni peer.
     * Utile per debugging da console: voiceManager.getDiagnostics()
     */
    getDiagnostics() {
        const report = {
            enabled: this.isEnabled,
            muted: this.isMuted,
            deafened: this.isDeafened,
            localStreamActive: !!(this.localStream && this.localStream.active),
            turnConfigured: ICE_SERVERS.iceServers.some(s => s.urls && s.urls.toString().startsWith('turn:')),
            peers: {}
        };

        for (const [peerId, pd] of this.peers) {
            report.peers[peerId] = {
                connectionState: pd.pc?.connectionState,
                iceConnectionState: pd.pc?.iceConnectionState,
                iceGatheringState: pd.pc?.iceGatheringState,
                signalingState: pd.pc?.signalingState,
                hasAudio: !!pd.audio,
                isPolite: pd.isPolite,
                remoteDescriptionSet: pd.remoteDescriptionSet,
                reconnectAttempts: pd.reconnectAttempts,
                localCandidateType: null, // Riempito da getStats sotto
                remoteCandidateType: null
            };

            // Tentativo di estrarre il tipo di candidato selezionato (relay vs srflx vs host)
            if (pd.pc && pd.pc.connectionState === 'connected') {
                pd.pc.getStats().then(stats => {
                    stats.forEach(s => {
                        if (s.type === 'candidate-pair' && s.state === 'succeeded') {
                            stats.forEach(c => {
                                if (c.id === s.localCandidateId) {
                                    report.peers[peerId].localCandidateType = c.candidateType;
                                }
                                if (c.id === s.remoteCandidateId) {
                                    report.peers[peerId].remoteCandidateType = c.candidateType;
                                }
                            });
                        }
                    });
                    console.log('[Voice] 📊 Diagnostica:', JSON.stringify(report, null, 2));
                }).catch(() => {});
            }
        }

        console.log('[Voice] 📊 Diagnostica (base):', JSON.stringify(report, null, 2));
        return report;
    }
}

// Istanza singleton esportata
const voiceManager = new VoiceChatManager();
export default voiceManager;
