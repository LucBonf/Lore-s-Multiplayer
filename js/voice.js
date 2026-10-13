/**
 * LORES / LUCAS GAME - VOICE CHAT ENGINE (WebRTC P2P Mesh)
 * Comunicazione vocale cifrata browser-to-browser.
 * Supporta fino a 8 giocatori simultanei in modalità Mesh.
 * Zero registrazione audio, codec Opus ad alta fedeltà.
 */

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// Soglia di volume RMS per il rilevamento voce locale (0-255 su scala frequenza)
const VAD_THRESHOLD = 14;

// Intervallo di polling VAD in ms
const VAD_POLL_INTERVAL = 100;

// Throttle minimo tra invii voice_state al server (ms)
const SPEAKING_EMIT_THROTTLE = 250;

class VoiceChatManager {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map(); // peerId -> { pc, audio, iceCandidateQueue, remoteDescriptionSet, offerSent }
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
            console.log(`[Voice] Connessione a ${peerIds.length} peer esistenti...`);
            for (const peerId of peerIds) {
                // Essendo noi i nuovi arrivati, creiamo l'offerta per ciascun peer
                await this._createPeerConnection(peerId, true);
            }
        });

        // Un nuovo peer si è connesso: prepariamo la connessione in attesa della sua offerta SDP
        this.socket.on('voice_peer_joined', async ({ peerId }) => {
            if (!this.isEnabled || !this.localStream) return;
            console.log(`[Voice] Nuovo peer rilevato: ${peerId}`);
            if (!this.peers.has(peerId)) {
                await this._createPeerConnection(peerId, false);
            }
        });

        // Segnali WebRTC in arrivo (offer, answer, candidate)
        this.socket.on('voice_signal', async ({ from, signal }) => {
            if (!this.isEnabled || !this.localStream) return;
            try {
                await this._handleSignal(from, signal);
            } catch (err) {
                console.error("[Voice] Errore gestione segnale da", from, err);
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
            console.log(`[Voice] Peer disconnesso: ${peerId}`);
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
            this._removePeer(peerId);
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
            offerSent: !!isInitiator
        };
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

        // Ricezione dello stream audio remoto
        pc.ontrack = (event) => {
            console.log(`[Voice] ontrack da ${peerId}, kind: ${event.track?.kind}`);
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

        // Monitoraggio dello stato della connessione P2P
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log(`[Voice] connectionState con ${peerId}: ${state}`);
            if (state === 'connected') {
                console.log(`[Voice] ✅ Connessione P2P vocale stabilita con ${peerId}`);
            } else if (state === 'failed') {
                console.warn(`[Voice] ❌ Connessione fallita con ${peerId}, riavvio ICE...`);
                this._attemptIceRestart(peerId);
            } else if (state === 'disconnected') {
                setTimeout(() => {
                    const pd = this.peers.get(peerId);
                    if (pd && pd.pc && pd.pc.connectionState === 'disconnected') {
                        console.warn(`[Voice] Timeout disconnessione peer ${peerId}, riavvio ICE...`);
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
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (this.socket) {
                    this.socket.emit('voice_signal', {
                        to: peerId,
                        signal: { sdp: pc.localDescription }
                    });
                }
            } catch (err) {
                console.error("[Voice] Errore creazione offerta SDP per", peerId, err);
            }
        }

        this._notifyState();
        return pc;
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

            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            if (this.socket) {
                this.socket.emit('voice_signal', {
                    to: peerId,
                    signal: { sdp: pc.localDescription }
                });
            }
        } catch (err) {
            console.error("[Voice] ICE restart fallito per", peerId, err);
            this._removePeer(peerId);
        }
    }

    async _handleSignal(peerId, signal) {
        let peerData = this.peers.get(peerId);
        let pc = peerData?.pc;

        if (signal.sdp) {
            const sdp = signal.sdp;
            if (sdp.type === 'offer') {
                if (!pc) {
                    pc = await this._createPeerConnection(peerId, false);
                    peerData = this.peers.get(peerId);
                }
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
            } else if (sdp.type === 'answer') {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    if (peerData) {
                        peerData.remoteDescriptionSet = true;
                        await this._flushIceCandidateQueue(peerId);
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
                    console.warn("[Voice] Errore aggiunta ICE candidate:", e);
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
                console.warn("[Voice] Errore aggiunta ICE candidate da coda:", e);
            }
        }
    }

    _removePeer(peerId) {
        this.earlyCandidates.delete(peerId);
        const peerData = this.peers.get(peerId);
        if (!peerData) return;

        try {
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
        console.log(`[Voice] Peer ${peerId} rimosso`);
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
}

// Istanza singleton esportata
const voiceManager = new VoiceChatManager();
export default voiceManager;
